import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import {
	extractAiEditPlanFromText,
	validateAiEditPlan,
} from "@/ai/edit-plan";
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
	audio: [],
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
});
