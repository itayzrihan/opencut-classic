import { z } from "zod";
import type { EditorCore } from "@/core";
import {
	VISUAL_ELEMENT_TYPES,
	type CreateTextElement,
	type ElementType,
	type SceneTracks,
	type TimelineElement,
	type VisualElement,
} from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import type { AnimationPath } from "@/animation/types";
import { ZERO_MEDIA_TIME, type MediaTime } from "@/wasm";
import type { ParamValue, ParamValues } from "@/params";
import { buildEffectElement } from "@/timeline/element-utils";
import type { AiEditOperation, AiEditPlan, AiTimelineRange } from "./types";
import { buildTimelineContextIndex, rangesOverlap } from "./timeline-context";
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
}: {
	value: unknown;
	tracks: SceneTracks;
	range?: AiTimelineRange | null;
}): ValidateAiEditPlanResult {
	const parsed = aiEditPlanSchema.safeParse(normalizeAiEditPlanInput(value));
	if (!parsed.success) {
		return {
			success: false,
			plan: null,
			errors: parsed.error.issues.map((issue) => issue.message),
		};
	}

	const plan = parsed.data as AiEditPlan;
	const errors = getRangeGuardErrors({
		operations: plan.operations,
		tracks,
		range,
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
	for (const operation of plan.operations) {
		applyOperation({ editor, operation });
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
	if (!isRecord(value) || value.type !== "update_element") {
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
}: {
	operations: AiEditOperation[];
	tracks: SceneTracks;
	range?: AiTimelineRange | null;
}): string[] {
	const index = buildTimelineContextIndex({ tracks });
	const errors: string[] = [];

	for (const operation of operations) {
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
			if (
				operation.type === "update_clip_effect_params" &&
				targetIsVisual &&
				!element.effects?.some((effect) => effect.id === operation.effectId)
			) {
				errors.push(
					`update_clip_effect_params references a missing effect ${operation.effectId}`,
				);
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
		if (
			range &&
			operation.type === "upsert_keyframe" &&
			(operation.time < range.startTime || operation.time > range.endTime)
		) {
			errors.push("upsert_keyframe time is outside the selected range");
		}
	}

	return errors;
}

function getOperationElementRefs(
	operation: AiEditOperation,
): Array<{ trackId: string; elementId: string }> {
	switch (operation.type) {
		case "insert_text_element":
			return [];
		case "move_element":
			return [
				{ trackId: operation.sourceTrackId, elementId: operation.elementId },
			];
		default:
			return [{ trackId: operation.trackId, elementId: operation.elementId }];
	}
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
					operation.startTime !== undefined &&
					operation.duration !== undefined
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
