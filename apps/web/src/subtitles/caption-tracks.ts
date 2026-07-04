import { TracksSnapshotCommand } from "@/commands";
import type { EditorCore } from "@/core";
import {
	buildCaptionChunksFromWords,
	buildSubtitleCuesFromWords,
	splitCaptionCuesByLayer,
	type CaptionLayoutSettings,
} from "@/subtitles/caption-layout";
import { buildCaptionTextTracks } from "@/subtitles/insert";
import type { SceneTracks, TextElement, TextTrack } from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement";
import type { TranscriptionWord } from "@/transcription/types";
import { generateUUID } from "@/utils/id";
import { mediaTimeToSeconds } from "@/wasm";

const TIMING_EPSILON_SECONDS = 0.002;

export function hasSameCaptionSource({
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

export function findCaptionSourceTrack({
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

export function findCaptionSourceTracks({
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

function textElementContent(element: TextElement) {
	return typeof element.params.content === "string"
		? element.params.content
		: "";
}

function isPristineGeneratedCaption({
	element,
	expected,
}: {
	element: TextElement;
	expected: { text: string; startTime: number; duration: number } | undefined;
}) {
	if (!expected) return false;
	return (
		textElementContent(element) === expected.text &&
		Math.abs(
			mediaTimeToSeconds({ time: element.startTime }) - expected.startTime,
		) <= TIMING_EPSILON_SECONDS &&
		Math.abs(
			mediaTimeToSeconds({ time: element.duration }) - expected.duration,
		) <= TIMING_EPSILON_SECONDS &&
		mediaTimeToSeconds({ time: element.trimStart }) === 0 &&
		mediaTimeToSeconds({ time: element.trimEnd }) === 0
	);
}

function buildEditedCaptionTracks({
	sourceTracks,
}: {
	sourceTracks: TextTrack[];
}) {
	return sourceTracks.flatMap((track) => {
		const source = track.captionSource;
		if (!source) return [];

		const previousCaptions = buildSubtitleCuesFromWords({
			words: source.words,
			settings: source.settings,
		});
		const previousLayers = splitCaptionCuesByLayer({
			captions: previousCaptions,
			layerCount: source.layerCount ?? 1,
		});
		const expectedLayer = previousLayers[source.layerIndex ?? 0] ?? [];
		const editedElements = track.elements.filter(
			(element, index) =>
				!isPristineGeneratedCaption({
					element,
					expected: expectedLayer[index],
				}),
		);

		if (editedElements.length === 0) return [];

		return [
			{
				...buildEmptyTrack({
					id: generateUUID(),
					type: "text",
					name: `Edited ${track.name}`,
				}),
				hidden: track.hidden,
				elements: editedElements,
			},
		];
	});
}

export function rebuildCaptionTracksWithSource({
	tracks,
	words,
	settings,
	canvasSize,
	layerCount,
}: {
	tracks: SceneTracks;
	words: TranscriptionWord[];
	settings: CaptionLayoutSettings;
	canvasSize: { width: number; height: number };
	layerCount?: number;
}): SceneTracks | null {
	const firstSourceTrack = findCaptionSourceTrack({ tracks });
	const source = firstSourceTrack?.captionSource;
	if (!source) return null;

	const sourceTracks = findCaptionSourceTracks({ tracks, source });
	const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
	const editedTracks = buildEditedCaptionTracks({ sourceTracks });
	const captions = buildCaptionChunksFromWords({
		words,
		settings,
	});
	const regeneratedTracks = buildCaptionTextTracks({
		captions,
		captionSource: {
			...source,
			words,
			settings,
		},
		layerCount: layerCount ?? source.layerCount ?? 1,
		canvasSize,
	});

	return {
		...tracks,
		overlay: [
			...regeneratedTracks,
			...editedTracks,
			...tracks.overlay.filter((track) => !sourceTrackIds.has(track.id)),
		],
	};
}

export function updateCaptionSourceWords({
	editor,
	words,
	settings,
}: {
	editor: EditorCore;
	words: TranscriptionWord[];
	settings?: CaptionLayoutSettings;
}) {
	const activeScene = editor.scenes.getActiveSceneOrNull();
	if (!activeScene) return false;
	const sourceTrack = findCaptionSourceTrack({ tracks: activeScene.tracks });
	const source = sourceTrack?.captionSource;
	if (!source) return false;
	const nextSettings = settings ?? source.settings;
	const after = rebuildCaptionTracksWithSource({
		tracks: activeScene.tracks,
		words,
		settings: nextSettings,
		canvasSize: editor.project.getActive().settings.canvasSize,
		layerCount: source.layerCount,
	});
	if (!after) return false;
	editor.command.execute({
		command: new TracksSnapshotCommand({
			before: activeScene.tracks,
			after,
		}),
	});
	return true;
}
