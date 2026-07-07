import {
	buildSubtitleCuesFromWords,
	splitCaptionCuesByLayer,
	stripCaptionPunctuation,
} from "@/subtitles/caption-layout";
import {
	findCaptionSourceTrack,
	findCaptionSourceTracks,
	getGeneratedCaptionWords,
	hasSameCaptionSource,
	rebuildCaptionTracksWithSource,
} from "@/subtitles/caption-tracks";
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

interface TranscriptWordSnapshot {
	wordId?: string;
	text: string;
	start: number;
	end: number;
}

interface TextElementWithTrack {
	track: TextTrack;
	element: TextElement;
}

export function syncCaptionSourceWordsFromElements({
	tracks,
	previousTracks,
	updates,
	canvasSize,
}: {
	tracks: SceneTracks;
	previousTracks?: SceneTracks;
	updates: UpdatedElementRef[];
	canvasSize?: { width: number; height: number };
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
		if (
			previousTracks &&
			!hasElementTranscriptSemanticChange({
				previousTracks,
				nextElement: element,
				update,
			})
		) {
			continue;
		}

		const updatedWords = syncElementWords({
			sourceWords: nextWords,
			track,
			element,
			elementIndex,
			previousElement: previousTracks
				? findTextElementInTracks({
						tracks: previousTracks,
						trackId: update.trackId,
						elementId: update.elementId,
					})
				: null,
		});
		if (updatedWords !== nextWords) {
			nextWords = updatedWords;
			didChange = true;
		}
	}

	if (!didChange) return tracks;

	if (canvasSize) {
		const rebuiltTracks = rebuildCaptionTracksWithSource({
			tracks,
			words: nextWords,
			settings: source.settings,
			canvasSize,
			layerCount: source.layerCount,
			ignoredEditedElements: updates,
			preserveEditedElements: false,
		});
		if (rebuiltTracks) {
			return rebuiltTracks;
		}
	}

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

export function syncTextLayerWordsIntoCaptionSource({
	tracks,
	previousTracks,
	elements,
}: {
	tracks: SceneTracks;
	previousTracks?: SceneTracks;
	elements: UpdatedElementRef[];
}): SceneTracks {
	const sourceTrack = findCaptionSourceTrack({ tracks });
	const source = sourceTrack?.captionSource;
	if (!source) return tracks;

	const sourceTracks = findCaptionSourceTracks({ tracks, source });
	const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
	const nextManualWords = elements.flatMap((ref) => {
		if (sourceTrackIds.has(ref.trackId)) return [];
		const entry = findTextElementWithTrack({
			tracks,
			trackId: ref.trackId,
			elementId: ref.elementId,
		});
		if (!entry) return [];
		return buildTextLayerTranscriptionWords(entry);
	});
	const replacedKeys = new Set(
		elements.map(({ trackId, elementId }) => `${trackId}:${elementId}`),
	);
	const replacedElementIds = new Set(
		elements.map(({ elementId }) => elementId),
	);
	const generatedWordIndexesToReplace = previousTracks
		? getGeneratedWordIndexesForPreviousCaptionElements({
				source,
				sourceWords: source.words,
				previousTracks,
				currentSourceTrackIds: sourceTrackIds,
				elements,
			})
		: new Set<number>();
	const nextWords = sortTranscriptionWords([
		...source.words.filter((word, index) => {
			if (generatedWordIndexesToReplace.has(index)) return false;
			if (word.source?.type !== "text-layer") return true;
			return (
				!replacedKeys.has(`${word.source.trackId}:${word.source.elementId}`) &&
				!replacedElementIds.has(word.source.elementId)
			);
		}),
		...nextManualWords,
	]);
	if (areTranscriptionWordsEqual({ left: source.words, right: nextWords })) {
		return tracks;
	}

	return updateCaptionSourceWordsInTracks({
		tracks,
		source,
		words: nextWords,
	});
}

function getGeneratedWordIndexesForPreviousCaptionElements({
	source,
	sourceWords,
	previousTracks,
	currentSourceTrackIds,
	elements,
}: {
	source: NonNullable<TextTrack["captionSource"]>;
	sourceWords: TranscriptionWord[];
	previousTracks: SceneTracks;
	currentSourceTrackIds: Set<string>;
	elements: UpdatedElementRef[];
}): Set<number> {
	const previousSourceTracks = findCaptionSourceTracks({
		tracks: previousTracks,
		source,
	});
	const usedIndexes = new Set<number>();
	const indexes = new Set<number>();

	for (const ref of elements) {
		if (currentSourceTrackIds.has(ref.trackId)) continue;
		const previousElement = previousSourceTracks
			.flatMap((track) => track.elements)
			.find((element) => element.id === ref.elementId);
		if (!previousElement) continue;

		for (const entry of getElementTranscriptWordSnapshots({
			element: previousElement,
		})) {
			const sourceIndex = findSourceWordIndexForTranscriptEntry({
				sourceWords,
				entry,
				usedIndexes,
			});
			if (sourceIndex < 0) continue;
			usedIndexes.add(sourceIndex);
			indexes.add(sourceIndex);
		}
	}

	return indexes;
}

export function removeTextLayerWordsFromCaptionSource({
	tracks,
	elements,
}: {
	tracks: SceneTracks;
	elements: UpdatedElementRef[];
}): SceneTracks {
	const sourceTrack = findCaptionSourceTrack({ tracks });
	const source = sourceTrack?.captionSource;
	if (!source) return tracks;

	const removedKeys = new Set(
		elements.map(({ trackId, elementId }) => `${trackId}:${elementId}`),
	);
	const nextWords = source.words.filter((word) => {
		if (word.source?.type !== "text-layer") return true;
		return !removedKeys.has(`${word.source.trackId}:${word.source.elementId}`);
	});
	if (areTranscriptionWordsEqual({ left: source.words, right: nextWords })) {
		return tracks;
	}

	return updateCaptionSourceWordsInTracks({
		tracks,
		source,
		words: nextWords,
	});
}

function syncElementWords({
	sourceWords,
	track,
	element,
	elementIndex,
	previousElement,
}: {
	sourceWords: TranscriptionWord[];
	track: TextTrack;
	element: TextElement;
	elementIndex: number;
	previousElement: TextElement | null;
}): TranscriptionWord[] {
	const source = track.captionSource;
	if (!source) return sourceWords;
	if (previousElement) {
		const updatedWords = syncElementWordsByPreviousWordRuns({
			sourceWords,
			source,
			previousElement,
			nextElement: element,
		});
		if (updatedWords !== sourceWords) {
			return updatedWords;
		}
	}

	const generatedSourceWords = getGeneratedCaptionWords({ words: sourceWords });
	const captions = buildSubtitleCuesFromWords({
		words: generatedSourceWords,
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
		const current = nextWords[sourceIndex];
		const run = element.wordRuns?.[wordOffset];
		const renderedText = run?.text ?? contentWords[wordOffset] ?? expectedWord.text;
		const nextText =
			source.settings.hidePunctuation &&
			stripCaptionPunctuation({ text: current.text }) ===
				stripCaptionPunctuation({ text: renderedText })
				? current.text
				: renderedText;
		const nextStart =
			run?.startTime == null
				? expectedWord.start
				: elementStart + mediaTimeToSeconds({ time: run.startTime });
		const nextEnd =
			run?.endTime == null
				? expectedWord.end
				: elementStart + mediaTimeToSeconds({ time: run.endTime });

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

function syncElementWordsByPreviousWordRuns({
	sourceWords,
	source,
	previousElement,
	nextElement,
}: {
	sourceWords: TranscriptionWord[];
	source: NonNullable<TextTrack["captionSource"]>;
	previousElement: TextElement;
	nextElement: TextElement;
}): TranscriptionWord[] {
	const previousEntries = getElementTranscriptWordSnapshots({
		element: previousElement,
	});
	const nextEntries = getElementTranscriptWordSnapshots({ element: nextElement });
	if (previousEntries.length === 0 || nextEntries.length === 0) {
		return sourceWords;
	}

	const previousEntryIndexes = new Set<number>();
	const usedSourceIndexes = new Set<number>();
	const nextWords = [...sourceWords];
	let didChange = false;

	nextEntries.forEach((nextEntry, entryIndex) => {
		const previousEntry = findPreviousTranscriptEntry({
			entries: previousEntries,
			nextEntry,
			entryIndex,
			usedIndexes: previousEntryIndexes,
		});
		if (!previousEntry) return;
		const sourceIndex = findSourceWordIndexForTranscriptEntry({
			sourceWords,
			entry: previousEntry,
			usedIndexes: usedSourceIndexes,
		});
		if (sourceIndex < 0) return;
		usedSourceIndexes.add(sourceIndex);

		const current = nextWords[sourceIndex];
		const nextText =
			source.settings.hidePunctuation &&
			stripCaptionPunctuation({ text: current.text }) ===
				stripCaptionPunctuation({ text: nextEntry.text })
				? current.text
				: nextEntry.text;
		const nextWord = {
			...current,
			text: nextText,
			start: roundSeconds(nextEntry.start),
			end: roundSeconds(Math.max(nextEntry.start + 0.01, nextEntry.end)),
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

function findPreviousTranscriptEntry({
	entries,
	nextEntry,
	entryIndex,
	usedIndexes,
}: {
	entries: TranscriptWordSnapshot[];
	nextEntry: TranscriptWordSnapshot;
	entryIndex: number;
	usedIndexes: Set<number>;
}): TranscriptWordSnapshot | null {
	if (nextEntry.wordId) {
		const wordIdIndex = entries.findIndex(
			(entry, index) =>
				!usedIndexes.has(index) && entry.wordId === nextEntry.wordId,
		);
		if (wordIdIndex >= 0) {
			usedIndexes.add(wordIdIndex);
			return entries[wordIdIndex];
		}
	}

	if (entries[entryIndex] && !usedIndexes.has(entryIndex)) {
		usedIndexes.add(entryIndex);
		return entries[entryIndex];
	}

	return null;
}

function findSourceWordIndexForTranscriptEntry({
	sourceWords,
	entry,
	usedIndexes,
}: {
	sourceWords: TranscriptionWord[];
	entry: TranscriptWordSnapshot;
	usedIndexes: Set<number>;
}): number {
	const normalizedEntry = normalizeTranscriptText({ text: entry.text });
	let bestIndex = -1;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const [index, word] of sourceWords.entries()) {
		if (usedIndexes.has(index)) continue;
		if (word.source?.type === "text-layer") continue;
		if (normalizeTranscriptText({ text: word.text }) !== normalizedEntry) {
			continue;
		}
		const score = Math.abs(word.start - entry.start) + Math.abs(word.end - entry.end);
		if (score < bestScore) {
			bestIndex = index;
			bestScore = score;
		}
	}

	return bestIndex;
}

function normalizeTranscriptText({ text }: { text: string }) {
	return stripCaptionPunctuation({ text }).toLocaleLowerCase();
}

function getContentWords({ element }: { element: TextElement }) {
	const content =
		typeof element.params.content === "string" ? element.params.content : "";
	return content.trim().split(/\s+/).filter(Boolean);
}

function findTextElementWithTrack({
	tracks,
	trackId,
	elementId,
}: {
	tracks: SceneTracks;
	trackId: string;
	elementId: string;
}): TextElementWithTrack | null {
	const track = tracks.overlay.find(
		(candidate): candidate is TextTrack =>
			candidate.type === "text" && candidate.id === trackId,
	);
	const element = track?.elements.find(
		(candidate) => candidate.id === elementId,
	);
	return track && element ? { track, element } : null;
}

function buildTextLayerTranscriptionWords({
	track,
	element,
}: TextElementWithTrack): TranscriptionWord[] {
	if (element.wordRuns?.length) {
		const elementStart = mediaTimeToSeconds({ time: element.startTime });
		const elementEnd =
			elementStart + mediaTimeToSeconds({ time: element.duration });
		return element.wordRuns.map((run, wordIndex) => {
			const start =
				run.startTime == null
					? elementStart
					: elementStart + mediaTimeToSeconds({ time: run.startTime });
			const end =
				run.endTime == null
					? elementEnd
					: elementStart + mediaTimeToSeconds({ time: run.endTime });
			return {
				text: run.text,
				start: roundSeconds(start),
				end: roundSeconds(Math.max(start + 0.01, end)),
				source: {
					type: "text-layer" as const,
					trackId: track.id,
					elementId: element.id,
					wordIndex,
					wordId: run.id,
				},
			};
		});
	}

	const contentWords = getContentWords({ element });
	const elementStart = mediaTimeToSeconds({ time: element.startTime });
	const duration = mediaTimeToSeconds({ time: element.duration });
	const wordDuration = contentWords.length > 0 ? duration / contentWords.length : 0;
	return contentWords.map((text, wordIndex) => {
		const start = elementStart + wordIndex * wordDuration;
		const end = elementStart + (wordIndex + 1) * wordDuration;
		return {
			text,
			start: roundSeconds(start),
			end: roundSeconds(Math.max(start + 0.01, end)),
			source: {
				type: "text-layer" as const,
				trackId: track.id,
				elementId: element.id,
				wordIndex,
				wordId: `word-${wordIndex}`,
			},
		};
	});
}

function updateCaptionSourceWordsInTracks({
	tracks,
	source,
	words,
}: {
	tracks: SceneTracks;
	source: NonNullable<TextTrack["captionSource"]>;
	words: TranscriptionWord[];
}): SceneTracks {
	const sourceTracks = findCaptionSourceTracks({ tracks, source });
	const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
	return {
		...tracks,
		overlay: tracks.overlay.map((track) => {
			if (track.type !== "text" || !sourceTrackIds.has(track.id)) return track;
			return {
				...track,
				captionSource: track.captionSource
					? {
							...track.captionSource,
							words,
						}
					: undefined,
			};
		}),
	};
}

function sortTranscriptionWords(words: TranscriptionWord[]) {
	return [...words].sort(
		(left, right) =>
			left.start - right.start ||
			left.end - right.end ||
			left.text.localeCompare(right.text),
	);
}

function areTranscriptionWordsEqual({
	left,
	right,
}: {
	left: TranscriptionWord[];
	right: TranscriptionWord[];
}) {
	if (left.length !== right.length) return false;
	return left.every((word, index) => {
		const candidate = right[index];
		return (
			candidate?.text === word.text &&
			candidate.start === word.start &&
			candidate.end === word.end &&
			candidate.source?.type === word.source?.type &&
			candidate.source?.trackId === word.source?.trackId &&
			candidate.source?.elementId === word.source?.elementId &&
			candidate.source?.wordIndex === word.source?.wordIndex &&
			candidate.source?.wordId === word.source?.wordId
		);
	});
}

function hasElementTranscriptSemanticChange({
	previousTracks,
	nextElement,
	update,
}: {
	previousTracks: SceneTracks;
	nextElement: TextElement;
	update: UpdatedElementRef;
}) {
	const previousElement = findTextElementInTracks({
		tracks: previousTracks,
		trackId: update.trackId,
		elementId: update.elementId,
	});
	if (!previousElement) return true;
	return !areTranscriptWordSnapshotsEqual({
		left: getElementTranscriptWordSnapshots({ element: previousElement }),
		right: getElementTranscriptWordSnapshots({ element: nextElement }),
	});
}

function findTextElementInTracks({
	tracks,
	trackId,
	elementId,
}: {
	tracks: SceneTracks;
	trackId: string;
	elementId: string;
}) {
	const track = tracks.overlay.find(
		(track): track is TextTrack =>
			track.type === "text" && track.id === trackId,
	);
	return track?.elements.find((element) => element.id === elementId) ?? null;
}

function getElementTranscriptWordSnapshots({
	element,
}: {
	element: TextElement;
}): TranscriptWordSnapshot[] {
	if (element.wordRuns?.length) {
		const elementStart = mediaTimeToSeconds({ time: element.startTime });
		const elementEnd =
			elementStart + mediaTimeToSeconds({ time: element.duration });
		return element.wordRuns.map((run) => {
			const start =
				run.startTime == null
					? elementStart
					: elementStart + mediaTimeToSeconds({ time: run.startTime });
			const end =
				run.endTime == null
					? elementEnd
					: elementStart + mediaTimeToSeconds({ time: run.endTime });
			return {
				wordId: run.id,
				text: run.text,
				start: roundSeconds(start),
				end: roundSeconds(Math.max(start + 0.01, end)),
			};
		});
	}

	const contentWords = getContentWords({ element });
	const elementStart = mediaTimeToSeconds({ time: element.startTime });
	const duration = mediaTimeToSeconds({ time: element.duration });
	const wordDuration = contentWords.length > 0 ? duration / contentWords.length : 0;
	return contentWords.map((text, index) => {
		const start = elementStart + index * wordDuration;
		const end = elementStart + (index + 1) * wordDuration;
		return {
			wordId: `word-${index}`,
			text,
			start: roundSeconds(start),
			end: roundSeconds(Math.max(start + 0.01, end)),
		};
	});
}

function areTranscriptWordSnapshotsEqual({
	left,
	right,
}: {
	left: TranscriptWordSnapshot[];
	right: TranscriptWordSnapshot[];
}) {
	if (left.length !== right.length) return false;
	return left.every((word, index) => {
		const candidate = right[index];
		return (
			candidate?.text === word.text &&
			candidate.start === word.start &&
			candidate.end === word.end
		);
	});
}

function roundSeconds(value: number) {
	return Math.round(value * 1000) / 1000;
}
