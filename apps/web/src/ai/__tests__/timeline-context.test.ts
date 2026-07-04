import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	buildTimelineContextIndex,
	buildTimelineDocument,
	getElementsInRange,
	getLayersInRange,
	rangesOverlap,
	searchElements,
	searchLayers,
} from "@/ai/timeline-context";
import { buildTimelineContextPrompt } from "@/ai/timeline-tools";
import type { EditorCore } from "@/core";

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

	test("builds a prioritized timeline document", () => {
		const document = buildTimelineDocument({
			tracks,
			range: { startTime: t(250), endTime: t(360) },
			selectedElements: [{ trackId: "text-track", elementId: "word-1" }],
			maxElements: 2,
		});
		const parsed = JSON.parse(document) as {
			elements: Array<{
				elementId: string;
				selected?: boolean;
				inActiveRange?: boolean;
			}>;
			totals: { truncated: boolean };
		};

		expect(parsed.totals.truncated).toBe(true);
		expect(parsed.elements.map((element) => element.elementId)).toEqual([
			"video-1",
			"word-1",
		]);
		expect(parsed.elements[1]?.selected).toBe(true);
		expect(parsed.elements[0]?.inActiveRange).toBe(true);
	});

	test("includes timeline source in the prompt", () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixture only implements the editor APIs this prompt builder reads.
		const editor = {
			scenes: {
				getActiveSceneOrNull: () => ({
					bookmarks: [],
					tracks,
				}),
			},
			project: {
				getActiveOrNull: () => ({
					metadata: { name: "Prompt Smoke" },
				}),
			},
			media: {
				getAssets: () => [],
			},
			playback: {
				getCurrentTime: () => t(0),
			},
		} as unknown as EditorCore;

		const prompt = buildTimelineContextPrompt({
			editor,
			range: { startTime: t(250), endTime: t(360) },
			includeActiveRange: true,
		});

		expect(prompt).toContain("Timeline summary:");
		expect(prompt).toContain("Active range summary: 2 layers and 2 elements");
		expect(prompt).toContain("OPENCUT_TIMELINE_SOURCE");
		expect(prompt).toContain('el {"id":"word-2"');
	});
});
