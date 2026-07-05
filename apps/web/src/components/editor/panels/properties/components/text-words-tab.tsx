"use client";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import type { TextElement } from "@/timeline";
import {
	CAPTION_ACCENT_COLORS,
	CAPTION_WORD_ANIMATIONS,
} from "@/text/caption-presets";
import type { ElementWithTrackForParams } from "./element-params-tab";
import {
	buildScopedTextPatch,
	clearScopedTextOverride,
	getScopedSettings,
	getWordRuns,
	hasScopedTextOverride,
	type TextOverrideScope,
	type TextScopedSettings,
} from "../text-scope";
import {
	REVEAL_MODES,
	TRANSITION_IN_OPTIONS,
	WORD_DIRECTIONS,
	toRevealMode,
	toTransitionIn,
	toWordDirection,
	usesTransitionIn,
} from "../text-word-controls";

export function TextWordsTab({
	element,
	trackId,
	elementsWithTracks,
	textScope,
}: {
	element: TextElement;
	trackId: string;
	elementsWithTracks?: ElementWithTrackForParams[];
	textScope?: TextOverrideScope;
}) {
	const editor = useEditor();
	const scope = textScope ?? { type: "layer" as const };
	const bulkTextEntries = (elementsWithTracks ?? []).filter(
		(entry): entry is ElementWithTrackForParams & { element: TextElement } =>
			entry.element.type === "text",
	);
	const isBulk = bulkTextEntries.length > 1;
	const isBulkWordScope = isBulk && scope.type === "words";
	const effectiveScope =
		isBulk && !isBulkWordScope ? ({ type: "layer" } as const) : scope;
	const settings = getScopedSettings({ element, scope: effectiveScope });
	const values = {
		wordAnimationId:
			settings.wordAnimationId ?? CAPTION_WORD_ANIMATIONS[0]?.id ?? "",
		revealMode: settings.revealMode ?? "emphasize-spoken",
		transitionIn: settings.transitionIn ?? "blur-zoom",
		accentColor: settings.accentColor ?? CAPTION_ACCENT_COLORS[0]?.value ?? "",
		wordDirection: settings.wordDirection ?? "auto",
	};
	const hasOverride =
		effectiveScope.type !== "layer" &&
		hasScopedTextOverride({ element, scope: effectiveScope });

	const applyPatchToElement = ({
		targetElement,
		scope,
		patch,
	}: {
		targetElement: TextElement;
		scope: TextOverrideScope;
		patch: TextScopedSettings;
	}) => {
		const scopedPatch = buildScopedTextPatch({
			element: targetElement,
			scope,
			patch,
		});
		if (scope.type === "layer") {
			return {
				...scopedPatch,
				wordRuns: getWordRuns({ element: targetElement }),
			};
		}
		return scopedPatch;
	};

	const updateScopedSettings = (patch: TextScopedSettings) => {
		if (isBulk) {
			editor.timeline.updateElements({
				updates: bulkTextEntries.flatMap((entry) => {
					const entryScope = isBulkWordScope
						? resolveTextScopeForEntry({ scope, entry })
						: ({ type: "layer" } as const);
					if (!entryScope) return [];
					return [
						{
							trackId: entry.track.id,
							elementId: entry.element.id,
							patch: applyPatchToElement({
								targetElement: entry.element,
								scope: entryScope,
								patch,
							}),
						},
					];
				}),
			});
			return;
		}

		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: applyPatchToElement({
						targetElement: element,
						scope: effectiveScope,
						patch,
					}),
				},
			],
		});
	};

	const clearOverride = () => {
		if (effectiveScope.type === "layer") return;
		if (effectiveScope.type === "words" && isBulkWordScope) {
			editor.timeline.updateElements({
				updates: bulkTextEntries.flatMap((entry) => {
					const entryScope = resolveTextScopeForEntry({ scope, entry });
					if (!entryScope) return [];
					return [
						{
							trackId: entry.track.id,
							elementId: entry.element.id,
							patch: clearScopedTextOverride({
								element: entry.element,
								scope: entryScope,
							}),
						},
					];
				}),
			});
			return;
		}
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: clearScopedTextOverride({
						element,
						scope: effectiveScope,
					}),
				},
			],
		});
	};

	return (
		<Section sectionKey={`${element.id}:words`}>
			<SectionContent className="pt-4">
				<SectionFields>
					<SectionField label="Word animation">
						<Select
							value={values.wordAnimationId}
							onValueChange={(wordAnimationId) =>
								updateScopedSettings({ wordAnimationId })
							}
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
							value={values.revealMode}
							onValueChange={(revealMode) =>
								updateScopedSettings({
									revealMode: toRevealMode(revealMode),
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

					{usesTransitionIn(values.revealMode) && (
						<SectionField label="Transition in">
							<Select
								value={values.transitionIn}
								onValueChange={(transitionIn) =>
									updateScopedSettings({
										transitionIn: toTransitionIn(transitionIn),
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
							value={values.accentColor}
							onValueChange={(accentColor) =>
								updateScopedSettings({ accentColor })
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
							value={values.wordDirection}
							onValueChange={(wordDirection) =>
								updateScopedSettings({
									wordDirection: toWordDirection(wordDirection),
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

					{(!element.wordRuns?.length || (isBulk && !isBulkWordScope)) && (
						<Button
							type="button"
							variant="outline"
							onClick={() => updateScopedSettings({})}
						>
							{isBulk
								? "Apply word controls to selected layers"
								: "Enable word controls"}
						</Button>
					)}

					{effectiveScope.type !== "layer" && (
						<Button
							type="button"
							variant="outline"
							disabled={!hasOverride}
							onClick={clearOverride}
						>
							Clear {effectiveScope.type} override
						</Button>
					)}
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function resolveTextScopeForEntry({
	scope,
	entry,
}: {
	scope: TextOverrideScope;
	entry: ElementWithTrackForParams & { element: TextElement };
}): TextOverrideScope | null {
	if (scope.type !== "words") {
		return scope;
	}

	const wordIds = entry.textWordIds ?? scope.wordIds;
	return wordIds.length > 0 ? { type: "words", wordIds } : null;
}
