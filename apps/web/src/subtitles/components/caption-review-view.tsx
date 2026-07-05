"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditor } from "@/editor/use-editor";
import {
	buildCaptionReviewWordPatch,
	collectCaptionReviewItems,
	findCaptionReviewTextElement,
	findClosestCaptionReviewItem,
	type CaptionReviewItem,
} from "@/subtitles/caption-review";
import { requestTimelineScrollToTime } from "@/timeline/focus-event";
import { mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { cn } from "@/utils/ui";
import { AlignLeft, AlignRight } from "lucide-react";

type CaptionReviewDirection = "ltr" | "rtl";

const CAPTION_REVIEW_DIRECTION_STORAGE_KEY = "opencut-caption-review-direction";

function itemKey(
	item: Pick<CaptionReviewItem, "trackId" | "elementId" | "wordIndex">,
) {
	return `${item.trackId}:${item.elementId}:${item.wordIndex}`;
}

function elementKey(item: Pick<CaptionReviewItem, "trackId" | "elementId">) {
	return `${item.trackId}:${item.elementId}`;
}

function formatTime(time: MediaTime) {
	const totalSeconds = Math.max(0, mediaTimeToSeconds({ time }));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const hundredths = Math.floor((totalSeconds % 1) * 100);
	return `${minutes}:${seconds.toString().padStart(2, "0")}.${hundredths
		.toString()
		.padStart(2, "0")}`;
}

function displayText(text: string) {
	const trimmed = text.trim();
	return trimmed.length > 0 ? trimmed : "Empty word";
}

function getInitialTextDirection(): CaptionReviewDirection {
	if (typeof window === "undefined") return "ltr";
	return window.localStorage.getItem(CAPTION_REVIEW_DIRECTION_STORAGE_KEY) ===
		"rtl"
		? "rtl"
		: "ltr";
}

function usePlaybackTime() {
	const editor = useEditor();
	const [currentTime, setCurrentTime] = useState(() =>
		editor.playback.getCurrentTime(),
	);

	useEffect(() => {
		const update = (time: MediaTime) => setCurrentTime(time);
		const unsubscribeUpdate = editor.playback.onUpdate(update);
		const unsubscribeSeek = editor.playback.onSeek(update);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor]);

	return currentTime;
}

export function CaptionReviewView() {
	const editor = useEditor();
	const activeScene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const selectedElements = useEditor((e) => e.selection.getSelectedElements());
	const currentTime = usePlaybackTime();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const endingEditKeyRef = useRef<string | null>(null);
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [textDirection, setTextDirection] = useState<CaptionReviewDirection>(
		getInitialTextDirection,
	);

	const items = useMemo(
		() =>
			activeScene
				? collectCaptionReviewItems({ tracks: activeScene.tracks })
				: [],
		[activeScene],
	);
	const closestItem = useMemo(
		() => findClosestCaptionReviewItem({ items, time: currentTime }),
		[items, currentTime],
	);
	const selectedElementKeys = useMemo(
		() =>
			new Set(
				selectedElements.map(
					({ trackId, elementId }) => `${trackId}:${elementId}`,
				),
			),
		[selectedElements],
	);

	useEffect(() => {
		if (!editingKey) return;
		const rafId = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [editingKey]);

	useEffect(() => {
		window.localStorage.setItem(
			CAPTION_REVIEW_DIRECTION_STORAGE_KEY,
			textDirection,
		);
	}, [textDirection]);

	const focusTimelineItem = (item: CaptionReviewItem) => {
		editor.selection.setSelectedElements({
			elements: [{ trackId: item.trackId, elementId: item.elementId }],
		});
		editor.playback.seek({ time: item.startTime });
		requestTimelineScrollToTime({ time: item.startTime });
	};

	const commitDraft = () => {
		if (!editingKey) return;
		if (endingEditKeyRef.current === editingKey) return;
		const item = items.find((candidate) => itemKey(candidate) === editingKey);
		if (!item) return;
		endingEditKeyRef.current = editingKey;

		if (draft !== item.text) {
			const element = activeScene
				? findCaptionReviewTextElement({
						tracks: activeScene.tracks,
						item,
					})
				: null;
			const patch = element
				? buildCaptionReviewWordPatch({
						element,
						wordIndex: item.wordIndex,
						text: draft,
					})
				: null;
			if (patch) {
				editor.timeline.updateElements({
					updates: [
						{
							trackId: item.trackId,
							elementId: item.elementId,
							patch,
						},
					],
				});
			}
		}
		setEditingKey(null);
		window.requestAnimationFrame(() => {
			if (endingEditKeyRef.current === editingKey) {
				endingEditKeyRef.current = null;
			}
		});
	};

	const startEditing = (item: CaptionReviewItem) => {
		commitDraft();
		focusTimelineItem(item);
		setEditingKey(itemKey(item));
		setDraft(item.text);
	};

	const cancelEditing = () => {
		endingEditKeyRef.current = editingKey;
		setEditingKey(null);
		setDraft("");
		window.requestAnimationFrame(() => {
			if (endingEditKeyRef.current === editingKey) {
				endingEditKeyRef.current = null;
			}
		});
	};

	return (
		<PanelView
			title="See captions"
			contentClassName="pb-3"
			actions={
				<div className="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="h-6 gap-1 rounded-sm px-1.5 text-xs"
						onClick={() =>
							setTextDirection((direction) =>
								direction === "ltr" ? "rtl" : "ltr",
							)
						}
						aria-label="Switch caption text direction"
						title="Switch caption text direction"
					>
						{textDirection === "rtl" ? (
							<AlignRight className="size-3" />
						) : (
							<AlignLeft className="size-3" />
						)}
						{textDirection.toUpperCase()}
					</Button>
					{items.length > 0 && (
						<span className="text-muted-foreground rounded-sm border px-1.5 py-0.5 text-xs tabular-nums">
							{items.length}
						</span>
					)}
				</div>
			}
		>
			<div
				dir={textDirection}
				className={cn(
					"flex w-full flex-wrap content-start gap-1.5",
					textDirection === "rtl" ? "text-right" : "text-left",
				)}
			>
				{items.length === 0 ? (
					<div className="text-muted-foreground flex h-32 w-full items-center justify-center text-sm">
						No text captions
					</div>
				) : (
					items.map((item) => {
						const key = itemKey(item);
						const isEditing = editingKey === key;
						const isClosest = closestItem
							? itemKey(closestItem) === key
							: false;
						const isSelected = selectedElementKeys.has(elementKey(item));

						if (isEditing) {
							return (
								<div
									key={key}
									className="inline-flex min-w-20 max-w-full rounded-full border border-primary/60 bg-background p-0.5"
								>
									<Input
										ref={inputRef}
										value={draft}
										onChange={(event) => setDraft(event.target.value)}
										onBlur={commitDraft}
										onKeyDown={(event) => {
											if (event.key === "Escape") {
												event.preventDefault();
												cancelEditing();
												return;
											}
											if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												commitDraft();
											}
										}}
										size="sm"
										dir={textDirection}
										className={cn(
											"h-7 rounded-full border-0 bg-transparent text-sm shadow-none focus-visible:ring-1",
											textDirection === "rtl" ? "text-right" : "text-left",
										)}
										aria-label="Edit caption word"
									/>
								</div>
							);
						}

						return (
							<button
								key={key}
								type="button"
								className={cn(
									"inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm leading-none transition-colors",
									"hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
									textDirection === "rtl" ? "text-right" : "text-left",
									isClosest
										? "border-primary/70 bg-primary/10 text-foreground ring-1 ring-primary/30"
										: "border-border bg-background",
									isSelected && "ring-1 ring-primary",
								)}
								onClick={() => startEditing(item)}
								title={formatTime(item.startTime)}
							>
								<span className="text-muted-foreground shrink-0 text-[0.62rem] tabular-nums">
									{formatTime(item.startTime)}
								</span>
								<span className="min-w-0 max-w-40 truncate">
									{displayText(item.text)}
								</span>
							</button>
						);
					})
				)}
			</div>
		</PanelView>
	);
}
