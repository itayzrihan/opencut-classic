import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { CaptionLayoutSettings } from "@/subtitles/caption-layout";
import type {
	SceneTracks,
	TextElement,
	TextTrack,
	VideoTrack,
} from "@/timeline";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";

mock.module("@/commands/timeline/tracks-snapshot", () => ({
	TracksSnapshotCommand: class TracksSnapshotCommand {},
}));

const originalDocument = globalThis.document;
let DEFAULT_CAPTION_LAYOUT: CaptionLayoutSettings;
let syncCaptionSourceWordsFromElements: Awaited<
	typeof import("@/subtitles/caption-source-sync")
>["syncCaptionSourceWordsFromElements"];
let syncTextLayerWordsIntoCaptionSource: Awaited<
	typeof import("@/subtitles/caption-source-sync")
>["syncTextLayerWordsIntoCaptionSource"];
let removeTextLayerWordsFromCaptionSource: Awaited<
	typeof import("@/subtitles/caption-source-sync")
>["removeTextLayerWordsFromCaptionSource"];
let rebuildCaptionTracksWithSource: Awaited<
	typeof import("@/subtitles/caption-tracks")
>["rebuildCaptionTracksWithSource"];

beforeAll(async () => {
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			createElement: () => ({
				getContext: () => null,
			}),
		},
	});
	({ DEFAULT_CAPTION_LAYOUT } = await import("@/subtitles/caption-layout"));
	({
		syncCaptionSourceWordsFromElements,
		syncTextLayerWordsIntoCaptionSource,
		removeTextLayerWordsFromCaptionSource,
	} = await import("@/subtitles/caption-source-sync"));
	({ rebuildCaptionTracksWithSource } =
		await import("@/subtitles/caption-tracks"));
});

afterAll(() => {
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: originalDocument,
	});
});

function textElement({
	id,
	text,
	start,
	end,
	params = {},
	wordRuns,
}: {
	id: string;
	text: string;
	start: number;
	end: number;
	params?: Partial<TextElement["params"]>;
	wordRuns?: TextElement["wordRuns"];
}): TextElement {
	return {
		id,
		type: "text",
		name: text,
		startTime: mediaTimeFromSeconds({ seconds: start }),
		duration: mediaTimeFromSeconds({ seconds: end - start }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {
			content: text,
			...params,
		},
		wordRuns: wordRuns ?? [
			{
				id: "word-0",
				text,
				lineIndex: 0,
				startTime: ZERO_MEDIA_TIME,
				endTime: mediaTimeFromSeconds({ seconds: end - start }),
			},
		],
	};
}

function textTrack({
	id = "captions",
	elements,
	settings,
	words = [
		{ text: "Hello", start: 0, end: 1 },
		{ text: "world", start: 1.2, end: 2 },
	],
}: {
	id?: string;
	elements: TextElement[];
	settings: CaptionLayoutSettings;
	words?: NonNullable<TextTrack["captionSource"]>["words"];
}): TextTrack {
	return {
		id,
		type: "text",
		name: "Captions",
		hidden: false,
		elements,
		captionSource: {
			words,
			settings,
			layerIndex: 0,
			layerCount: 1,
		},
	};
}

function manualTextTrack({
	id = "manual-text",
	elements,
}: {
	id?: string;
	elements: TextElement[];
}): TextTrack {
	return {
		id,
		type: "text",
		name: "Manual text",
		hidden: false,
		elements,
	};
}

function mainTrack(): VideoTrack {
	return {
		id: "main",
		type: "video",
		name: "Main",
		elements: [],
		muted: false,
		hidden: false,
	};
}

function elementContent({ element }: { element: TextElement }) {
	return typeof element.params.content === "string"
		? element.params.content
		: "";
}

describe("syncCaptionSourceWordsFromElements", () => {
	test("renders hidden punctuation without mutating source words", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			hidePunctuation: true,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					elements: [
						textElement({ id: "hello", text: "Hello", start: 0, end: 1 }),
					],
					settings,
					words: [{ text: "Hello,", start: 0, end: 1 }],
				}),
			],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = rebuildCaptionTracksWithSource({
			tracks,
			words: [{ text: "Hello,", start: 0, end: 1 }],
			settings,
			canvasSize: { width: 1920, height: 1080 },
			layerCount: 1,
			preserveEditedElements: false,
		});
		const captionTrack = (nextTracks?.overlay ?? []).find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);

		expect(captionTrack?.captionSource?.words[0].text).toBe("Hello,");
		expect(captionTrack?.elements[0]).toBeDefined();
		if (!captionTrack?.elements[0]) {
			throw new Error("Expected rebuilt caption element");
		}
		expect(elementContent({ element: captionTrack.elements[0] })).toBe("Hello");
		expect(captionTrack?.elements[0].wordRuns?.[0]?.text).toBe("Hello");
	});

	test("keeps source punctuation when rendered captions hide punctuation", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			hidePunctuation: true,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const hello = textElement({ id: "hello", text: "Hello", start: 0, end: 1 });
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					elements: [hello],
					settings,
					words: [{ text: "Hello,", start: 0, end: 1 }],
				}),
			],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = syncCaptionSourceWordsFromElements({
			tracks,
			updates: [{ trackId: "captions", elementId: "hello" }],
			canvasSize: { width: 1920, height: 1080 },
		});
		const captionTrack = nextTracks.overlay.find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);

		expect(captionTrack?.captionSource?.words[0].text).toBe("Hello,");
	});

	test("relayouts overlapping caption words without preserving stale duplicates", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const hello = textElement({ id: "hello", text: "Hello", start: 0, end: 1 });
		const world = textElement({
			id: "world",
			text: "world",
			start: 1.2,
			end: 2,
		});
		const movedHello = {
			...hello,
			startTime: mediaTimeFromSeconds({ seconds: 0.5 }),
		};
		const tracks: SceneTracks = {
			overlay: [textTrack({ elements: [movedHello, world], settings })],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = syncCaptionSourceWordsFromElements({
			tracks,
			updates: [{ trackId: "captions", elementId: "hello" }],
			canvasSize: { width: 1920, height: 1080 },
		});
		const captionTracks = nextTracks.overlay.filter(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);
		const captionElements = captionTracks.flatMap((track) => track.elements);

		expect(captionTracks).toHaveLength(2);
		expect(
			captionElements.map((element) => elementContent({ element })).sort(),
		).toEqual(["Hello", "world"]);
		expect(
			captionElements.filter(
				(element) => elementContent({ element }) === "Hello",
			),
		).toHaveLength(1);
		expect(
			captionElements.find((element) => elementContent({ element }) === "Hello")
				?.id,
		).toBe("hello");
		expect(
			captionElements.find((element) => elementContent({ element }) === "world")
				?.id,
		).toBe("world");
		expect(captionTracks[0].captionSource?.words[0]).toMatchObject({
			text: "Hello",
			start: 0.5,
			end: 1.5,
		});
	});

	test("drops stale generated caption copies during canonical transcript relayout", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const staleHello = textElement({
			id: "hello",
			text: "Hello",
			start: 0,
			end: 1.6,
		});
		const world = textElement({
			id: "world",
			text: "world",
			start: 1.2,
			end: 2,
		});
		const tracks: SceneTracks = {
			overlay: [textTrack({ elements: [staleHello, world], settings })],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = rebuildCaptionTracksWithSource({
			tracks,
			words: [
				{ text: "Hello", start: 0, end: 1.6 },
				{ text: "world", start: 1.2, end: 2 },
			],
			settings,
			canvasSize: { width: 1920, height: 1080 },
			layerCount: 1,
			preserveEditedElements: false,
		});
		const captionTracks = (nextTracks?.overlay ?? []).filter(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);
		const nonCaptionTextTracks = (nextTracks?.overlay ?? []).filter(
			(track): track is TextTrack =>
				track.type === "text" && !track.captionSource,
		);
		const captionElements = captionTracks.flatMap((track) => track.elements);

		expect(captionTracks).toHaveLength(2);
		expect(nonCaptionTextTracks).toHaveLength(0);
		expect(
			captionElements.map((element) => elementContent({ element })).sort(),
		).toEqual(["Hello", "world"]);
	});

	test("syncs word text edits without retaining old caption copies", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const editedHello = textElement({
			id: "hello",
			text: "Hi",
			start: 0,
			end: 1,
		});
		const world = textElement({
			id: "world",
			text: "world",
			start: 1.2,
			end: 2,
		});
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					elements: [editedHello, world],
					settings,
					words: [
						{ text: "Hello", start: 0, end: 1 },
						{ text: "world", start: 1.2, end: 2 },
					],
				}),
			],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = syncCaptionSourceWordsFromElements({
			tracks,
			updates: [{ trackId: "captions", elementId: "hello" }],
			canvasSize: { width: 1920, height: 1080 },
		});
		const captionElements = nextTracks.overlay
			.filter(
				(track): track is TextTrack =>
					track.type === "text" && !!track.captionSource,
			)
			.flatMap((track) => track.elements);

		expect(
			captionElements.filter(
				(element) => elementContent({ element }) === "Hello",
			),
		).toHaveLength(0);
		expect(
			captionElements.filter((element) => elementContent({ element }) === "Hi"),
		).toHaveLength(1);
		expect(
			captionElements.map((element) => elementContent({ element })).sort(),
		).toEqual(["Hi", "world"]);
	});

	test("does not relayout captions for scoped word presentation edits", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const hello = textElement({
			id: "hello",
			text: "Hello",
			start: 0,
			end: 1,
			wordRuns: [
				{
					id: "word-0",
					text: "Hello",
					lineIndex: 0,
					startTime: ZERO_MEDIA_TIME,
					endTime: mediaTimeFromSeconds({ seconds: 1 }),
				},
			],
		});
		const styledHello = {
			...hello,
			wordRuns: hello.wordRuns?.map((word) => ({
				...word,
				revealMode: "spoken-word" as const,
				transitionIn: "slide" as const,
			})),
		};
		const previousTracks: SceneTracks = {
			overlay: [textTrack({ elements: [hello], settings })],
			main: mainTrack(),
			audio: [],
		};
		const nextTracksBeforeSync: SceneTracks = {
			...previousTracks,
			overlay: [textTrack({ elements: [styledHello], settings })],
		};

		const nextTracks = syncCaptionSourceWordsFromElements({
			tracks: nextTracksBeforeSync,
			previousTracks,
			updates: [{ trackId: "captions", elementId: "hello" }],
			canvasSize: { width: 1920, height: 1080 },
		});
		const captionTracks = nextTracks.overlay.filter(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);
		const captionElements = captionTracks.flatMap((track) => track.elements);

		expect(captionTracks).toHaveLength(1);
		expect(captionElements).toHaveLength(1);
		expect(captionTracks[0].captionSource?.words).toEqual(
			previousTracks.overlay[0].type === "text"
				? previousTracks.overlay[0].captionSource?.words
				: [],
		);
		expect(captionElements[0].wordRuns?.[0]?.revealMode).toBe("spoken-word");
	});

	test("rebuild removes stale caption source tracks after a text edit", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					id: "captions-old",
					elements: [
						textElement({ id: "old-hello", text: "Hello", start: 0, end: 1 }),
						textElement({ id: "old-world", text: "world", start: 1.2, end: 2 }),
					],
					settings,
					words: [
						{ text: "Hello", start: 0, end: 1 },
						{ text: "world", start: 1.2, end: 2 },
					],
				}),
				textTrack({
					id: "captions-new",
					elements: [
						textElement({ id: "new-hi", text: "Hi", start: 0, end: 1 }),
						textElement({ id: "new-world", text: "world", start: 1.2, end: 2 }),
					],
					settings,
					words: [
						{ text: "Hi", start: 0, end: 1 },
						{ text: "world", start: 1.2, end: 2 },
					],
				}),
			],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = rebuildCaptionTracksWithSource({
			tracks,
			words: [
				{ text: "Hi", start: 0, end: 1 },
				{ text: "world", start: 1.2, end: 2 },
			],
			settings,
			canvasSize: { width: 1920, height: 1080 },
			layerCount: 1,
			preserveEditedElements: false,
		});
		const captionElements = (nextTracks?.overlay ?? [])
			.filter(
				(track): track is TextTrack =>
					track.type === "text" && !!track.captionSource,
			)
			.flatMap((track) => track.elements);

		expect(
			captionElements.filter(
				(element) => elementContent({ element }) === "Hello",
			),
		).toHaveLength(0);
		expect(
			captionElements.map((element) => elementContent({ element })).sort(),
		).toEqual(["Hi", "world"]);
	});

	test("adds manual text layer words to the source without generating duplicate caption layers", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					elements: [
						textElement({ id: "hello", text: "Hello", start: 0, end: 1 }),
					],
					settings,
					words: [{ text: "Hello", start: 0, end: 1 }],
				}),
				manualTextTrack({
					elements: [
						textElement({
							id: "manual-title",
							text: "Manual title",
							start: 2,
							end: 4,
							wordRuns: [],
						}),
					],
				}),
			],
			main: mainTrack(),
			audio: [],
		};

		const syncedTracks = syncTextLayerWordsIntoCaptionSource({
			tracks,
			elements: [{ trackId: "manual-text", elementId: "manual-title" }],
		});
		const captionTrack = syncedTracks.overlay.find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);

		expect(captionTrack?.captionSource?.words.map((word) => word.text)).toEqual([
			"Hello",
			"Manual",
			"title",
		]);
		expect(captionTrack?.captionSource?.words[1].source).toMatchObject({
			type: "text-layer",
			trackId: "manual-text",
			elementId: "manual-title",
			wordIndex: 0,
		});

		const rebuiltTracks = rebuildCaptionTracksWithSource({
			tracks: syncedTracks,
			words: captionTrack?.captionSource?.words ?? [],
			settings,
			canvasSize: { width: 1920, height: 1080 },
			layerCount: 1,
			preserveEditedElements: false,
		});
		const generatedCaptionElements = (rebuiltTracks?.overlay ?? [])
			.filter(
				(track): track is TextTrack =>
					track.type === "text" && !!track.captionSource,
			)
			.flatMap((track) => track.elements);
		const manualTrack = (rebuiltTracks?.overlay ?? []).find(
			(track): track is TextTrack =>
				track.type === "text" && track.id === "manual-text",
		);

		expect(
			generatedCaptionElements.map((element) => elementContent({ element })),
		).toEqual(["Hello"]);
		expect(manualTrack?.elements.map((element) => element.id)).toEqual([
			"manual-title",
		]);
	});

	test("removes manual text layer words from the source when the layer is removed", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					elements: [
						textElement({ id: "hello", text: "Hello", start: 0, end: 1 }),
					],
					settings,
					words: [
						{ text: "Hello", start: 0, end: 1 },
						{
							text: "Manual",
							start: 2,
							end: 3,
							source: {
								type: "text-layer",
								trackId: "manual-text",
								elementId: "manual-title",
								wordIndex: 0,
								wordId: "word-0",
							},
						},
					],
				}),
				manualTextTrack({ elements: [] }),
			],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = removeTextLayerWordsFromCaptionSource({
			tracks,
			elements: [{ trackId: "manual-text", elementId: "manual-title" }],
		});
		const captionTrack = nextTracks.overlay.find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);

		expect(captionTrack?.captionSource?.words.map((word) => word.text)).toEqual([
			"Hello",
		]);
	});

	test("applies caption placement without resetting edited text presentation", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			placementMode: "grid" as const,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const styledHello = textElement({
			id: "hello",
			text: "Hello",
			start: 0,
			end: 1,
			params: {
				fontFamily: "Impact",
				fontSize: 48,
				color: "#ff00ff",
				"transform.positionX": 12,
				"transform.positionY": 24,
				"transform.scaleX": 1.5,
				"background.enabled": true,
				"background.color": "#111111",
			},
		});
		const tracks: SceneTracks = {
			overlay: [textTrack({ elements: [styledHello], settings })],
			main: mainTrack(),
			audio: [],
		};
		const nextSettings = {
			...settings,
			placementMode: "manual" as const,
			manualPositionX: 320,
			manualPositionY: -180,
		};

		const nextTracks = rebuildCaptionTracksWithSource({
			tracks,
			words: [{ text: "Hello", start: 0, end: 1 }],
			settings: nextSettings,
			canvasSize: { width: 1920, height: 1080 },
			layerCount: 1,
			preserveEditedElements: false,
		});
		const captionTrack = (nextTracks?.overlay ?? []).find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);
		const element = captionTrack?.elements[0];

		expect(element?.params.fontFamily).toBe("Impact");
		expect(element?.params.fontSize).toBe(48);
		expect(element?.params.color).toBe("#ff00ff");
		expect(element?.params["transform.scaleX"]).toBe(1.5);
		expect(element?.params["background.enabled"]).toBe(true);
		expect(element?.params["background.color"]).toBe("#111111");
		expect(element?.params["transform.positionX"]).toBe(320);
		expect(element?.params["transform.positionY"]).toBe(-180);
	});

	test("hides punctuation without resetting edited text presentation", () => {
		const settings = {
			...DEFAULT_CAPTION_LAYOUT,
			wordsPerRow: 1,
			rows: 1,
			hidePunctuation: false,
			inPaddingPercent: 0,
			outPaddingPercent: 0,
		};
		const styledHello = textElement({
			id: "hello",
			text: "Hello,",
			start: 0,
			end: 1,
			params: {
				fontFamily: "Impact",
				fontSize: 48,
				color: "#ff00ff",
			},
		});
		const tracks: SceneTracks = {
			overlay: [
				textTrack({
					elements: [styledHello],
					settings,
					words: [{ text: "Hello,", start: 0, end: 1 }],
				}),
			],
			main: mainTrack(),
			audio: [],
		};

		const nextTracks = rebuildCaptionTracksWithSource({
			tracks,
			words: [{ text: "Hello,", start: 0, end: 1 }],
			settings: {
				...settings,
				hidePunctuation: true,
			},
			canvasSize: { width: 1920, height: 1080 },
			layerCount: 1,
			preserveEditedElements: false,
		});
		const captionTrack = (nextTracks?.overlay ?? []).find(
			(track): track is TextTrack =>
				track.type === "text" && !!track.captionSource,
		);
		const element = captionTrack?.elements[0];

		expect(elementContent({ element: element! })).toBe("Hello");
		expect(element?.params.fontFamily).toBe("Impact");
		expect(element?.params.fontSize).toBe(48);
		expect(element?.params.color).toBe("#ff00ff");
	});
});
