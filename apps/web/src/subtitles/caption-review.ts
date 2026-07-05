import {
	getDisplayTracks,
	type SceneTracks,
	type TextElement,
	type TextTrack,
} from "@/timeline";
import {
	addMediaTime,
	mediaTime,
	type MediaTime,
} from "@/wasm";

export interface CaptionReviewItem {
	trackId: string;
	trackName: string;
	trackIndex: number;
	elementId: string;
	elementIndex: number;
	wordIndex: number;
	text: string;
	startTime: MediaTime;
	duration: MediaTime;
	isCaptionSource: boolean;
}

interface ContentWord {
	text: string;
	lineIndex: number;
}

function getTextContent({ element }: { element: TextElement }) {
	return typeof element.params.content === "string" ? element.params.content : "";
}

function contentWordsFromText({ content }: { content: string }): ContentWord[] {
	return content.split("\n").flatMap((line, lineIndex) => {
		const words = line.match(/\S+/g) ?? [];
		return words.map((text) => ({ text, lineIndex }));
	});
}

function contentFromWords({ words }: { words: ContentWord[] }) {
	const rows = new Map<number, string[]>();
	for (const word of words) {
		rows.set(word.lineIndex, [...(rows.get(word.lineIndex) ?? []), word.text]);
	}
	return [...rows.entries()]
		.sort(([left], [right]) => left - right)
		.map(([, rowWords]) => rowWords.filter(Boolean).join(" "))
		.join("\n");
}

function wordTiming({
	element,
	wordIndex,
	wordCount,
	startTime,
	endTime,
}: {
	element: TextElement;
	wordIndex: number;
	wordCount: number;
	startTime?: MediaTime;
	endTime?: MediaTime;
}) {
	const fallbackDuration = wordCount > 0 ? element.duration / wordCount : 0;
	const relativeStartTime =
		startTime ??
		mediaTime({ ticks: Math.round(wordIndex * fallbackDuration) });
	const fallbackEndTime = mediaTime({
		ticks: Math.round((wordIndex + 1) * fallbackDuration),
	});
	const relativeEndTime =
		endTime && endTime > relativeStartTime ? endTime : fallbackEndTime;

	return {
		startTime: addMediaTime({
			a: element.startTime,
			b: relativeStartTime,
		}),
		duration: mediaTime({
			ticks: Math.max(1, Math.round(relativeEndTime - relativeStartTime)),
		}),
	};
}

function collectElementWords({
	track,
	trackIndex,
	element,
	elementIndex,
}: {
	track: TextTrack;
	trackIndex: number;
	element: TextElement;
	elementIndex: number;
}): CaptionReviewItem[] {
	const wordRuns = element.wordRuns;
	if (wordRuns?.length) {
		return wordRuns.flatMap((run, wordIndex) => {
			const timing = wordTiming({
				element,
				wordIndex,
				wordCount: wordRuns.length,
				startTime: run.startTime,
				endTime: run.endTime,
			});
			return [
				{
					trackId: track.id,
					trackName: track.name,
					trackIndex,
					elementId: element.id,
					elementIndex,
					wordIndex,
					text: run.text,
					startTime: timing.startTime,
					duration: timing.duration,
					isCaptionSource: Boolean(track.captionSource),
				},
			];
		});
	}

	const words = contentWordsFromText({ content: getTextContent({ element }) });
	return words.map((word, wordIndex) => {
		const timing = wordTiming({
			element,
			wordIndex,
			wordCount: words.length,
		});
		return {
			trackId: track.id,
			trackName: track.name,
			trackIndex,
			elementId: element.id,
			elementIndex,
			wordIndex,
			text: word.text,
			startTime: timing.startTime,
			duration: timing.duration,
			isCaptionSource: Boolean(track.captionSource),
		};
	});
}

export function collectCaptionReviewItems({
	tracks,
}: {
	tracks: SceneTracks;
}): CaptionReviewItem[] {
	return getDisplayTracks({ tracks })
		.flatMap((track, trackIndex) => {
			if (track.type !== "text") return [];
			const textTrack = track as TextTrack;
			return textTrack.elements.flatMap((element, elementIndex) =>
				collectElementWords({
					track: textTrack,
					trackIndex,
					element,
					elementIndex,
				}),
			);
		})
		.sort(
			(left, right) =>
				left.startTime - right.startTime ||
				left.trackIndex - right.trackIndex ||
				left.elementIndex - right.elementIndex ||
				left.wordIndex - right.wordIndex,
		);
}

export function findCaptionReviewTextElement({
	tracks,
	item,
}: {
	tracks: SceneTracks;
	item: Pick<CaptionReviewItem, "trackId" | "elementId">;
}): TextElement | null {
	const track = getDisplayTracks({ tracks }).find(
		(candidate): candidate is TextTrack =>
			candidate.type === "text" && candidate.id === item.trackId,
	);
	return (
		track?.elements.find((element) => element.id === item.elementId) ?? null
	);
}

function normalizeEditedWordText({ text }: { text: string }) {
	return text.replace(/\s+/g, " ").trim();
}

export function buildCaptionReviewWordPatch({
	element,
	wordIndex,
	text,
}: {
	element: TextElement;
	wordIndex: number;
	text: string;
}): Partial<TextElement> | null {
	const nextText = normalizeEditedWordText({ text });
	if (element.wordRuns?.[wordIndex]) {
		const nextWordRuns = element.wordRuns.map((run, index) =>
			index === wordIndex
				? {
						...run,
						text: nextText,
					}
				: run,
		);
		return {
			params: {
				content: contentFromWords({
					words: nextWordRuns.map((run) => ({
						text: run.text,
						lineIndex: run.lineIndex,
					})),
				}),
			},
			wordRuns: nextWordRuns,
		};
	}

	const words = contentWordsFromText({ content: getTextContent({ element }) });
	if (!words[wordIndex]) return null;
	return {
		params: {
			content: contentFromWords({
				words: words.map((word, index) =>
					index === wordIndex
						? {
								...word,
								text: nextText,
							}
						: word,
				),
			}),
		},
	};
}

function distanceFromItem({
	item,
	time,
}: {
	item: CaptionReviewItem;
	time: MediaTime;
}) {
	const endTime = addMediaTime({ a: item.startTime, b: item.duration });
	if (time < item.startTime) return item.startTime - time;
	if (time > endTime) return time - endTime;
	return 0;
}

export function findClosestCaptionReviewItem({
	items,
	time,
}: {
	items: CaptionReviewItem[];
	time: MediaTime;
}): CaptionReviewItem | null {
	return (
		items.reduce<CaptionReviewItem | null>((closest, item) => {
			if (!closest) return item;
			const itemDistance = distanceFromItem({ item, time });
			const closestDistance = distanceFromItem({ item: closest, time });
			return itemDistance < closestDistance ? item : closest;
		}, null) ?? null
	);
}
