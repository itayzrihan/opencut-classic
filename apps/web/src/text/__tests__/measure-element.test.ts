import { describe, expect, test } from "bun:test";
import type { TextElement, TextWordRun } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import {
	CAPTION_WORD_ANIMATIONS,
	getCaptionWordAnimation,
} from "@/text/caption-presets";
import {
	getTextMeasurementContext,
	measureTextElement,
	resolveAutoTextDirection,
} from "@/text/measure-element";
import { mediaTime, TICKS_PER_SECOND, ZERO_MEDIA_TIME } from "@/wasm";

const ONE_SECOND = mediaTime({ ticks: TICKS_PER_SECOND });
const HALF_SECOND = mediaTime({ ticks: TICKS_PER_SECOND / 2 });

function createTextElement(
	overrides: Omit<Partial<TextElement>, "type" | "params"> & {
		params?: Partial<TextElement["params"]>;
	} = {},
): TextElement {
	const { params, ...rest } = overrides;
	return {
		...DEFAULTS.text.element,
		...rest,
		id: rest.id ?? "text-1",
		params: {
			...DEFAULTS.text.element.params,
			...params,
		} as TextElement["params"],
	};
}

function timedRun({
	id,
	text,
	lineIndex = 0,
	...overrides
}: Omit<Partial<TextWordRun>, "id" | "text" | "lineIndex"> & {
	id: string;
	text: string;
	lineIndex?: number;
}): TextWordRun {
	return {
		id,
		text,
		lineIndex,
		startTime: ZERO_MEDIA_TIME,
		endTime: ONE_SECOND,
		...overrides,
	};
}

function measureWord({
	element,
	lineIndex = 0,
	wordIndex = 0,
}: {
	element: TextElement;
	lineIndex?: number;
	wordIndex?: number;
}) {
	const measured = measureTextElement({
		element,
		canvasHeight: 1080,
		localTime: HALF_SECOND,
		ctx: getTextMeasurementContext(),
	});
	const word = measured.wordLines?.[lineIndex]?.words[wordIndex];
	if (!word) {
		throw new Error(`Missing measured word ${lineIndex}:${wordIndex}`);
	}
	return word;
}

describe("text word direction", () => {
	test("detects the first strong character for auto direction", () => {
		expect(resolveAutoTextDirection("   שלום")).toBe("rtl");
		expect(resolveAutoTextDirection("   Hello שלום")).toBe("ltr");
		expect(resolveAutoTextDirection("123 !?")).toBe("ltr");
	});

	test("auto letter reveal marks Hebrew words as RTL and reveals logical prefixes", () => {
		const word = measureWord({
			element: createTextElement({
				captionRevealMode: "letter-by-letter",
				captionWordDirection: "auto",
				wordRuns: [timedRun({ id: "hebrew", text: "שלום" })],
				params: { content: "שלום" },
			}),
		});

		expect(word.direction).toBe("rtl");
		expect(word.drawText).toBe("של");
	});

	test("auto direction is resolved per row and per word", () => {
		const element = createTextElement({
			captionRevealMode: "letter-by-letter",
			captionWordDirection: "auto",
			wordRuns: [
				timedRun({ id: "hebrew", text: "שלום", lineIndex: 0 }),
				timedRun({ id: "english", text: "Hello", lineIndex: 1 }),
			],
			params: { content: "שלום\nHello" },
		});

		expect(measureWord({ element, lineIndex: 0 }).direction).toBe("rtl");
		expect(measureWord({ element, lineIndex: 1 }).direction).toBe("ltr");
	});

	test("explicit word auto direction can override an explicit parent direction", () => {
		const word = measureWord({
			element: createTextElement({
				captionRevealMode: "letter-by-letter",
				captionWordDirection: "rtl",
				wordRuns: [
					timedRun({ id: "english", text: "Hello", wordDirection: "auto" }),
				],
				params: { content: "Hello" },
			}),
		});

		expect(word.direction).toBe("ltr");
		expect(word.drawText).toBe("Hel");
	});
});

describe("text word animation reveal precedence", () => {
	test("exposes none as the neutral word animation fallback", () => {
		expect(CAPTION_WORD_ANIMATIONS[0]?.id).toBe("none");
		expect(getCaptionWordAnimation({ wordAnimationId: "none" }).name).toBe(
			"None",
		);
		expect(getCaptionWordAnimation({ wordAnimationId: "missing" }).id).toBe(
			"none",
		);
	});

	test("none uses a whole-row reveal without word motion", () => {
		const word = measureWord({
			element: createTextElement({
				captionRevealMode: "determined-by-preset",
				captionTransitionIn: "blur-zoom",
				captionWordAnimationId: "none",
				wordRuns: [timedRun({ id: "hello", text: "Hello" })],
				params: { content: "Hello" },
			}),
		});

		expect(word.drawText).toBe("Hello");
		expect(word.opacity).toBe(1);
		expect(word.scale).toBe(1);
		expect(word.blur).toBe(0);
		expect(word.offsetX).toBe(0);
		expect(word.offsetY).toBe(0);
	});

	test("missing transition in defaults to no entrance motion", () => {
		const word = measureWord({
			element: createTextElement({
				captionRevealMode: "spoken-word",
				captionWordAnimationId: "none",
				wordRuns: [timedRun({ id: "hello", text: "Hello" })],
				params: { content: "Hello" },
			}),
		});

		expect(word.opacity).toBe(1);
		expect(word.scale).toBe(1);
		expect(word.blur).toBe(0);
	});

	test("fixed reveal modes ignore preset character reveal", () => {
		const word = measureWord({
			element: createTextElement({
				captionRevealMode: "spoken-word",
				captionTransitionIn: "none",
				captionWordAnimationId: "letter-laser-1",
				wordRuns: [timedRun({ id: "hello", text: "Hello" })],
				params: { content: "Hello" },
			}),
		});

		expect(word.drawText).toBe("Hello");
	});

	test("determined-by-preset keeps preset character reveal", () => {
		const word = measureWord({
			element: createTextElement({
				captionRevealMode: "determined-by-preset",
				captionWordAnimationId: "letter-laser-1",
				wordRuns: [timedRun({ id: "hello", text: "Hello" })],
				params: { content: "Hello" },
			}),
		});

		expect(word.drawText).toBe("Hel");
	});

	test("synthesizes render timing for presentation-only multiline word runs", () => {
		const measured = measureTextElement({
			element: createTextElement({
				duration: mediaTime({ ticks: TICKS_PER_SECOND * 2 }),
				captionRevealMode: "spoken-word",
				captionWordAnimationId: "none",
				wordRuns: [
					{ id: "word-0", text: "one", lineIndex: 0 },
					{ id: "word-1", text: "two", lineIndex: 1 },
				],
				params: { content: "one\ntwo" },
			}),
			canvasHeight: 1080,
			localTime: HALF_SECOND,
			ctx: getTextMeasurementContext(),
		});

		expect(measured.wordLines?.[0]?.words[0]?.opacity).toBe(1);
		expect(measured.wordLines?.[1]?.words[0]?.opacity).toBe(0);
	});

	test("applies word animation presets to presentation-only multiline word runs", () => {
		const word = measureWord({
			element: createTextElement({
				duration: mediaTime({ ticks: TICKS_PER_SECOND * 2 }),
				captionRevealMode: "determined-by-preset",
				captionWordAnimationId: "kinetic-slam-1",
				wordRuns: [
					{ id: "word-0", text: "one", lineIndex: 0 },
					{ id: "word-1", text: "two", lineIndex: 1 },
				],
				params: { content: "one\ntwo" },
			}),
		});

		expect(word.opacity).toBe(1);
		expect(word.scale).toBeGreaterThan(1);
		expect(word.offsetY).toBeLessThan(0);
	});
});

describe("text stroke and shadow effects", () => {
	test("measures layer stroke and shadow and expands visual bounds", () => {
		const plain = measureTextElement({
			element: createTextElement({
				params: { content: "Hello" },
			}),
			canvasHeight: 1080,
			localTime: HALF_SECOND,
			ctx: getTextMeasurementContext(),
		});
		const styled = measureTextElement({
			element: createTextElement({
				params: {
					content: "Hello",
					"stroke.enabled": true,
					"stroke.color": "#112233",
					"stroke.width": 6,
					"shadow.enabled": true,
					"shadow.color": "#445566",
					"shadow.blur": 8,
					"shadow.offsetX": 5,
					"shadow.offsetY": -3,
				},
			}),
			canvasHeight: 1080,
			localTime: HALF_SECOND,
			ctx: getTextMeasurementContext(),
		});

		expect(styled.stroke).toEqual({ color: "#112233", width: 6 });
		expect(styled.shadow).toEqual({
			color: "#445566",
			blur: 8,
			offsetX: 5,
			offsetY: -3,
		});
		expect(styled.visualRect.left).toBeLessThan(plain.visualRect.left);
		expect(styled.visualRect.top).toBeLessThan(plain.visualRect.top);
		expect(styled.visualRect.width).toBeGreaterThan(plain.visualRect.width);
		expect(styled.visualRect.height).toBeGreaterThan(plain.visualRect.height);
	});

	test("applies layer stroke and shadow to measured caption words", () => {
		const word = measureWord({
			element: createTextElement({
				captionWordAnimationId: "none",
				wordRuns: [timedRun({ id: "hello", text: "Hello" })],
				params: {
					content: "Hello",
					"stroke.enabled": true,
					"stroke.color": "#123456",
					"stroke.width": 4,
					"shadow.enabled": true,
					"shadow.color": "#654321",
					"shadow.blur": 7,
					"shadow.offsetX": -2,
					"shadow.offsetY": 3,
				},
			}),
		});

		expect(word.strokeColor).toBe("#123456");
		expect(word.strokeWidth).toBe(4);
		expect(word.shadowColor).toBe("#654321");
		expect(word.shadowBlur).toBe(7);
		expect(word.shadowOffsetX).toBe(-2);
		expect(word.shadowOffsetY).toBe(3);
	});
});
