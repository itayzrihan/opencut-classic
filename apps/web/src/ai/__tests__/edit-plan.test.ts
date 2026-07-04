import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import {
	buildAiClipEffectLayerElement,
	buildAiUpdatedClipEffectLayerElement,
	buildCustomEditEffectElement,
	buildCustomEditEffectParams,
	extractAiEditPlanFromText,
	validateAiEditPlan,
} from "@/ai/edit-plan";
import { CUSTOM_AI_EFFECT_TYPE } from "@/effects/custom-ai-effect";
import type { MediaTime } from "@/wasm";

const t = (time: number) => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixtures use integer ticks.
	return time as MediaTime;
};

const tracks: SceneTracks = {
	overlay: [
		{
			id: "text",
			name: "Text",
			type: "text",
			hidden: false,
			elements: [
				{
					id: "inside",
					type: "text",
					name: "inside",
					startTime: t(100),
					duration: t(100),
					trimStart: t(0),
					trimEnd: t(0),
					params: { text: "inside" },
					effects: [
						{
							id: "effect-blur",
							type: "blur",
							enabled: true,
							params: { intensity: 15 },
						},
					],
				},
				{
					id: "outside",
					type: "text",
					name: "outside",
					startTime: t(500),
					duration: t(100),
					trimStart: t(0),
					trimEnd: t(0),
					params: { text: "outside" },
				},
			],
		},
	],
	main: {
		id: "main",
		name: "Main",
		type: "video",
		hidden: false,
		muted: false,
		elements: [],
	},
	audio: [
		{
			id: "audio-track",
			name: "Audio",
			type: "audio",
			muted: false,
			elements: [
				{
					id: "audio",
					type: "audio",
					name: "audio",
					sourceType: "upload",
					mediaId: "media-audio",
					startTime: t(100),
					duration: t(100),
					trimStart: t(0),
					trimEnd: t(0),
					params: { volume: 0, muted: false },
				},
			],
		},
	],
};

describe("AI edit plan validation", () => {
	test("extracts an edit plan from double-encoded JSON text", () => {
		const plan = {
			title: "Update text",
			summary: "Change two text layers",
			operations: [
				{
					type: "update_element",
					trackId: "text",
					elementId: "inside",
					params: { content: "HELLO" },
				},
			],
		};

		const extracted = extractAiEditPlanFromText(
			JSON.stringify(JSON.stringify(plan)),
		);

		expect(extracted).toEqual({
			...plan,
			operations: [
				{
					...plan.operations[0],
					patch: { params: { content: "HELLO" } },
				},
			],
		});
	});

	test("normalizes update-element params shorthand before validation", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Update word",
				summary: "Change one text element",
				operations: [
					{
						type: "update_element",
						trackId: "text",
						elementId: "inside",
						params: { content: "HELLO" },
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(true);
		expect(result.plan?.operations[0]).toMatchObject({
			type: "update_element",
			patch: { params: { content: "HELLO" } },
		});
	});

	test("accepts operations inside active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Update word",
				summary: "Change one text element",
				operations: [
					{
						type: "update_element",
						trackId: "text",
						elementId: "inside",
						patch: { params: { text: "changed" } },
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(true);
		expect(result.plan?.operations).toHaveLength(1);
	});

	test("rejects operations outside active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Bad edit",
				summary: "",
				operations: [
					{
						type: "delete_element",
						trackId: "text",
						elementId: "outside",
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("outside the selected range");
	});

	test("accepts inserted text fully inside active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Add caption",
				summary: "",
				operations: [
					{
						type: "insert_text_element",
						content: "New caption",
						startTime: t(100),
						duration: t(40),
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(true);
		expect(result.plan?.operations).toHaveLength(1);
	});

	test("rejects inserted text outside active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Add late caption",
				summary: "",
				operations: [
					{
						type: "insert_text_element",
						content: "Late caption",
						startTime: t(200),
						duration: t(40),
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("outside the selected range");
	});

	test("rejects inserted text on non-text tracks", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Add caption to main",
				summary: "",
				operations: [
					{
						type: "insert_text_element",
						trackId: "main",
						content: "Wrong track",
						startTime: t(100),
						duration: t(40),
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("not a text track");
	});

	test("accepts custom edit specs on elements inside the active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Attach custom animation",
				summary: "Host a Hyperframes-style animation spec",
				operations: [
					{
						type: "attach_custom_edit",
						trackId: "text",
						elementId: "inside",
						label: "Blur zoom entrance",
						kind: "animation",
						intent: "Animate the word with a blurred zoom-in.",
						startTime: t(100),
						duration: t(40),
						spec: {
							method: "fromTo",
							duration: 0.45,
							from: { opacity: 0, scale: 1.4, blur: 16 },
							to: { opacity: 1, scale: 1, blur: 0 },
						},
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(true);
		expect(result.plan?.operations[0]).toMatchObject({
			type: "attach_custom_edit",
			kind: "animation",
			startTime: t(100),
			duration: t(40),
		});
	});

	test("rejects custom edit layer timing outside the active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Attach custom animation",
				summary: "",
				operations: [
					{
						type: "attach_custom_edit",
						trackId: "text",
						elementId: "inside",
						label: "Long effect",
						startTime: t(100),
						duration: t(200),
						spec: { effect: "blur" },
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("timing is outside");
	});

	test("rejects custom edit specs outside the active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Attach late custom animation",
				summary: "",
				operations: [
					{
						type: "attach_custom_edit",
						trackId: "text",
						elementId: "outside",
						label: "Late effect",
						spec: { effect: "shake" },
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("outside the selected range");
	});

	test("rejects missing element references without an active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Missing target",
				summary: "",
				operations: [
					{
						type: "delete_element",
						trackId: "text",
						elementId: "missing",
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("missing element");
	});

	test("rejects custom edit specs on non-visual elements", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Audio effect",
				summary: "",
				operations: [
					{
						type: "attach_custom_edit",
						trackId: "audio-track",
						elementId: "audio",
						label: "Visual shake",
						spec: { effect: "shake" },
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("not a visual element");
	});

	test("accepts clip effect updates when the referenced effect exists", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Adjust blur",
				summary: "",
				operations: [
					{
						type: "update_clip_effect_params",
						trackId: "text",
						elementId: "inside",
						effectId: "effect-blur",
						params: { intensity: 35 },
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(true);
	});

	test("rejects clip effect updates when the referenced effect is missing", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Adjust blur",
				summary: "",
				operations: [
					{
						type: "update_clip_effect_params",
						trackId: "text",
						elementId: "inside",
						effectId: "missing-effect",
						params: { intensity: 35 },
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("missing effect");
	});

	test("builds custom effect params for custom edit operations", () => {
		const params = buildCustomEditEffectParams({
			operation: {
				type: "attach_custom_edit",
				trackId: "text",
				elementId: "inside",
				label: "Explode letters",
				kind: "animation",
				intent: "Explode each letter outward.",
				startTime: t(100),
				duration: t(50),
				spec: { keyframes: [{ percentage: 100, x: 40 }] },
			},
		});

		expect(params).toMatchObject({
			label: "Explode letters",
			kind: "animation",
			intent: "Explode each letter outward.",
		});
		expect(params.specJson).toContain("effect-layer");
		expect(params.specJson).toContain("keyframes");
	});

	test("builds visible effect layer elements for custom edit operations", () => {
		const element = buildCustomEditEffectElement({
			operation: {
				type: "attach_custom_edit",
				trackId: "text",
				elementId: "inside",
				label: "Blur zoom",
				startTime: t(120),
				duration: t(60),
				spec: { effect: "blur zoom" },
			},
			target: {
				startTime: t(100),
				duration: t(100),
			},
		});

		expect(element).toMatchObject({
			type: "effect",
			name: "AI: Blur zoom",
			effectType: CUSTOM_AI_EFFECT_TYPE,
			startTime: t(120),
			duration: t(60),
		});
	});

	test("builds visible effect layer elements for AI-added clip effects", () => {
		const element = buildAiClipEffectLayerElement({
			operation: {
				type: "add_clip_effect",
				trackId: "text",
				elementId: "inside",
				effectType: "blur",
				params: { intensity: 42 },
			},
			target: {
				startTime: t(100),
				duration: t(100),
			},
		});

		expect(element).toMatchObject({
			type: "effect",
			name: "AI: blur",
			effectType: "blur",
			startTime: t(100),
			duration: t(100),
			params: { intensity: 42 },
		});
	});

	test("builds visible effect layer elements for AI-updated clip effects", () => {
		const element = buildAiUpdatedClipEffectLayerElement({
			operation: {
				type: "update_clip_effect_params",
				trackId: "text",
				elementId: "inside",
				effectId: "effect-blur",
				params: { intensity: 55 },
			},
			target: {
				startTime: t(100),
				duration: t(100),
			},
			effect: {
				type: "blur",
				params: { intensity: 15 },
			},
		});

		expect(element).toMatchObject({
			type: "effect",
			name: "AI: blur",
			effectType: "blur",
			startTime: t(100),
			duration: t(100),
			params: { intensity: 55 },
		});
	});
});
