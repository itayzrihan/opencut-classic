import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import { validateAiEditPlan } from "@/ai/edit-plan";
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
});
