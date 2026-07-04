"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import {
	findCaptionSourceTrack,
	updateCaptionSourceWords,
} from "@/subtitles/caption-tracks";
import type { TextElement, TextTrack } from "@/timeline";
import { getTimelinePixelsPerSecond, timelineTimeToPixels } from "@/timeline";
import type { TranscriptionWord } from "@/transcription/types";
import { cn } from "@/utils/ui";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	type MediaTime,
} from "@/wasm";

export const CAPTION_WORD_TIMING_TRACK_HEIGHT_PX = 42;

type WordDragMode = "move" | "left" | "right";

interface WordCoverageIssue {
	key: string;
	wordIndex: number;
	side: "left" | "right";
	time: number;
	element: TextElement;
	track: TextTrack;
}

interface CaptionWordTimingTrackProps {
	zoomLevel: number;
	dynamicTimelineWidth: number;
	onMouseDown?: (event: React.MouseEvent) => void;
	onMouseUp?: (event: React.MouseEvent) => void;
}

export function CaptionWordTimingTrack({
	zoomLevel,
	dynamicTimelineWidth,
	onMouseDown,
	onMouseUp,
}: CaptionWordTimingTrackProps) {
	const editor = useEditor();
	const scene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const rowRef = useRef<HTMLDivElement>(null);
	const [dragPreview, setDragPreview] = useState<{
		wordIndex: number;
		start: number;
		end: number;
	} | null>(null);

	const sourceTrack = useMemo(
		() => (scene ? findCaptionSourceTrack({ tracks: scene.tracks }) : null),
		[scene],
	);
	const source = sourceTrack?.captionSource;
	const words = useMemo(() => source?.words ?? [], [source]);

	const issues = useMemo(
		() =>
			scene && sourceTrack
				? getWordCoverageIssues({
						words,
						sourceTrack,
						sourceTracks: scene.tracks.overlay.filter(
							(track): track is TextTrack =>
								track.type === "text" &&
								!!track.captionSource &&
								track.captionSource.words.length === words.length,
						),
					})
				: [],
		[scene, sourceTrack, words],
	);

	const commitWords = useCallback(
		(nextWords: TranscriptionWord[]) => {
			if (!source) return;
			updateCaptionSourceWords({
				editor,
				words: nextWords,
				settings: source.settings,
			});
		},
		[editor, source],
	);

	const updateWord = useCallback(
		({
			wordIndex,
			update,
		}: {
			wordIndex: number;
			update: (word: TranscriptionWord) => TranscriptionWord;
		}) => {
			const current = words[wordIndex];
			if (!current) return;
			commitWords(
				words.map((word, index) => (index === wordIndex ? update(word) : word)),
			);
		},
		[commitWords, words],
	);

	const beginWordDrag = useCallback(
		({
			event,
			wordIndex,
			mode,
		}: {
			event: React.MouseEvent;
			wordIndex: number;
			mode: WordDragMode;
		}) => {
			const word = words[wordIndex];
			if (!word || !rowRef.current) return;
			event.preventDefault();
			event.stopPropagation();

			const startClientX = event.clientX;
			const startWord = { start: word.start, end: word.end };
			const pixelsPerSecond = getTimelinePixelsPerSecond({ zoomLevel });
			setDragPreview({ wordIndex, ...startWord });

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const deltaSeconds =
					(moveEvent.clientX - startClientX) / pixelsPerSecond;
				const minDuration = 0.01;
				let nextStart = startWord.start;
				let nextEnd = startWord.end;

				if (mode === "move") {
					const duration = startWord.end - startWord.start;
					nextStart = Math.max(0, startWord.start + deltaSeconds);
					nextEnd = nextStart + duration;
				} else if (mode === "left") {
					nextStart = Math.max(
						0,
						Math.min(
							startWord.start + deltaSeconds,
							startWord.end - minDuration,
						),
					);
				} else {
					nextEnd = Math.max(
						startWord.start + minDuration,
						startWord.end + deltaSeconds,
					);
				}

				setDragPreview({ wordIndex, start: nextStart, end: nextEnd });
			};

			const handleMouseUp = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
				setDragPreview((preview) => {
					if (preview) {
						updateWord({
							wordIndex,
							update: (current) => ({
								...current,
								start: roundSeconds(preview.start),
								end: roundSeconds(Math.max(preview.start + 0.01, preview.end)),
							}),
						});
					}
					return null;
				});
			};

			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[updateWord, words, zoomLevel],
	);

	const editWordText = useCallback(
		({ wordIndex }: { wordIndex: number }) => {
			const word = words[wordIndex];
			if (!word) return;
			const nextText = window.prompt("Edit transcript word", word.text);
			if (nextText === null) return;
			const trimmed = nextText.trim();
			if (!trimmed) return;
			updateWord({
				wordIndex,
				update: (current) => ({ ...current, text: trimmed }),
			});
		},
		[updateWord, words],
	);

	const extendCaptionToIssue = useCallback(
		({ issue }: { issue: WordCoverageIssue }) => {
			const elementStart = mediaTimeToSeconds({
				time: issue.element.startTime,
			});
			const elementEnd =
				elementStart + mediaTimeToSeconds({ time: issue.element.duration });
			const nextStart = issue.side === "left" ? issue.time : elementStart;
			const nextEnd = issue.side === "right" ? issue.time : elementEnd;
			const nextElement = {
				...issue.element,
				startTime: mediaTimeFromSeconds({ seconds: nextStart }),
				duration: mediaTimeFromSeconds({
					seconds: Math.max(0.01, nextEnd - nextStart),
				}),
			};
			editor.timeline.updateElements({
				updates: [
					{
						trackId: issue.track.id,
						elementId: issue.element.id,
						patch: nextElement,
					},
				],
			});
		},
		[editor],
	);

	if (!source || words.length === 0) {
		return null;
	}

	return (
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- timeline timing row is a spatial gesture surface; individual words and tips are native buttons.
		<div
			ref={rowRef}
			className="relative border-b border-red-500/20 bg-red-950/10"
			style={{
				width: `${dynamicTimelineWidth}px`,
				height: `${CAPTION_WORD_TIMING_TRACK_HEIGHT_PX}px`,
			}}
			onMouseDown={onMouseDown}
			onMouseUp={onMouseUp}
			aria-label="Transcript word timing track"
		>
			<div className="absolute inset-y-0 left-0 flex items-center px-2 text-[10px] font-medium uppercase text-red-200/70 pointer-events-none">
				Words
			</div>
			{words.map((word, index) => {
				const preview =
					dragPreview?.wordIndex === index
						? dragPreview
						: { start: word.start, end: word.end };
				const left = timelineTimeToPixels({
					time: secondsToMediaTime(preview.start),
					zoomLevel,
				});
				const width = Math.max(
					8,
					timelineTimeToPixels({
						time: secondsToMediaTime(
							Math.max(0.01, preview.end - preview.start),
						),
						zoomLevel,
					}),
				);

				return (
					<div
						key={`${index}-${word.text}`}
						className={cn(
							"absolute top-1 bottom-1 overflow-hidden rounded-sm border border-red-300/40 bg-red-500/20 text-red-50 shadow-sm",
							dragPreview?.wordIndex === index &&
								"border-red-100 bg-red-500/35",
						)}
						style={{ left, width }}
						title={`${word.text} ${word.start.toFixed(2)}s-${word.end.toFixed(2)}s`}
						onDoubleClick={() => editWordText({ wordIndex: index })}
					>
						<button
							type="button"
							className="absolute inset-y-0 left-0 w-2 cursor-w-resize"
							aria-label={`Adjust start of ${word.text}`}
							onMouseDown={(event) =>
								beginWordDrag({ event, wordIndex: index, mode: "left" })
							}
						/>
						<button
							type="button"
							className="absolute inset-y-0 right-0 w-2 cursor-e-resize"
							aria-label={`Adjust end of ${word.text}`}
							onMouseDown={(event) =>
								beginWordDrag({ event, wordIndex: index, mode: "right" })
							}
						/>
						<button
							type="button"
							className="flex size-full cursor-grab items-center justify-center px-2 text-[11px] leading-none"
							onMouseDown={(event) =>
								beginWordDrag({ event, wordIndex: index, mode: "move" })
							}
							aria-label={`Move ${word.text}`}
						>
							<span className="truncate">{word.text}</span>
						</button>
					</div>
				);
			})}
			{issues.map((issue) => {
				const left = timelineTimeToPixels({
					time: secondsToMediaTime(issue.time),
					zoomLevel,
				});
				return (
					<button
						key={issue.key}
						type="button"
						className="absolute top-0 bottom-0 z-20 w-2 -translate-x-1/2 bg-red-500 shadow-[0_0_0_1px_rgba(255,255,255,0.55)]"
						style={{ left }}
						title="Caption layer ends before this word timing. Click to extend it."
						aria-label="Extend caption layer to word timing"
						onClick={(event) => {
							event.stopPropagation();
							extendCaptionToIssue({ issue });
						}}
					/>
				);
			})}
		</div>
	);
}

function getWordCoverageIssues({
	words,
	sourceTrack,
	sourceTracks,
}: {
	words: TranscriptionWord[];
	sourceTrack: TextTrack;
	sourceTracks: TextTrack[];
}): WordCoverageIssue[] {
	const issues: WordCoverageIssue[] = [];
	const source = sourceTrack.captionSource;
	if (!source) return issues;

	for (const track of sourceTracks) {
		for (const element of track.elements) {
			const elementStart = mediaTimeToSeconds({ time: element.startTime });
			const elementEnd =
				elementStart + mediaTimeToSeconds({ time: element.duration });
			for (const run of element.wordRuns ?? []) {
				const runStart =
					run.startTime == null
						? elementStart
						: elementStart + mediaTimeToSeconds({ time: run.startTime });
				const runEnd =
					run.endTime == null
						? elementEnd
						: elementStart + mediaTimeToSeconds({ time: run.endTime });
				const wordIndex = findWordIndexForRun({ words, run, runStart, runEnd });
				if (wordIndex < 0) continue;

				if (runStart < elementStart - 0.001) {
					issues.push({
						key: `${track.id}-${element.id}-${run.id}-left`,
						wordIndex,
						side: "left",
						time: runStart,
						element,
						track,
					});
				}
				if (runEnd > elementEnd + 0.001) {
					issues.push({
						key: `${track.id}-${element.id}-${run.id}-right`,
						wordIndex,
						side: "right",
						time: runEnd,
						element,
						track,
					});
				}
			}
		}
	}

	return issues;
}

function findWordIndexForRun({
	words,
	run,
	runStart,
	runEnd,
}: {
	words: TranscriptionWord[];
	run: NonNullable<TextElement["wordRuns"]>[number];
	runStart: number;
	runEnd: number;
}) {
	const normalizedText = normalizeWord(run.text);
	let bestIndex = -1;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (normalizeWord(word.text) !== normalizedText) continue;
		const score = Math.abs(word.start - runStart) + Math.abs(word.end - runEnd);
		if (score < bestScore) {
			bestIndex = index;
			bestScore = score;
		}
	}
	return bestIndex;
}

function normalizeWord(value: string) {
	return value.trim().toLocaleLowerCase();
}

function secondsToMediaTime(seconds: number): MediaTime {
	return mediaTimeFromSeconds({ seconds: Math.max(0, seconds) });
}

function roundSeconds(value: number) {
	return Math.round(value * 1000) / 1000;
}
