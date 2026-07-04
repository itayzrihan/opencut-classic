import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import {
	applyAiEditPlan,
	buildAiClipEffectLayerElement,
	buildAiUpdatedClipEffectLayerElement,
	buildCustomEditEffectElement,
	buildCustomEditEffectParams,
	extractAiEditPlanFromText,
	validateAiEditPlan,
} from "@/ai/edit-plan";
import { CUSTOM_AI_EFFECT_TYPE } from "@/effects/custom-ai-effect";
import type { MediaTime } from "@/wasm";
import type { EditorCore } from "@/core";

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

	test("rejects moves to missing target tracks", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Move text",
				summary: "",
				operations: [
					{
						type: "move_element",
						sourceTrackId: "text",
						targetTrackId: "missing-track",
						elementId: "inside",
						startTime: t(100),
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("missing target track");
	});

	test("rejects moves to incompatible target track types", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Move text to audio",
				summary: "",
				operations: [
					{
						type: "move_element",
						sourceTrackId: "text",
						targetTrackId: "audio-track",
						elementId: "inside",
						startTime: t(100),
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain(
			"text elements cannot be placed on audio",
		);
	});

	test("rejects moved timing outside the active range", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Move text late",
				summary: "",
				operations: [
					{
						type: "move_element",
						sourceTrackId: "text",
						targetTrackId: "text",
						elementId: "inside",
						startTime: t(180),
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("target timing is outside");
	});

	test("rejects unsupported keyframe property paths", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Bad keyframe",
				summary: "",
				operations: [
					{
						type: "upsert_keyframe",
						trackId: "text",
						elementId: "inside",
						propertyPath: "not.a.real.path",
						time: t(10),
						value: 1,
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("unsupported animation path");
	});

	test("treats keyframe operation time as element-local for range checks", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Fade text",
				summary: "",
				operations: [
					{
						type: "upsert_keyframe",
						trackId: "text",
						elementId: "inside",
						propertyPath: "opacity",
						time: t(10),
						value: 0.5,
					},
				],
			},
			tracks,
			range: { startTime: t(105), endTime: t(120) },
		});

		expect(result.errors).not.toContain(
			"upsert_keyframe time is outside the selected range",
		);
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

	test("rolls back earlier operations when applying a later operation fails", () => {
		const calls: string[] = [];
		const editor = {
			scenes: {
				getActiveSceneOrNull: () => ({ tracks }),
			},
			timeline: {
				insertElement: () => calls.push("insert"),
				moveElements: () => {
					calls.push("move");
					throw new Error("Target track not found");
				},
				updateTracks: (nextTracks: SceneTracks) => {
					expect(nextTracks).toBe(tracks);
					calls.push("rollback");
				},
			},
		} as unknown as EditorCore;

		expect(() =>
			applyAiEditPlan({
				editor,
				plan: {
					title: "Partial failure",
					summary: "",
					operations: [
						{
							type: "insert_text_element",
							content: "First",
							startTime: t(0),
							duration: t(10),
						},
						{
							type: "move_element",
							sourceTrackId: "text",
							targetTrackId: "missing",
							elementId: "inside",
							startTime: t(100),
						},
					],
				},
			}),
		).toThrow("Target track not found");

		expect(calls).toEqual(["insert", "move", "rollback"]);
	});
});

describe("AI expanded operations", () => {
	const mediaAssets = [
		{
			id: "media-clip",
			name: "clip.mp4",
			type: "video" as const,
			duration: 10,
			file: new File([], "clip.mp4"),
		},
	];

	test("accepts track operations targeting existing tracks", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Track ops",
				summary: "",
				operations: [
					{ type: "add_track", trackType: "text" },
					{ type: "reorder_track", trackId: "text", toIndex: 0 },
					{ type: "set_track_state", trackId: "audio-track", muted: true },
				],
			},
			tracks,
		});

		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);
	});

	test("rejects track operations on missing tracks", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Bad track op",
				summary: "",
				operations: [{ type: "remove_track", trackId: "missing-track" }],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("missing track");
	});

	test("accepts insert_media_element with a known asset", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Insert clip",
				summary: "",
				operations: [
					{
						type: "insert_media_element",
						mediaId: "media-clip",
						startTime: t(0),
					},
				],
			},
			tracks,
			mediaAssets,
		});

		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);
	});

	test("rejects insert_media_element with an unknown asset", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Insert missing clip",
				summary: "",
				operations: [
					{
						type: "insert_media_element",
						mediaId: "not-a-media-id",
						startTime: t(0),
					},
				],
			},
			tracks,
			mediaAssets,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("missing media asset");
	});

	test("accepts insert_graphic_element with a known definition", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Insert shape",
				summary: "",
				operations: [
					{
						type: "insert_graphic_element",
						definitionId: "rectangle",
						startTime: t(0),
						duration: t(100),
					},
				],
			},
			tracks,
		});

		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);
	});

	test("rejects insert_graphic_element with an unknown definition", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Insert bad shape",
				summary: "",
				operations: [
					{
						type: "insert_graphic_element",
						definitionId: "not-a-shape",
						startTime: t(0),
						duration: t(100),
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("unknown graphic definition");
	});

	test("accepts insert_html_element and enforces the active range", () => {
		const accepted = validateAiEditPlan({
			value: {
				title: "Insert HTML frame",
				summary: "",
				operations: [
					{
						type: "insert_html_element",
						html: "<div>Hello</div>",
						startTime: t(100),
						duration: t(100),
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});
		expect(accepted.errors).toEqual([]);
		expect(accepted.success).toBe(true);

		const rejected = validateAiEditPlan({
			value: {
				title: "Insert HTML frame late",
				summary: "",
				operations: [
					{
						type: "insert_html_element",
						html: "<div>Hello</div>",
						startTime: t(200),
						duration: t(100),
					},
				],
			},
			tracks,
			range: { startTime: t(90), endTime: t(220) },
		});
		expect(rejected.success).toBe(false);
		expect(rejected.errors[0]).toContain("outside the selected range");
	});

	test("rejects apply_transition with an unknown preset", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Bad transition",
				summary: "",
				operations: [
					{
						type: "apply_transition",
						trackId: "text",
						elementId: "inside",
						presetId: "not-a-preset",
						side: "in",
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("unknown transition preset");
	});

	test("accepts apply_transition with a known preset on a visual element", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Fade in",
				summary: "",
				operations: [
					{
						type: "apply_transition",
						trackId: "text",
						elementId: "inside",
						presetId: "fade",
						side: "in",
					},
				],
			},
			tracks,
		});

		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);
	});

	test("rejects retime_element on non-retimable elements", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Speed up text",
				summary: "",
				operations: [
					{
						type: "retime_element",
						trackId: "text",
						elementId: "inside",
						rate: 2,
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("not a video or audio element");
	});

	test("accepts retime_element on audio elements", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Speed up audio",
				summary: "",
				operations: [
					{
						type: "retime_element",
						trackId: "audio-track",
						elementId: "audio",
						rate: 1.5,
					},
				],
			},
			tracks,
		});

		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);
	});

	test("rejects hiding elements that cannot be hidden", () => {
		const result = validateAiEditPlan({
			value: {
				title: "Hide audio",
				summary: "",
				operations: [
					{
						type: "set_element_state",
						trackId: "audio-track",
						elementId: "audio",
						hidden: true,
					},
				],
			},
			tracks,
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain("not a visual element");
	});

	test("applies insert_html_element as a hyperframe graphic", () => {
		const inserted: Array<{ element: unknown; placement: unknown }> = [];
		const editor = {
			scenes: {
				getActiveSceneOrNull: () => ({ tracks }),
			},
			timeline: {
				insertElement: (params: { element: unknown; placement: unknown }) =>
					inserted.push(params),
			},
		} as unknown as EditorCore;

		applyAiEditPlan({
			editor,
			plan: {
				title: "Insert HTML frame",
				summary: "",
				operations: [
					{
						type: "insert_html_element",
						name: "Kinetic title",
						html: "<div>Hello</div>",
						startTime: t(0),
						duration: t(240_000),
					},
				],
			},
		});

		expect(inserted).toHaveLength(1);
		expect(inserted[0]?.element).toMatchObject({
			type: "graphic",
			definitionId: "hyperframe",
			name: "Kinetic title",
			duration: t(240_000),
			params: {
				html: "<div>Hello</div>",
				sourceWidth: 1920,
				sourceHeight: 1080,
			},
		});
		expect(inserted[0]?.placement).toEqual({
			mode: "auto",
			trackType: "video",
		});
	});

	test("applies set_track_state through mute/visibility toggles", () => {
		const calls: string[] = [];
		const editor = {
			scenes: {
				getActiveSceneOrNull: () => ({ tracks }),
			},
			timeline: {
				getTrackById: ({ trackId }: { trackId: string }) =>
					trackId === "audio-track" ? tracks.audio[0] : null,
				toggleTrackMute: () => calls.push("mute"),
				toggleTrackVisibility: () => calls.push("visibility"),
			},
		} as unknown as EditorCore;

		applyAiEditPlan({
			editor,
			plan: {
				title: "Mute audio track",
				summary: "",
				operations: [
					{
						type: "set_track_state",
						trackId: "audio-track",
						muted: true,
					},
				],
			},
		});

		expect(calls).toEqual(["mute"]);
	});
});
