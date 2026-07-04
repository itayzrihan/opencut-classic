import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	buildTimelineContextIndex,
	getElementsInRange,
	getLayersInRange,
	rangesOverlap,
	searchElements,
	searchLayers,
} from "@/ai/timeline-context";

const t = (time: number) => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixtures use integer ticks.
	return time as MediaTime;
};

const tracks: SceneTracks = {
	overlay: [
		{
			id: "text-track",
			name: "Captions",
			type: "text",
			hidden: false,
			elements: [
				{
					id: "word-1",
					type: "text",
					name: "hello",
					startTime: t(100),
					duration: t(100),
					trimStart: t(0),
					trimEnd: t(0),
					params: { text: "hello" },
				},
				{
					id: "word-2",
					type: "text",
					name: "world",
					startTime: t(300),
					duration: t(100),
					trimStart: t(0),
					trimEnd: t(0),
					params: { text: "world" },
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
		elements: [
			{
				id: "video-1",
				type: "video",
				name: "clip",
				mediaId: "media-1",
				startTime: t(0),
				duration: t(500),
				trimStart: t(0),
				trimEnd: t(0),
				params: {},
			},
		],
	},
	audio: [],
};

describe("timeline context index", () => {
	test("detects half-open range overlaps", () => {
		expect(
			rangesOverlap({
				firstStart: 0,
				firstEnd: 100,
				secondStart: 100,
				secondEnd: 200,
			}),
		).toBe(false);
		expect(
			rangesOverlap({
				firstStart: 0,
				firstEnd: 101,
				secondStart: 100,
				secondEnd: 200,
			}),
		).toBe(true);
	});

	test("finds elements and layers in a selected range", () => {
		const index = buildTimelineContextIndex({ tracks });
		const range = { startTime: t(250), endTime: t(360) };

		expect(
			getElementsInRange({ index, range }).map((element) => element.elementId),
		).toEqual(["video-1", "word-2"]);
		expect(getLayersInRange({ index, range }).map((layer) => layer.id)).toEqual(
			["text-track", "main"],
		);
	});

	test("pages layer and element search results", () => {
		const index = buildTimelineContextIndex({ tracks });

		expect(searchLayers({ index, query: "main" }).items[0]?.id).toBe("main");
		const firstPage = searchElements({ index, cursor: 0, limit: 1 });
		expect(firstPage.items).toHaveLength(1);
		expect(firstPage.nextCursor).toBe(1);
		expect(searchElements({ index, query: "world" }).items[0]?.elementId).toBe(
			"word-2",
		);
	});
});
