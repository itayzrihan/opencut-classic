import type {
	CaptionChunk,
	TranscriptionSegment,
	TranscriptionWord,
} from "@/transcription/types";
import type { SubtitleCue } from "./types";

export const DEFAULT_CAPTION_LAYOUT = {
	wordsPerRow: 4,
	rows: 2,
};

export interface CaptionLayoutSettings {
	wordsPerRow: number;
	rows: number;
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

		const startTime = group[0].start;
		const endTime = Math.max(group[group.length - 1].end, startTime + 0.1);
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
