import {
	buildSubtitleCuesFromWords,
	splitCaptionCuesByLayer,
} from "@/subtitles/caption-layout";
import type {
	OverlayTrack,
	SceneTracks,
	TextElement,
	TextTrack,
} from "@/timeline";
import type { TranscriptionWord } from "@/transcription/types";
import { mediaTimeToSeconds } from "@/wasm";

interface UpdatedElementRef {
	trackId: string;
	elementId: string;
}

export function syncCaptionSourceWordsFromElements({
	tracks,
	updates,
}: {
	tracks: SceneTracks;
	updates: UpdatedElementRef[];
}): SceneTracks {
	const sourceTrack = findCaptionSourceTrack({ tracks });
	const source = sourceTrack?.captionSource;
	if (!source) return tracks;

	let nextWords = source.words;
	let didChange = false;
	const sourceTracks = findCaptionSourceTracks({ tracks, source });

	for (const update of updates) {
		const track = sourceTracks.find(
			(candidate) => candidate.id === update.trackId,
		);
		const elementIndex =
			track?.elements.findIndex((element) => element.id === update.elementId) ??
			-1;
		const element =
			elementIndex >= 0 ? track?.elements[elementIndex] : undefined;
		if (!track || !element) continue;

		const updatedWords = syncElementWords({
			sourceWords: nextWords,
			track,
			element,
			elementIndex,
		});
		if (updatedWords !== nextWords) {
			nextWords = updatedWords;
			didChange = true;
		}
	}

	if (!didChange) return tracks;

	const withUpdatedSource = (track: OverlayTrack): OverlayTrack => {
		if (track.type !== "text" || !track.captionSource) return track;
		if (!hasSameCaptionSource({ track, source })) return track;
		return {
			...track,
			captionSource: {
				...track.captionSource,
				words: nextWords,
			},
		};
	};

	return {
		...tracks,
		overlay: tracks.overlay.map(withUpdatedSource),
	};
}

function syncElementWords({
	sourceWords,
	track,
	element,
	elementIndex,
}: {
	sourceWords: TranscriptionWord[];
	track: TextTrack;
	element: TextElement;
	elementIndex: number;
}): TranscriptionWord[] {
	const source = track.captionSource;
	if (!source) return sourceWords;
	const captions = buildSubtitleCuesFromWords({
		words: sourceWords,
		settings: source.settings,
	});
	const layers = splitCaptionCuesByLayer({
		captions,
		layerCount: source.layerCount ?? 1,
	});
	const expectedCaption = layers[source.layerIndex ?? 0]?.[elementIndex];
	if (!expectedCaption?.words?.length) return sourceWords;

	const elementStart = mediaTimeToSeconds({ time: element.startTime });
	const contentWords = getContentWords({ element });
	const nextWords = [...sourceWords];
	let didChange = false;

	expectedCaption.words.forEach((expectedWord, wordOffset) => {
		const sourceIndex = sourceWords.findIndex((word) => word === expectedWord);
		if (sourceIndex < 0) return;
		const run = element.wordRuns?.[wordOffset];
		const nextText = run?.text ?? contentWords[wordOffset] ?? expectedWord.text;
		const nextStart =
			run?.startTime == null
				? expectedWord.start
				: elementStart + mediaTimeToSeconds({ time: run.startTime });
		const nextEnd =
			run?.endTime == null
				? expectedWord.end
				: elementStart + mediaTimeToSeconds({ time: run.endTime });

		const current = nextWords[sourceIndex];
		const nextWord = {
			...current,
			text: nextText,
			start: roundSeconds(nextStart),
			end: roundSeconds(Math.max(nextStart + 0.01, nextEnd)),
		};
		if (
			nextWord.text !== current.text ||
			nextWord.start !== current.start ||
			nextWord.end !== current.end
		) {
			nextWords[sourceIndex] = nextWord;
			didChange = true;
		}
	});

	return didChange ? nextWords : sourceWords;
}

function getContentWords({ element }: { element: TextElement }) {
	const content =
		typeof element.params.content === "string" ? element.params.content : "";
	return content.trim().split(/\s+/).filter(Boolean);
}

function findCaptionSourceTrack({
	tracks,
}: {
	tracks: SceneTracks;
}): TextTrack | null {
	return (
		tracks.overlay.find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		) ?? null
	);
}

function findCaptionSourceTracks({
	tracks,
	source,
}: {
	tracks: SceneTracks;
	source: NonNullable<TextTrack["captionSource"]>;
}): TextTrack[] {
	return tracks.overlay.filter(
		(track): track is TextTrack =>
			track.type === "text" && hasSameCaptionSource({ track, source }),
	);
}

function hasSameCaptionSource({
	track,
	source,
}: {
	track: TextTrack;
	source: NonNullable<TextTrack["captionSource"]>;
}) {
	const candidate = track.captionSource;
	if (!candidate) return false;
	if (candidate.words.length !== source.words.length) return false;
	const firstCandidate = candidate.words[0];
	const firstSource = source.words[0];
	const lastCandidate = candidate.words[candidate.words.length - 1];
	const lastSource = source.words[source.words.length - 1];
	return (
		firstCandidate?.text === firstSource?.text &&
		firstCandidate?.start === firstSource?.start &&
		lastCandidate?.text === lastSource?.text &&
		lastCandidate?.end === lastSource?.end
	);
}

function roundSeconds(value: number) {
	return Math.round(value * 1000) / 1000;
}
