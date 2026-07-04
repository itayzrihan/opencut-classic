import { describe, expect, test } from "bun:test";
import type { TextElement, TextWordRun } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
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
		},
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
