import { PODCAST_SYNC_RESOLUTION_SECONDS } from "@/podcast-sync/dsp";

export interface PodcastSyncCut {
	timestamp: number;
	channelId: string;
	duration: number;
}

const INTEGRATION_SECONDS = 1;
const HOLD_SECONDS = 0.8;
const CONFIRM_SECONDS = 0.5;
const ACTIVITY_FLOOR = 0.02;
const DOMINANCE_RATIO = 1.4;

function argmax({ row }: { row: Float32Array }): number {
	let bestIndex = 0;
	let bestValue = row[0] ?? 0;
	for (let i = 1; i < row.length; i++) {
		const value = row[i] ?? 0;
		if (value > bestValue) {
			bestValue = value;
			bestIndex = i;
		}
	}
	return bestIndex;
}

export function computeDominantTrack({
	timeline,
	numChannels,
}: {
	timeline: Float32Array[];
	numChannels: number;
}): Int32Array {
	const numSteps = timeline.length;
	const integrationFrames = Math.max(
		1,
		Math.round(INTEGRATION_SECONDS / PODCAST_SYNC_RESOLUTION_SECONDS),
	);
	const holdFrames = Math.max(
		1,
		Math.round(HOLD_SECONDS / PODCAST_SYNC_RESOLUTION_SECONDS),
	);
	const confirmFrames = Math.max(
		1,
		Math.round(CONFIRM_SECONDS / PODCAST_SYNC_RESOLUTION_SECONDS),
	);

	const integrated = Array.from(
		{ length: numSteps },
		() => new Float32Array(numChannels),
	);

	for (let channel = 0; channel < numChannels; channel++) {
		const prefix = new Float64Array(numSteps + 1);
		for (let i = 0; i < numSteps; i++) {
			prefix[i + 1] = (prefix[i] ?? 0) + (timeline[i]?.[channel] ?? 0);
		}
		for (let i = 0; i < numSteps; i++) {
			const low = Math.max(0, i + 1 - integrationFrames);
			integrated[i]![channel] =
				((prefix[i + 1] ?? 0) - (prefix[low] ?? 0)) / (i + 1 - low);
		}
	}

	const dominant = new Int32Array(numSteps);
	const initWindow = Math.min(
		numSteps,
		Math.round(2 / PODCAST_SYNC_RESOLUTION_SECONDS),
	);
	const initEnergy = new Float64Array(numChannels);
	for (let i = 0; i < initWindow; i++) {
		for (let channel = 0; channel < numChannels; channel++) {
			initEnergy[channel] =
				(initEnergy[channel] ?? 0) + (integrated[i]?.[channel] ?? 0);
		}
	}

	let currentSpeaker = 0;
	let currentInitialEnergy = initEnergy[0] ?? 0;
	for (let channel = 1; channel < numChannels; channel++) {
		const energy = initEnergy[channel] ?? 0;
		if (energy > currentInitialEnergy) {
			currentInitialEnergy = energy;
			currentSpeaker = channel;
		}
	}

	let challengerCounter = 0;
	let challengerId = -1;
	let silenceCounter = 0;

	for (let frame = 0; frame < numSteps; frame++) {
		const energies = integrated[frame] ?? new Float32Array(numChannels);
		const currentEnergy = energies[currentSpeaker] ?? 0;
		if (currentEnergy >= ACTIVITY_FLOOR) {
			silenceCounter = 0;
		} else {
			silenceCounter++;
		}

		const bestChannel = argmax({ row: energies });
		const bestEnergy = energies[bestChannel] ?? 0;

		if (bestChannel === currentSpeaker) {
			challengerCounter = 0;
			challengerId = -1;
			dominant[frame] = currentSpeaker;
			continue;
		}

		const ratio = bestEnergy / Math.max(currentEnergy, 1e-8);
		const inHold = silenceCounter < holdFrames;
		const requiredRatio = inHold ? DOMINANCE_RATIO * 1.5 : DOMINANCE_RATIO;

		if (ratio < requiredRatio || bestEnergy < ACTIVITY_FLOOR) {
			challengerCounter = 0;
			challengerId = -1;
			dominant[frame] = currentSpeaker;
			continue;
		}

		if (bestChannel === challengerId) {
			challengerCounter++;
		} else {
			challengerId = bestChannel;
			challengerCounter = 1;
		}

		if (challengerCounter >= confirmFrames) {
			currentSpeaker = challengerId;
			challengerCounter = 0;
			challengerId = -1;
			silenceCounter = 0;
		}

		dominant[frame] = currentSpeaker;
	}

	return dominant;
}

export function dominantTrackToCuts({
	dominant,
	channelIds,
	duration,
	minCutDuration,
	preRoll,
}: {
	dominant: Int32Array;
	channelIds: string[];
	duration: number;
	minCutDuration: number;
	preRoll: number;
}): PodcastSyncCut[] {
	const numSteps = dominant.length;
	if (numSteps === 0) {
		return [{ timestamp: 0, channelId: channelIds[0] ?? "", duration }];
	}

	let segments: Array<[number, number, number]> = [];
	let segmentStart = 0;
	let segmentChannel = dominant[0] ?? 0;

	for (let i = 1; i < numSteps; i++) {
		if ((dominant[i] ?? 0) !== segmentChannel) {
			segments.push([segmentStart, i, segmentChannel]);
			segmentStart = i;
			segmentChannel = dominant[i] ?? 0;
		}
	}
	segments.push([segmentStart, numSteps, segmentChannel]);

	const minFrames = Math.max(
		1,
		Math.round(minCutDuration / PODCAST_SYNC_RESOLUTION_SECONDS),
	);
	let changed = true;
	while (changed) {
		changed = false;
		const next: Array<[number, number, number]> = [];
		for (const segment of segments) {
			if (segment[1] - segment[0] < minFrames && next.length > 0) {
				const previous = next[next.length - 1]!;
				next[next.length - 1] = [previous[0], segment[1], previous[2]];
				changed = true;
			} else {
				next.push(segment);
			}
		}
		segments = next;
	}

	const merged: Array<[number, number, number]> = [];
	for (const segment of segments) {
		const previous = merged[merged.length - 1];
		if (previous && previous[2] === segment[2]) {
			merged[merged.length - 1] = [previous[0], segment[1], previous[2]];
		} else {
			merged.push(segment);
		}
	}

	const cuts: PodcastSyncCut[] = [];
	for (let i = 0; i < merged.length; i++) {
		const [startFrame, endFrame, channelIndex] = merged[i]!;
		let startSeconds = startFrame * PODCAST_SYNC_RESOLUTION_SECONDS;
		const endSeconds = Math.min(
			endFrame * PODCAST_SYNC_RESOLUTION_SECONDS,
			duration,
		);

		if (i > 0 && cuts.length > 0) {
			const previous = cuts[cuts.length - 1]!;
			startSeconds = Math.max(
				previous.timestamp + previous.duration,
				startSeconds - preRoll,
			);
			previous.duration = startSeconds - previous.timestamp;
		}

		let cutDuration = endSeconds - startSeconds;
		if (i === merged.length - 1) cutDuration = duration - startSeconds;
		cuts.push({
			timestamp: startSeconds,
			channelId: channelIds[channelIndex] ?? channelIds[0] ?? "",
			duration: Math.max(0, cutDuration),
		});
	}

	return cuts.length > 0
		? cuts
		: [{ timestamp: 0, channelId: channelIds[0] ?? "", duration }];
}

export function smoothCuts({
	cuts,
	minSegment,
}: {
	cuts: PodcastSyncCut[];
	minSegment: number;
}): PodcastSyncCut[] {
	if (cuts.length <= 1) return cuts;

	let smoothed: PodcastSyncCut[] = [{ ...cuts[0]! }];
	for (let i = 1; i < cuts.length; i++) {
		const cut = cuts[i]!;
		if (cut.duration < minSegment) {
			smoothed[smoothed.length - 1]!.duration += cut.duration;
		} else {
			smoothed.push({ ...cut });
		}
	}

	const bounceThreshold = minSegment * 2.5;
	let changed = true;
	while (changed) {
		changed = false;
		if (smoothed.length < 3) break;

		const next: PodcastSyncCut[] = [{ ...smoothed[0]! }];
		let index = 1;
		while (index < smoothed.length - 1) {
			const previousChannel = next[next.length - 1]!.channelId;
			const current = smoothed[index]!;
			const following = smoothed[index + 1]!;
			if (
				following.channelId === previousChannel &&
				current.duration < bounceThreshold
			) {
				next[next.length - 1]!.duration +=
					current.duration + following.duration;
				index += 2;
				changed = true;
			} else {
				next.push({ ...current });
				index++;
			}
		}
		if (index === smoothed.length - 1) {
			next.push({ ...smoothed[smoothed.length - 1]! });
		}
		smoothed = next;
	}

	const merged: PodcastSyncCut[] = [{ ...smoothed[0]! }];
	for (let i = 1; i < smoothed.length; i++) {
		const cut = smoothed[i]!;
		const previous = merged[merged.length - 1]!;
		if (cut.channelId === previous.channelId) {
			previous.duration += cut.duration;
		} else {
			merged.push({ ...cut });
		}
	}
	return merged;
}

function splitLongCuts({
	cuts,
	maxCutDuration,
}: {
	cuts: PodcastSyncCut[];
	maxCutDuration: number;
}): PodcastSyncCut[] {
	if (!(maxCutDuration > 0)) return cuts;
	const result: PodcastSyncCut[] = [];
	for (const cut of cuts) {
		let remaining = cut.duration;
		let timestamp = cut.timestamp;
		while (remaining > maxCutDuration) {
			result.push({
				timestamp,
				channelId: cut.channelId,
				duration: maxCutDuration,
			});
			timestamp += maxCutDuration;
			remaining -= maxCutDuration;
		}
		if (remaining > 0) {
			result.push({ timestamp, channelId: cut.channelId, duration: remaining });
		}
	}
	return result;
}

export function routePodcastSync({
	timeline,
	channelIds,
	duration,
	minCutDuration = 1,
	preRoll = 0.15,
	maxCutDuration = 0,
}: {
	timeline: Float32Array[];
	channelIds: string[];
	duration: number;
	minCutDuration?: number;
	preRoll?: number;
	maxCutDuration?: number;
}): PodcastSyncCut[] {
	const dominant = computeDominantTrack({
		timeline,
		numChannels: channelIds.length,
	});
	const cuts = dominantTrackToCuts({
		dominant,
		channelIds,
		duration,
		minCutDuration,
		preRoll,
	});
	return splitLongCuts({
		cuts: smoothCuts({ cuts, minSegment: minCutDuration }),
		maxCutDuration,
	});
}
