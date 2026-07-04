"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Section, SectionContent, SectionField, SectionFields } from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import type {
	TextCaptionRevealMode,
	TextElement,
	TextWordDirection,
	TextWordRun,
	TextWordStyle,
	TextWordTransitionIn,
} from "@/timeline";
import {
	CAPTION_ACCENT_COLORS,
	CAPTION_WORD_ANIMATIONS,
} from "@/text/caption-presets";
import type { ElementWithTrackForParams } from "./element-params-tab";

const REVEAL_MODES: Array<{ value: TextCaptionRevealMode; label: string }> = [
	{ value: "determined-by-preset", label: "Determined by preset" },
	{ value: "row", label: "Whole row" },
	{ value: "spoken-word", label: "Spoken word only" },
	{ value: "spoken-word-keep", label: "Spoken word, keep previous" },
	{ value: "emphasize-spoken", label: "Emphasize spoken" },
	{ value: "emphasize-spoken-keep", label: "Keep emphasized" },
	{ value: "growing-row", label: "Growing row" },
];

const TRANSITION_IN_OPTIONS: Array<{ value: TextWordTransitionIn; label: string }> = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "blur", label: "Blur build" },
	{ value: "zoom", label: "Zoom" },
	{ value: "blur-zoom", label: "Blur zoom" },
	{ value: "rise", label: "Rise" },
	{ value: "slide", label: "Slide" },
	{ value: "typewriter", label: "Type letter by letter" },
	{ value: "glow-dissolve", label: "Glow blur dissolve" },
];

const WORD_DIRECTIONS: Array<{ value: TextWordDirection; label: string }> = [
	{ value: "auto", label: "Auto" },
	{ value: "rtl", label: "Right to left" },
	{ value: "ltr", label: "Left to right" },
];

export function TextWordsTab({
	element,
	trackId,
	elementsWithTracks,
}: {
	element: TextElement;
	trackId: string;
	elementsWithTracks?: ElementWithTrackForParams[];
}) {
	const editor = useEditor();
	const wordRuns = useMemo(() => getWordRuns({ element }), [element]);
	const [selectedWordId, setSelectedWordId] = useState(wordRuns[0]?.id ?? "");
	const selectedWord = wordRuns.find((word) => word.id === selectedWordId) ?? wordRuns[0];
	const bulkTextEntries = (elementsWithTracks ?? []).filter(
		(entry): entry is ElementWithTrackForParams & { element: TextElement } =>
			entry.element.type === "text",
	);
	const isBulk = bulkTextEntries.length > 1;

	const updateElement = (patch: Partial<TextElement>) => {
		editor.timeline.updateElements({
			updates: [{ trackId, elementId: element.id, patch }],
		});
	};

	const updateSharedSettings = (patch: Partial<TextElement>) => {
		if (!isBulk) {
			updateElement({ ...patch, wordRuns });
			return;
		}
		editor.timeline.updateElements({
			updates: bulkTextEntries.map((entry) => ({
				trackId: entry.track.id,
				elementId: entry.element.id,
				patch: {
					...patch,
					wordRuns: getWordRuns({ element: entry.element }),
				},
			})),
		});
	};

	const updateWordStyle = (stylePatch: TextWordStyle) => {
		if (!selectedWord) return;
		updateElement({
			wordRuns: wordRuns.map((word) =>
				word.id === selectedWord.id
					? { ...word, style: { ...(word.style ?? {}), ...stylePatch } }
					: word,
			),
		});
	};

	const enableWordControls = () => {
		updateSharedSettings({});
	};

	return (
		<Section sectionKey={`${element.id}:words`}>
			<SectionContent className="pt-4">
				<SectionFields>
					<SectionField label="Word animation">
						<Select
							value={element.captionWordAnimationId ?? CAPTION_WORD_ANIMATIONS[0].id}
							onValueChange={(captionWordAnimationId) => {
								updateSharedSettings({
									captionWordAnimationId,
									captionAccentColor:
										element.captionAccentColor ?? CAPTION_ACCENT_COLORS[0].value,
								});
							}}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{CAPTION_WORD_ANIMATIONS.map((animation) => (
									<SelectItem key={animation.id} value={animation.id}>
										{animation.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					<SectionField label="Reveal">
						<Select
							value={element.captionRevealMode ?? "emphasize-spoken"}
							onValueChange={(captionRevealMode) =>
								updateSharedSettings({
									captionRevealMode: toRevealMode(captionRevealMode),
								})
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{REVEAL_MODES.map((mode) => (
									<SelectItem key={mode.value} value={mode.value}>
										{mode.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					{usesTransitionIn(element.captionRevealMode ?? "emphasize-spoken") && (
						<SectionField label="Transition in">
							<Select
								value={element.captionTransitionIn ?? "blur-zoom"}
								onValueChange={(captionTransitionIn) =>
									updateSharedSettings({
										captionTransitionIn: toTransitionIn(captionTransitionIn),
									})
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TRANSITION_IN_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					)}
					<SectionField label="Accent">
						<Select
							value={element.captionAccentColor ?? CAPTION_ACCENT_COLORS[0].value}
							onValueChange={(captionAccentColor) =>
								updateSharedSettings({
									captionAccentColor,
								})
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{CAPTION_ACCENT_COLORS.map((color) => (
									<SelectItem key={color.value} value={color.value}>
										{color.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					<SectionField label="Direction">
						<Select
							value={element.captionWordDirection ?? "auto"}
							onValueChange={(captionWordDirection) =>
								updateSharedSettings({
									captionWordDirection: toWordDirection(captionWordDirection),
								})
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{WORD_DIRECTIONS.map((direction) => (
									<SelectItem key={direction.value} value={direction.value}>
										{direction.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					{!isBulk && (
						<SectionField label="Word">
							<Select
								value={selectedWord?.id}
								onValueChange={setSelectedWordId}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{wordRuns.map((word) => (
										<SelectItem key={word.id} value={word.id}>
											{word.text}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					)}
					{(!element.wordRuns?.length || isBulk) && (
						<Button type="button" variant="outline" onClick={enableWordControls}>
							{isBulk ? "Apply word controls to selected layers" : "Enable word controls"}
						</Button>
					)}
					{!isBulk && selectedWord && (
						<>
							<SectionField label="Word color">
								<ColorPicker
									value={String(selectedWord.style?.color ?? element.params.color ?? "#ffffff").replace(/^#/, "").toUpperCase()}
									onChange={(color) => updateWordStyle({ color: `#${color}` })}
									onChangeEnd={(color) => updateWordStyle({ color: `#${color}` })}
								/>
							</SectionField>
							<SectionField label="Word size">
								<Input
									type="number"
									min={1}
									step={1}
									value={selectedWord.style?.fontSize ?? Number(element.params.fontSize ?? 15)}
									onChange={(event) =>
										updateWordStyle({ fontSize: Number(event.currentTarget.value) })
									}
								/>
							</SectionField>
							<SectionField label="Weight">
								<Select
									value={selectedWord.style?.fontWeight ?? String(element.params.fontWeight ?? "normal")}
									onValueChange={(fontWeight) =>
										updateWordStyle({ fontWeight: fontWeight === "bold" ? "bold" : "normal" })
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="normal">Normal</SelectItem>
										<SelectItem value="bold">Bold</SelectItem>
									</SelectContent>
								</Select>
							</SectionField>
							<SectionField label="Style">
								<Select
									value={selectedWord.style?.fontStyle ?? String(element.params.fontStyle ?? "normal")}
									onValueChange={(fontStyle) =>
										updateWordStyle({ fontStyle: fontStyle === "italic" ? "italic" : "normal" })
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="normal">Normal</SelectItem>
										<SelectItem value="italic">Italic</SelectItem>
									</SelectContent>
								</Select>
							</SectionField>
							<SectionField label="Scale">
								<Input
									type="number"
									min={0.1}
									step={0.05}
									value={selectedWord.style?.scale ?? 1}
									onChange={(event) =>
										updateWordStyle({ scale: Number(event.currentTarget.value) })
									}
								/>
							</SectionField>
						</>
					)}
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function toWordDirection(value: string): TextWordDirection {
	return value === "rtl" || value === "ltr" ? value : "auto";
}

function toRevealMode(value: string): TextCaptionRevealMode {
	return value === "determined-by-preset" ||
		value === "row" ||
		value === "spoken-word" ||
		value === "spoken-word-keep" ||
		value === "emphasize-spoken" ||
		value === "emphasize-spoken-keep" ||
		value === "growing-row"
		? value
		: "emphasize-spoken";
}

function toTransitionIn(value: string): TextWordTransitionIn {
	return value === "none" ||
		value === "fade" ||
		value === "blur" ||
		value === "zoom" ||
		value === "blur-zoom" ||
		value === "rise" ||
		value === "slide" ||
		value === "typewriter" ||
		value === "glow-dissolve"
		? value
		: "blur-zoom";
}

function usesTransitionIn(revealMode: TextCaptionRevealMode): boolean {
	return revealMode === "spoken-word" || revealMode === "spoken-word-keep";
}

function getWordRuns({ element }: { element: TextElement }): TextWordRun[] {
	if (element.wordRuns?.length) {
		return element.wordRuns;
	}
	const content = typeof element.params.content === "string" ? element.params.content : "";
	let index = 0;
	return content.split("\n").flatMap((line, lineIndex) =>
		line
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((text) => ({
				id: `word-${index++}`,
				text,
				lineIndex,
			})),
	);
}
