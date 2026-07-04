import type {
	CaptionChunk,
	TranscriptionSegment,
	TranscriptionWord,
} from "@/transcription/types";
import type { SubtitleCue } from "./types";

export const DEFAULT_CAPTION_LAYOUT = {
	wordsPerRow: 4,
	rows: 2,
	inPaddingPercent: 0,
	outPaddingPercent: 0,
};

export interface CaptionLayoutSettings {
	wordsPerRow: number;
	rows: number;
	inPaddingPercent: number;
	outPaddingPercent: number;
}

function clampInteger({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}) {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}) {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

export function normalizeCaptionLayoutSettings({
	settings,
}: {
	settings: Partial<CaptionLayoutSettings> | undefined;
}): CaptionLayoutSettings {
	return {
		wordsPerRow: clampInteger({
			value: settings?.wordsPerRow ?? DEFAULT_CAPTION_LAYOUT.wordsPerRow,
			min: 1,
			max: 12,
		}),
		rows: clampInteger({
			value: settings?.rows ?? DEFAULT_CAPTION_LAYOUT.rows,
			min: 1,
			max: 4,
		}),
		inPaddingPercent: clampNumber({
			value: settings?.inPaddingPercent ?? DEFAULT_CAPTION_LAYOUT.inPaddingPercent,
			min: 0,
			max: 100,
		}),
		outPaddingPercent: clampNumber({
			value: settings?.outPaddingPercent ?? DEFAULT_CAPTION_LAYOUT.outPaddingPercent,
			min: 0,
			max: 100,
		}),
	};
}

function paddedCaptionTime({
	startTime,
	endTime,
	settings,
}: {
	startTime: number;
	endTime: number;
	settings: CaptionLayoutSettings;
}) {
	const duration = Math.max(0.001, endTime - startTime);
	const paddedStart = Math.max(
		0,
		startTime - duration * (settings.inPaddingPercent / 100),
	);
	const paddedEnd = endTime + duration * (settings.outPaddingPercent / 100);
	return {
		startTime: paddedStart,
		endTime: Math.max(paddedEnd, paddedStart + 0.001),
	};
}

export function buildCaptionChunksFromWords({
	words,
	settings,
}: {
	words: TranscriptionWord[];
	settings: CaptionLayoutSettings;
}): CaptionChunk[] {
	const normalized = normalizeCaptionLayoutSettings({ settings });
	const wordsPerCaption = normalized.wordsPerRow * normalized.rows;
	const captions: CaptionChunk[] = [];

	for (let i = 0; i < words.length; i += wordsPerCaption) {
		const group = words.slice(i, i + wordsPerCaption);
		if (group.length === 0) continue;

		const lines: string[] = [];
		for (let lineStart = 0; lineStart < group.length; lineStart += normalized.wordsPerRow) {
			lines.push(
				group
					.slice(lineStart, lineStart + normalized.wordsPerRow)
					.map((word) => word.text)
					.join(" "),
			);
		}

		const rawStartTime = group[0].start;
		const rawEndTime = Math.max(group[group.length - 1].end, rawStartTime + 0.1);
		const { startTime, endTime } = paddedCaptionTime({
			startTime: rawStartTime,
			endTime: rawEndTime,
			settings: normalized,
		});
		captions.push({
			text: lines.join("\n"),
			startTime,
			duration: endTime - startTime,
		});
	}

	return captions;
}

export function buildCaptionChunksFromSegments({
	segments,
	settings,
}: {
	segments: TranscriptionSegment[];
	settings: CaptionLayoutSettings;
}): CaptionChunk[] {
	const words = segments.flatMap((segment) => {
		const parts = segment.text.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return [];
		const duration = Math.max(0.1, segment.end - segment.start);
		const wordDuration = duration / parts.length;
		return parts.map((text, index) => ({
			text,
			start: segment.start + index * wordDuration,
			end: segment.start + (index + 1) * wordDuration,
		}));
	});
	return buildCaptionChunksFromWords({ words, settings });
}

export function buildSubtitleCuesFromWords({
	words,
	settings,
}: {
	words: TranscriptionWord[];
	settings: CaptionLayoutSettings;
}): SubtitleCue[] {
	return buildCaptionChunksFromWords({ words, settings });
}

export function splitCaptionCuesByLayer({
	captions,
	layerCount,
}: {
	captions: SubtitleCue[];
	layerCount: number;
}): SubtitleCue[][] {
	const safeLayerCount = clampInteger({ value: layerCount, min: 1, max: 16 });
	const layers = Array.from({ length: safeLayerCount }, () => [] as SubtitleCue[]);
	const layerEnds = Array.from({ length: safeLayerCount }, () => 0);

	captions.forEach((caption, index) => {
		const captionEnd = caption.startTime + caption.duration;
		const preferredLayerIndex = index % safeLayerCount;
		let layerIndex = preferredLayerIndex;

		if (layerEnds[layerIndex] > caption.startTime) {
			layerIndex = layerEnds.findIndex(
				(end, candidateIndex) =>
					candidateIndex >= safeLayerCount && end <= caption.startTime,
			);
		}

		if (layerIndex === -1) {
			layerIndex = layers.length;
			layers.push([]);
			layerEnds.push(0);
		}
		layers[layerIndex].push(caption);
		layerEnds[layerIndex] = Math.max(layerEnds[layerIndex], captionEnd);
	});

	return layers.filter((layer) => layer.length > 0);
}
