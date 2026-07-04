import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ElementClipboardItem } from "@/clipboard";
import type {
	SceneTracks,
	TextElement,
	TextTrack,
	VideoTrack,
} from "@/timeline";
import { mediaTime, ZERO_MEDIA_TIME } from "@/wasm";

let activeTracks: SceneTracks | null = null;
const fakeEditor = {
	scenes: {
		getActiveScene: () => {
			if (!activeTracks) {
				throw new Error("No test tracks configured");
			}
			return { tracks: activeTracks };
		},
	},
	timeline: {
		updateTracks: (nextTracks: SceneTracks) => {
			activeTracks = nextTracks;
		},
	},
};

mock.module("@/core", () => ({
	EditorCore: {
		getInstance: () => fakeEditor,
	},
}));

let commands: {
	DeleteElementsCommand: typeof import("@/commands/timeline/element/delete-elements").DeleteElementsCommand;
	PasteCommand: typeof import("@/commands/timeline/clipboard/paste").PasteCommand;
	SplitElementsCommand: typeof import("@/commands/timeline/element/split-elements").SplitElementsCommand;
};

beforeAll(async () => {
	const deleteElements = await import(
		"@/commands/timeline/element/delete-elements"
	);
	const paste = await import("@/commands/timeline/clipboard/paste");
	const splitElements = await import(
		"@/commands/timeline/element/split-elements"
	);
	commands = {
		DeleteElementsCommand: deleteElements.DeleteElementsCommand,
		PasteCommand: paste.PasteCommand,
		SplitElementsCommand: splitElements.SplitElementsCommand,
	};
});

afterEach(() => {
	activeTracks = null;
});

function textElement({
	id,
	startTimeTicks = 0,
	durationTicks = 100,
}: {
	id: string;
	startTimeTicks?: number;
	durationTicks?: number;
}): TextElement {
	return {
		id,
		type: "text",
		name: id,
		startTime: mediaTime({ ticks: startTimeTicks }),
		duration: mediaTime({ ticks: durationTicks }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {
			content: id,
			fontSize: 32,
			fontFamily: "sans-serif",
			color: "#ffffff",
			textAlign: "left",
			fontWeight: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			"transform.positionX": 0,
			"transform.positionY": 0,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
			opacity: 1,
		},
	};
}

function textTrack({
	id,
	elements = [],
}: {
	id: string;
	elements?: TextTrack["elements"];
}): TextTrack {
	return {
		id,
		type: "text",
		name: id,
		elements,
		hidden: false,
	};
}

function mainTrack(): VideoTrack {
	return {
		id: "main",
		type: "video",
		name: "main",
		elements: [],
		muted: false,
		hidden: false,
	};
}

function mockEditorWithTracks(initialTracks: SceneTracks): {
	getTracks: () => SceneTracks;
} {
	activeTracks = initialTracks;
	return {
		getTracks: () => {
			if (!activeTracks) {
				throw new Error("No test tracks configured");
			}
			return activeTracks;
		},
	};
}

function textClipboardItem({
	trackId,
	elementId,
}: {
	trackId: string;
	elementId: string;
}): ElementClipboardItem {
	const { id: _id, ...element } = textElement({ id: elementId });
	return {
		trackId,
		trackType: "text",
		element,
	};
}

describe("timeline commands preserve display track order", () => {
	test("delete elements keeps the explicit track order", () => {
		const initialTracks: SceneTracks = {
			overlay: [
				textTrack({
					id: "text-1",
					elements: [textElement({ id: "caption" })],
				}),
				textTrack({ id: "text-2" }),
			],
			main: mainTrack(),
			audio: [],
			order: ["text-2", "main", "text-1"],
		};
		const editor = mockEditorWithTracks(initialTracks);

		new commands.DeleteElementsCommand({
			elements: [{ trackId: "text-1", elementId: "caption" }],
		}).execute();

		expect(editor.getTracks().order).toEqual(initialTracks.order);
		expect(editor.getTracks().overlay[0].elements).toHaveLength(0);
	});

	test("split elements keeps the explicit track order", () => {
		const initialTracks: SceneTracks = {
			overlay: [
				textTrack({
					id: "text-1",
					elements: [textElement({ id: "caption", durationTicks: 100 })],
				}),
				textTrack({ id: "text-2" }),
			],
			main: mainTrack(),
			audio: [],
			order: ["text-2", "main", "text-1"],
		};
		const editor = mockEditorWithTracks(initialTracks);

		new commands.SplitElementsCommand({
			elements: [{ trackId: "text-1", elementId: "caption" }],
			splitTime: mediaTime({ ticks: 40 }),
		}).execute();

		expect(editor.getTracks().order).toEqual(initialTracks.order);
		expect(editor.getTracks().overlay[0].elements).toHaveLength(2);
	});

	test("paste resolves source row from visible display order", () => {
		const initialTracks: SceneTracks = {
			overlay: [
				textTrack({ id: "source" }),
				textTrack({ id: "top" }),
				textTrack({ id: "above-source" }),
			],
			main: mainTrack(),
			audio: [],
			order: ["top", "above-source", "source", "main"],
		};
		const editor = mockEditorWithTracks(initialTracks);
		const clipboardItems: ElementClipboardItem[] = [
			textClipboardItem({ trackId: "source", elementId: "copied" }),
		];

		new commands.PasteCommand({
			time: mediaTime({ ticks: 200 }),
			clipboardItems,
		}).execute();

		const tracks = editor.getTracks();
		const top = tracks.overlay.find((track) => track.id === "top");
		const aboveSource = tracks.overlay.find(
			(track) => track.id === "above-source",
		);
		expect(top?.elements).toHaveLength(0);
		expect(aboveSource?.elements).toHaveLength(1);
		expect(tracks.order).toEqual(initialTracks.order);
	});
});
