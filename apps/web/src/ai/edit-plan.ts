import { z } from "zod";
import type { EditorCore } from "@/core";
import type { CreateTextElement, SceneTracks } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import type { AnimationPath } from "@/animation/types";
import { ZERO_MEDIA_TIME, type MediaTime } from "@/wasm";
import type { ParamValue } from "@/params";
import type { AiEditOperation, AiEditPlan, AiTimelineRange } from "./types";
import { buildTimelineContextIndex, rangesOverlap } from "./timeline-context";

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
	const parsed = aiEditPlanSchema.safeParse(value);
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

	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return null;
		}
	}

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		try {
			return JSON.parse(fenced[1]);
		} catch {
			return null;
		}
	}

	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		try {
			return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
		} catch {
			return null;
		}
	}

	return null;
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

		if (!range) {
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
		}

		if (
			operation.type === "split_element" &&
			(operation.splitTime < range.startTime ||
				operation.splitTime > range.endTime)
		) {
			errors.push("split_element splitTime is outside the selected range");
		}
		if (
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
			editor.timeline.addClipEffect({
				trackId: operation.trackId,
				elementId: operation.elementId,
				effectType: operation.effectType,
			});
			return;
		case "update_clip_effect_params":
			editor.timeline.updateClipEffectParams({
				trackId: operation.trackId,
				elementId: operation.elementId,
				effectId: operation.effectId,
				params: operation.params,
			});
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
