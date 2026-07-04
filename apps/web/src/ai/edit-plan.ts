import { z } from "zod";
import type { EditorCore } from "@/core";
import {
	VISUAL_ELEMENT_TYPES,
	type CreateTextElement,
	type CreateTimelineElement,
	type ElementType,
	type SceneTracks,
	type TimelineElement,
	type VisualElement,
} from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import type { AnimationPath } from "@/animation/types";
import { isAnimationPath } from "@/animation/path";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME, type MediaTime } from "@/wasm";
import type { ParamValue, ParamValues } from "@/params";
import {
	buildEffectElement,
	buildElementFromMedia,
	buildGraphicElement,
} from "@/timeline/element-utils";
import { validateElementTrackCompatibility } from "@/timeline/placement";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { graphicsRegistry, registerDefaultGraphics } from "@/graphics";
import {
	DEFAULT_HYPERFRAME_HEIGHT,
	DEFAULT_HYPERFRAME_WIDTH,
	HYPERFRAME_DEFINITION_ID,
} from "@/graphics/definitions/hyperframe";
import { TRANSITION_PRESETS } from "@/transitions";
import type { MediaAsset } from "@/media/types";
import type { AiEditOperation, AiEditPlan, AiTimelineRange } from "./types";
import {
	buildTimelineContextIndex,
	getDisplayTracks,
	rangesOverlap,
} from "./timeline-context";
import {
	buildCustomAiEffectParams,
	CUSTOM_AI_EFFECT_TYPE,
} from "@/effects/custom-ai-effect";

const mediaTimeSchema = z.custom<MediaTime>(
	(value) => typeof value === "number" && Number.isInteger(value) && value >= 0,
	"Expected a non-negative integer media time",
);
const positiveMediaTimeSchema = z.custom<MediaTime>(
	(value) => typeof value === "number" && Number.isInteger(value) && value > 0,
	"Expected a positive integer media time",
);
const paramValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const paramsSchema = z.record(z.string(), paramValueSchema);
type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);
const customEditSpecSchema = jsonValueSchema;

const operationSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("update_element"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		patch: z.record(z.string(), z.unknown()),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("insert_text_element"),
		trackId: z.string().min(1).optional(),
		name: z.string().min(1).optional(),
		content: z.string().min(1),
		startTime: mediaTimeSchema,
		duration: positiveMediaTimeSchema,
		params: paramsSchema.optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("trim_element"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		trimStart: mediaTimeSchema.optional(),
		trimEnd: mediaTimeSchema.optional(),
		startTime: mediaTimeSchema.optional(),
		duration: mediaTimeSchema.optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("move_element"),
		sourceTrackId: z.string().min(1),
		targetTrackId: z.string().min(1),
		elementId: z.string().min(1),
		startTime: mediaTimeSchema,
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("split_element"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		splitTime: mediaTimeSchema,
		retainSide: z.enum(["both", "left", "right"]).optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("delete_element"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("add_clip_effect"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		effectType: z.string().min(1),
		params: paramsSchema.optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("attach_custom_edit"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		label: z.string().min(1),
		kind: z.string().min(1).optional(),
		intent: z.string().min(1).optional(),
		startTime: mediaTimeSchema.optional(),
		duration: positiveMediaTimeSchema.optional(),
		spec: customEditSpecSchema,
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("update_clip_effect_params"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		effectId: z.string().min(1),
		params: paramsSchema,
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("upsert_keyframe"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		propertyPath: z.string().min(1),
		time: mediaTimeSchema,
		value: paramValueSchema,
		interpolation: z.enum(["linear", "hold"]).optional(),
		keyframeId: z.string().optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("remove_keyframe"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		propertyPath: z.string().min(1),
		keyframeId: z.string().min(1),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("add_track"),
		trackType: z.enum(["video", "text", "audio", "graphic", "effect"]),
		index: z.number().int().min(0).optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("remove_track"),
		trackId: z.string().min(1),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("reorder_track"),
		trackId: z.string().min(1),
		toIndex: z.number().int().min(0),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("set_track_state"),
		trackId: z.string().min(1),
		muted: z.boolean().optional(),
		hidden: z.boolean().optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("insert_media_element"),
		mediaId: z.string().min(1),
		startTime: mediaTimeSchema,
		trackId: z.string().min(1).optional(),
		duration: positiveMediaTimeSchema.optional(),
		name: z.string().min(1).optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("insert_graphic_element"),
		definitionId: z.string().min(1),
		startTime: mediaTimeSchema,
		duration: positiveMediaTimeSchema,
		trackId: z.string().min(1).optional(),
		name: z.string().min(1).optional(),
		params: paramsSchema.optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("insert_html_element"),
		html: z.string().min(1),
		startTime: mediaTimeSchema,
		duration: positiveMediaTimeSchema,
		trackId: z.string().min(1).optional(),
		name: z.string().min(1).optional(),
		sourceWidth: z.number().int().min(16).max(4096).optional(),
		sourceHeight: z.number().int().min(16).max(4096).optional(),
		params: paramsSchema.optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("duplicate_element"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("apply_transition"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		presetId: z.string().min(1),
		side: z.enum(["in", "out"]),
		percent: z.number().min(0).max(100).optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("set_element_state"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		hidden: z.boolean().optional(),
		muted: z.boolean().optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("retime_element"),
		trackId: z.string().min(1),
		elementId: z.string().min(1),
		rate: z.number().min(0.1).max(10),
		maintainPitch: z.boolean().optional(),
		reason: z.string().optional(),
	}),
]);

export const aiEditPlanSchema = z.object({
	title: z.string().min(1).default("AI edit plan"),
	summary: z.string().default(""),
	operations: z.array(operationSchema).default([]),
	notes: z.array(z.string()).optional(),
});

export interface ValidateAiEditPlanResult {
	success: boolean;
	plan: AiEditPlan | null;
	errors: string[];
}

export function validateAiEditPlan({
	value,
	tracks,
	range,
	mediaAssets,
}: {
	value: unknown;
	tracks: SceneTracks;
	range?: AiTimelineRange | null;
	mediaAssets?: MediaAsset[];
}): ValidateAiEditPlanResult {
	const parsed = aiEditPlanSchema.safeParse(normalizeAiEditPlanInput(value));
	if (!parsed.success) {
		return {
			success: false,
			plan: null,
			errors: parsed.error.issues.map((issue) =>
				issue.path.length > 0
					? `${issue.path.join(".")}: ${issue.message}`
					: issue.message,
			),
		};
	}

	const plan = parsed.data as AiEditPlan;
	const errors = getRangeGuardErrors({
		operations: plan.operations,
		tracks,
		range,
		mediaAssets,
	});
	return {
		success: errors.length === 0,
		plan,
		errors,
	};
}

export function applyAiEditPlan({
	editor,
	plan,
}: {
	editor: EditorCore;
	plan: AiEditPlan;
}): void {
	const scene = editor.scenes.getActiveSceneOrNull();
	const previousTracks = scene?.tracks;
	try {
		for (const operation of plan.operations) {
			applyOperation({ editor, operation });
		}
	} catch (error) {
		if (previousTracks) {
			editor.timeline.updateTracks(previousTracks);
		}
		throw error;
	}
}

export function extractAiEditPlanFromText(text: string): unknown | null {
	const trimmed = text.trim();
	if (!trimmed) {
		return null;
	}

	const parsedFullText = parseJsonRecursively({ text: trimmed });
	if (parsedFullText) {
		return normalizeAiEditPlanInput(parsedFullText);
	}

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		const parsedFence = parseJsonRecursively({ text: fenced[1].trim() });
		if (parsedFence) {
			return normalizeAiEditPlanInput(parsedFence);
		}
	}

	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		const parsedSlice = parseJsonRecursively({
			text: trimmed.slice(firstBrace, lastBrace + 1),
		});
		if (parsedSlice) {
			return normalizeAiEditPlanInput(parsedSlice);
		}
	}

	return null;
}

function parseJsonRecursively({
	text,
	depth = 0,
}: {
	text: string;
	depth?: number;
}): unknown | null {
	if (depth > 2) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === "string") {
			return parseJsonRecursively({ text: parsed.trim(), depth: depth + 1 });
		}
		return parsed;
	} catch {
		return null;
	}
}

function normalizeAiEditPlanInput(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}
	if (!Array.isArray(value.operations)) {
		return value;
	}
	return {
		...value,
		operations: value.operations.map(normalizeAiEditOperationInput),
	};
}

function normalizeAiEditOperationInput(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}
	if (
		(value.type === "upsert_keyframe" || value.type === "remove_keyframe") &&
		typeof value.propertyPath !== "string"
	) {
		const alias =
			typeof value.property === "string"
				? value.property
				: typeof value.path === "string"
					? value.path
					: null;
		if (alias) {
			const { property: _property, path: _path, ...rest } = value;
			return { ...rest, propertyPath: alias };
		}
		return value;
	}
	if (value.type !== "update_element") {
		return value;
	}
	if (isRecord(value.patch)) {
		return value;
	}
	const params = isRecord(value.params) ? value.params : null;
	if (params) {
		return {
			...value,
			patch: { params },
		};
	}
	if (typeof value.content === "string") {
		return {
			...value,
			patch: { params: { content: value.content } },
		};
	}
	if (typeof value.text === "string") {
		return {
			...value,
			patch: { params: { content: value.text } },
		};
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRangeGuardErrors({
	operations,
	tracks,
	range,
	mediaAssets,
}: {
	operations: AiEditOperation[];
	tracks: SceneTracks;
	range?: AiTimelineRange | null;
	mediaAssets?: MediaAsset[];
}): string[] {
	const index = buildTimelineContextIndex({ tracks });
	const displayTracks = getDisplayTracks(tracks);
	const errors: string[] = [];

	for (const operation of operations) {
		if (operation.type === "add_track") {
			continue;
		}

		if (
			operation.type === "remove_track" ||
			operation.type === "reorder_track" ||
			operation.type === "set_track_state"
		) {
			if (!index.layersById.has(operation.trackId)) {
				errors.push(
					`${operation.type} references a missing track ${operation.trackId}`,
				);
			}
			continue;
		}

		if (
			operation.type === "insert_media_element" ||
			operation.type === "insert_graphic_element" ||
			operation.type === "insert_html_element"
		) {
			errors.push(
				...getInsertOperationErrors({
					operation,
					index,
					displayTracks,
					range,
					mediaAssets,
				}),
			);
			continue;
		}

		if (operation.type === "apply_transition") {
			if (
				!TRANSITION_PRESETS.some((preset) => preset.id === operation.presetId)
			) {
				errors.push(
					`apply_transition references an unknown transition preset ${operation.presetId}`,
				);
			}
		}

		if (operation.type === "insert_text_element") {
			if (operation.trackId) {
				const layer = index.layersById.get(operation.trackId);
				if (!layer) {
					errors.push(
						`insert_text_element references a missing track ${operation.trackId}`,
					);
				} else if (layer.type !== "text") {
					errors.push(
						`insert_text_element target track ${operation.trackId} is not a text track`,
					);
				}
			}

			if (range) {
				const endTime = operation.startTime + operation.duration;
				if (operation.startTime < range.startTime || endTime > range.endTime) {
					errors.push("insert_text_element is outside the selected range");
				}
			}

			continue;
		}

		if (operation.type === "move_element") {
			const source = findTrackAndElement({
				tracks: displayTracks,
				trackId: operation.sourceTrackId,
				elementId: operation.elementId,
			});
			const targetTrack = displayTracks.find(
				(track) => track.id === operation.targetTrackId,
			);
			if (!targetTrack) {
				errors.push(
					`move_element references a missing target track ${operation.targetTrackId}`,
				);
			} else if (source?.element) {
				const validation = validateElementTrackCompatibility({
					element: source.element,
					track: targetTrack,
				});
				if (!validation.isValid) {
					errors.push(
						validation.errorMessage ??
							`move_element cannot move ${source.element.name} to ${targetTrack.name}`,
					);
				}
			}
			if (range && source?.element) {
				const movedEndTime = operation.startTime + source.element.duration;
				if (
					operation.startTime < range.startTime ||
					movedEndTime > range.endTime
				) {
					errors.push(
						"move_element target timing is outside the selected range",
					);
				}
			}
		}

		const refs = getOperationElementRefs(operation);
		for (const ref of refs) {
			const element = index.elementsById.get(`${ref.trackId}:${ref.elementId}`);
			if (!element) {
				errors.push(
					`${operation.type} references a missing element ${ref.elementId}`,
				);
				continue;
			}
			if (
				range &&
				!rangesOverlap({
					firstStart: element.startTime,
					firstEnd: element.endTime,
					secondStart: range.startTime,
					secondEnd: range.endTime,
				})
			) {
				errors.push(
					`${operation.type} references ${element.name} outside the selected range`,
				);
			}
			const targetIsVisual = isVisualElementType({ type: element.type });
			if (isClipEffectOperation(operation) && !targetIsVisual) {
				errors.push(
					`${operation.type} target ${element.name} is not a visual element`,
				);
			}
			if (operation.type === "apply_transition" && !targetIsVisual) {
				errors.push(
					`apply_transition target ${element.name} is not a visual element`,
				);
			}
			if (
				operation.type === "retime_element" &&
				element.type !== "video" &&
				element.type !== "audio"
			) {
				errors.push(
					`retime_element target ${element.name} is not a video or audio element`,
				);
			}
			if (operation.type === "set_element_state") {
				if (operation.hidden !== undefined && !targetIsVisual) {
					errors.push(
						`set_element_state cannot hide ${element.name}; it is not a visual element`,
					);
				}
				if (
					operation.muted !== undefined &&
					element.type !== "video" &&
					element.type !== "audio"
				) {
					errors.push(
						`set_element_state cannot mute ${element.name}; it has no audio`,
					);
				}
			}
			if (
				operation.type === "update_clip_effect_params" &&
				targetIsVisual &&
				!element.effects?.some((effect) => effect.id === operation.effectId)
			) {
				errors.push(
					`update_clip_effect_params references a missing effect ${operation.effectId}`,
				);
			}
			if (
				operation.type === "upsert_keyframe" ||
				operation.type === "remove_keyframe"
			) {
				const target = findTrackAndElement({
					tracks: displayTracks,
					trackId: ref.trackId,
					elementId: ref.elementId,
				});
				if (!isAnimationPath(operation.propertyPath)) {
					errors.push(
						`${operation.type} references an unsupported animation path ${operation.propertyPath}`,
					);
				} else if (
					target?.element &&
					!resolveAnimationTarget({
						element: target.element,
						path: operation.propertyPath,
					})
				) {
					errors.push(
						`${operation.type} cannot animate ${operation.propertyPath} on ${target.element.name}`,
					);
				}

				if (
					operation.type === "upsert_keyframe" &&
					range &&
					(element.startTime + operation.time < range.startTime ||
						element.startTime + operation.time > range.endTime)
				) {
					errors.push("upsert_keyframe time is outside the selected range");
				}

				if (
					operation.type === "upsert_keyframe" &&
					isAnimationPath(operation.propertyPath) &&
					target?.element
				) {
					const animationTarget = resolveAnimationTarget({
						element: target.element,
						path: operation.propertyPath,
					});
					if (
						animationTarget &&
						animationTarget.coerceValue({
							value: operation.value as ParamValue,
						}) === null
					) {
						errors.push(
							`upsert_keyframe value is invalid for ${operation.propertyPath}`,
						);
					}
				}

				if (
					operation.type === "remove_keyframe" &&
					!element.keyframes?.some(
						(keyframe) =>
							keyframe.propertyPath === operation.propertyPath &&
							keyframe.keyframeId === operation.keyframeId,
					)
				) {
					errors.push(
						`remove_keyframe references a missing keyframe ${operation.keyframeId}`,
					);
				}
			}
		}

		if (
			range &&
			operation.type === "attach_custom_edit" &&
			operation.startTime !== undefined &&
			operation.duration !== undefined &&
			(operation.startTime < range.startTime ||
				operation.startTime + operation.duration > range.endTime)
		) {
			errors.push("attach_custom_edit timing is outside the selected range");
		}
		if (
			range &&
			operation.type === "split_element" &&
			(operation.splitTime < range.startTime ||
				operation.splitTime > range.endTime)
		) {
			errors.push("split_element splitTime is outside the selected range");
		}
	}

	return errors;
}

function findTrackAndElement({
	tracks,
	trackId,
	elementId,
}: {
	tracks: ReturnType<typeof getDisplayTracks>;
	trackId: string;
	elementId: string;
}): {
	track: ReturnType<typeof getDisplayTracks>[number];
	element: TimelineElement;
} | null {
	const track = tracks.find((candidate) => candidate.id === trackId);
	const element = track?.elements.find(
		(candidate) => candidate.id === elementId,
	);
	return track && element ? { track, element } : null;
}

function getOperationElementRefs(
	operation: AiEditOperation,
): Array<{ trackId: string; elementId: string }> {
	switch (operation.type) {
		case "insert_text_element":
		case "insert_media_element":
		case "insert_graphic_element":
		case "insert_html_element":
		case "add_track":
		case "remove_track":
		case "reorder_track":
		case "set_track_state":
			return [];
		case "move_element":
			return [
				{ trackId: operation.sourceTrackId, elementId: operation.elementId },
			];
		default:
			return [{ trackId: operation.trackId, elementId: operation.elementId }];
	}
}

function getInsertOperationErrors({
	operation,
	index,
	displayTracks,
	range,
	mediaAssets,
}: {
	operation: Extract<
		AiEditOperation,
		{
			type:
				| "insert_media_element"
				| "insert_graphic_element"
				| "insert_html_element";
		}
	>;
	index: ReturnType<typeof buildTimelineContextIndex>;
	displayTracks: ReturnType<typeof getDisplayTracks>;
	range?: AiTimelineRange | null;
	mediaAssets?: MediaAsset[];
}): string[] {
	const errors: string[] = [];

	let mediaAsset: MediaAsset | undefined;
	if (operation.type === "insert_media_element") {
		mediaAsset = mediaAssets?.find((asset) => asset.id === operation.mediaId);
		if (mediaAssets && !mediaAsset) {
			errors.push(
				`insert_media_element references a missing media asset ${operation.mediaId}`,
			);
		}
	}

	if (operation.type === "insert_graphic_element") {
		registerDefaultGraphics();
		if (!graphicsRegistry.has(operation.definitionId)) {
			errors.push(
				`insert_graphic_element references an unknown graphic definition ${operation.definitionId}`,
			);
		}
	}

	if (operation.type === "insert_html_element" && !operation.html.trim()) {
		errors.push("insert_html_element requires non-empty html");
	}

	if (operation.trackId) {
		const layer = index.layersById.get(operation.trackId);
		const track = displayTracks.find(
			(candidate) => candidate.id === operation.trackId,
		);
		if (!layer || !track) {
			errors.push(
				`${operation.type} references a missing track ${operation.trackId}`,
			);
		} else {
			const element = buildElementForInsertOperation({
				operation,
				mediaAsset,
			});
			if (element) {
				const validation = validateElementTrackCompatibility({
					element: element as TimelineElement,
					track,
				});
				if (!validation.isValid) {
					errors.push(
						validation.errorMessage ??
							`${operation.type} cannot target track ${operation.trackId}`,
					);
				}
			}
		}
	}

	if (range) {
		const duration =
			operation.type === "insert_media_element"
				? (operation.duration ??
					(mediaAsset
						? getMediaAssetDefaultDuration({ mediaAsset })
						: (0 as MediaTime)))
				: operation.duration;
		const endTime = operation.startTime + (duration ?? 0);
		if (operation.startTime < range.startTime || endTime > range.endTime) {
			errors.push(`${operation.type} is outside the selected range`);
		}
	}

	return errors;
}

function getMediaAssetDefaultDuration({
	mediaAsset,
}: {
	mediaAsset: MediaAsset;
}): MediaTime {
	if (mediaAsset.duration && mediaAsset.duration > 0) {
		return mediaTimeFromSeconds({ seconds: mediaAsset.duration });
	}
	return DEFAULT_NEW_ELEMENT_DURATION;
}

function buildElementForInsertOperation({
	operation,
	mediaAsset,
}: {
	operation: Extract<
		AiEditOperation,
		{
			type:
				| "insert_media_element"
				| "insert_graphic_element"
				| "insert_html_element";
		}
	>;
	mediaAsset?: MediaAsset;
}): CreateTimelineElement | null {
	if (operation.type === "insert_media_element") {
		if (!mediaAsset) {
			return null;
		}
		const element = buildElementFromMedia({
			mediaId: mediaAsset.id,
			mediaType: mediaAsset.type,
			name: operation.name ?? mediaAsset.name,
			duration:
				operation.duration ?? getMediaAssetDefaultDuration({ mediaAsset }),
			startTime: operation.startTime,
		});
		return element;
	}

	if (operation.type === "insert_graphic_element") {
		const element = buildGraphicElement({
			definitionId: operation.definitionId,
			name: operation.name,
			startTime: operation.startTime,
			params: operation.params,
		});
		return { ...element, duration: operation.duration };
	}

	const element = buildGraphicElement({
		definitionId: HYPERFRAME_DEFINITION_ID,
		name: operation.name ?? "AI HTML frame",
		startTime: operation.startTime,
		params: {
			...(operation.params ?? {}),
			html: operation.html,
			sourceWidth: operation.sourceWidth ?? DEFAULT_HYPERFRAME_WIDTH,
			sourceHeight: operation.sourceHeight ?? DEFAULT_HYPERFRAME_HEIGHT,
		},
	});
	return { ...element, duration: operation.duration };
}

function applyOperation({
	editor,
	operation,
}: {
	editor: EditorCore;
	operation: AiEditOperation;
}): void {
	switch (operation.type) {
		case "insert_text_element":
			editor.timeline.insertElement({
				element: buildInsertedTextElement({ operation }),
				placement: operation.trackId
					? { mode: "explicit", trackId: operation.trackId }
					: { mode: "auto", trackType: "text" },
			});
			return;
		case "update_element":
			editor.timeline.updateElements({
				updates: [
					{
						trackId: operation.trackId,
						elementId: operation.elementId,
						patch: operation.patch,
					},
				],
			});
			return;
		case "trim_element":
			{
				const track = editor.timeline.getTrackById({
					trackId: operation.trackId,
				});
				const element = track?.elements.find(
					(candidate) => candidate.id === operation.elementId,
				);
				if (!element) return;
				editor.timeline.updateElementTrim({
					elementId: operation.elementId,
					trimStart: operation.trimStart ?? element.trimStart,
					trimEnd: operation.trimEnd ?? element.trimEnd,
					startTime: operation.startTime,
					duration: operation.duration,
				});
			}
			return;
		case "move_element":
			editor.timeline.moveElements({
				moves: [
					{
						sourceTrackId: operation.sourceTrackId,
						targetTrackId: operation.targetTrackId,
						elementId: operation.elementId,
						newStartTime: operation.startTime,
					},
				],
			});
			return;
		case "split_element":
			editor.timeline.splitElements({
				elements: [
					{ trackId: operation.trackId, elementId: operation.elementId },
				],
				splitTime: operation.splitTime,
				retainSide: operation.retainSide ?? "both",
			});
			return;
		case "delete_element":
			editor.timeline.deleteElements({
				elements: [
					{ trackId: operation.trackId, elementId: operation.elementId },
				],
			});
			return;
		case "add_clip_effect":
			{
				const target = getOperationTargetElement({ editor, operation });
				if (!target) return;
				editor.timeline.insertElement({
					element: buildAiClipEffectLayerElement({ operation, target }),
					placement: { mode: "auto", trackType: "effect" },
				});
			}
			return;
		case "attach_custom_edit":
			{
				const target = getOperationTargetElement({ editor, operation });
				if (!target) return;
				editor.timeline.insertElement({
					element: buildCustomEditEffectElement({ operation, target }),
					placement: { mode: "auto", trackType: "effect" },
				});
			}
			return;
		case "update_clip_effect_params":
			{
				const target = getOperationTargetElement({ editor, operation });
				if (!target || !isVisualElement(target)) return;
				const effect = target.effects?.find(
					(candidate) => candidate.id === operation.effectId,
				);
				if (!effect) return;
				editor.timeline.insertElement({
					element: buildAiUpdatedClipEffectLayerElement({
						operation,
						target,
						effect,
					}),
					placement: { mode: "auto", trackType: "effect" },
				});
			}
			return;
		case "upsert_keyframe":
			editor.timeline.upsertKeyframes({
				keyframes: [
					{
						trackId: operation.trackId,
						elementId: operation.elementId,
						propertyPath: operation.propertyPath as AnimationPath,
						time: operation.time,
						value: operation.value as ParamValue,
						interpolation: operation.interpolation,
						keyframeId: operation.keyframeId,
					},
				],
			});
			return;
		case "remove_keyframe":
			editor.timeline.removeKeyframes({
				keyframes: [
					{
						trackId: operation.trackId,
						elementId: operation.elementId,
						propertyPath: operation.propertyPath as AnimationPath,
						keyframeId: operation.keyframeId,
					},
				],
			});
			return;
		case "add_track":
			editor.timeline.addTrack({
				type: operation.trackType,
				index: operation.index,
			});
			return;
		case "remove_track":
			editor.timeline.removeTrack({ trackId: operation.trackId });
			return;
		case "reorder_track":
			editor.timeline.reorderTrack({
				trackId: operation.trackId,
				toIndex: operation.toIndex,
			});
			return;
		case "set_track_state":
			{
				const track = editor.timeline.getTrackById({
					trackId: operation.trackId,
				});
				if (!track) return;
				if (
					operation.muted !== undefined &&
					"muted" in track &&
					track.muted !== operation.muted
				) {
					editor.timeline.toggleTrackMute({ trackId: operation.trackId });
				}
				if (
					operation.hidden !== undefined &&
					"hidden" in track &&
					track.hidden !== operation.hidden
				) {
					editor.timeline.toggleTrackVisibility({
						trackId: operation.trackId,
					});
				}
			}
			return;
		case "insert_media_element":
			{
				const mediaAsset = editor.media
					.getAssets()
					.find((asset) => asset.id === operation.mediaId);
				const element = buildElementForInsertOperation({
					operation,
					mediaAsset,
				});
				if (!element) {
					throw new Error(
						`Media asset ${operation.mediaId} was not found in the project`,
					);
				}
				editor.timeline.insertElement({
					element,
					placement: operation.trackId
						? { mode: "explicit", trackId: operation.trackId }
						: {
								mode: "auto",
								trackType: element.type === "audio" ? "audio" : "video",
							},
				});
			}
			return;
		case "insert_graphic_element":
		case "insert_html_element":
			{
				const element = buildElementForInsertOperation({ operation });
				if (!element) return;
				editor.timeline.insertElement({
					element,
					placement: operation.trackId
						? { mode: "explicit", trackId: operation.trackId }
						: { mode: "auto", trackType: "video" },
				});
			}
			return;
		case "duplicate_element":
			editor.timeline.duplicateElements({
				elements: [
					{ trackId: operation.trackId, elementId: operation.elementId },
				],
			});
			return;
		case "apply_transition":
			editor.timeline.applyTransitions({
				applications: [
					{
						trackId: operation.trackId,
						elementId: operation.elementId,
						presetId: operation.presetId,
						side: operation.side,
						percent: operation.percent,
					},
				],
			});
			return;
		case "set_element_state":
			{
				const target = editor.timeline
					.getTrackById({ trackId: operation.trackId })
					?.elements.find((element) => element.id === operation.elementId);
				if (!target) return;
				const refs = [
					{ trackId: operation.trackId, elementId: operation.elementId },
				];
				if (
					operation.hidden !== undefined &&
					"hidden" in target &&
					Boolean(target.hidden) !== operation.hidden
				) {
					editor.timeline.toggleElementsVisibility({ elements: refs });
				}
				if (
					operation.muted !== undefined &&
					Boolean(target.params.muted) !== operation.muted
				) {
					editor.timeline.toggleElementsMuted({ elements: refs });
				}
			}
			return;
		case "retime_element":
			editor.timeline.updateElementRetime({
				trackId: operation.trackId,
				elementId: operation.elementId,
				retime: {
					rate: operation.rate,
					maintainPitch: operation.maintainPitch,
				},
			});
			return;
		default: {
			const exhaustive: never = operation;
			return exhaustive;
		}
	}
}

function getOperationTargetElement({
	editor,
	operation,
}: {
	editor: EditorCore;
	operation: Extract<
		AiEditOperation,
		{
			type:
				| "add_clip_effect"
				| "attach_custom_edit"
				| "update_clip_effect_params";
		}
	>;
}) {
	const track = editor.timeline.getTrackById({ trackId: operation.trackId });
	return track?.elements.find((element) => element.id === operation.elementId);
}

export function buildAiClipEffectLayerElement({
	operation,
	target,
}: {
	operation: Extract<AiEditOperation, { type: "add_clip_effect" }>;
	target: Pick<TimelineElement, "startTime" | "duration">;
}) {
	return buildEffectElement({
		effectType: operation.effectType,
		name: `AI: ${operation.effectType}`,
		startTime: target.startTime,
		duration: target.duration,
		params: operation.params,
	});
}

export function buildAiUpdatedClipEffectLayerElement({
	operation,
	target,
	effect,
}: {
	operation: Extract<AiEditOperation, { type: "update_clip_effect_params" }>;
	target: Pick<TimelineElement, "startTime" | "duration">;
	effect: { type: string; params: ParamValues };
}) {
	return buildEffectElement({
		effectType: effect.type,
		name: `AI: ${effect.type}`,
		startTime: target.startTime,
		duration: target.duration,
		params: {
			...effect.params,
			...operation.params,
		},
	});
}

export function buildCustomEditEffectElement({
	operation,
	target,
}: {
	operation: Extract<AiEditOperation, { type: "attach_custom_edit" }>;
	target: Pick<TimelineElement, "startTime" | "duration">;
}) {
	return buildEffectElement({
		effectType: CUSTOM_AI_EFFECT_TYPE,
		name: `AI: ${operation.label}`,
		startTime: operation.startTime ?? target.startTime,
		duration: operation.duration ?? target.duration,
		params: buildCustomEditEffectParams({ operation }),
	});
}

export function buildCustomEditEffectParams({
	operation,
}: {
	operation: Extract<AiEditOperation, { type: "attach_custom_edit" }>;
}): ReturnType<typeof buildCustomAiEffectParams> {
	return buildCustomAiEffectParams({
		requestedType: operation.label,
		label: operation.label,
		kind: operation.kind,
		intent: operation.intent ?? operation.reason,
		spec: {
			host: {
				type: "effect-layer",
				target: {
					trackId: operation.trackId,
					elementId: operation.elementId,
				},
				timing:
					operation.startTime !== undefined && operation.duration !== undefined
						? {
								startTime: operation.startTime,
								duration: operation.duration,
							}
						: null,
			},
			kind: operation.kind ?? "effect",
			intent: operation.intent ?? operation.reason ?? operation.label,
			label: operation.label,
			spec: operation.spec,
		},
	});
}

function isClipEffectOperation(operation: AiEditOperation): boolean {
	return (
		operation.type === "add_clip_effect" ||
		operation.type === "attach_custom_edit" ||
		operation.type === "update_clip_effect_params"
	);
}

function isVisualElementType({ type }: { type: ElementType }): boolean {
	return VISUAL_ELEMENT_TYPES.some((candidate) => candidate === type);
}

function isVisualElement(element: TimelineElement): element is VisualElement {
	return isVisualElementType({ type: element.type });
}

function buildInsertedTextElement({
	operation,
}: {
	operation: Extract<AiEditOperation, { type: "insert_text_element" }>;
}): CreateTextElement {
	const fallbackName = operation.content.trim().slice(0, 40) || "AI text";

	return {
		...DEFAULTS.text.element,
		name: operation.name?.trim() || fallbackName,
		startTime: operation.startTime,
		duration: operation.duration,
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {
			...DEFAULTS.text.element.params,
			content: operation.content,
			...(operation.params ?? {}),
		},
	};
}
