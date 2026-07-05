import { describe, expect, test } from "bun:test";
import {
	mergeTextElements,
	splitTextElementAtTime,
} from "@/text/text-layer-utils";
import type { TextElement, TextWordRun } from "@/timeline";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";

function word({
	id,
	text,
	start,
	end,
}: {
	id: string;
	text: string;
	start: number;
	end: number;
}): TextWordRun {
	return {
		id,
		text,
		lineIndex: 0,
		startTime: mediaTimeFromSeconds({ seconds: start }),
		endTime: mediaTimeFromSeconds({ seconds: end }),
	};
}

function textElement({
	id = "text-1",
	content = "היי קוראים לי איתי",
	start = 10,
	duration = 4,
	wordRuns = [
		word({ id: "word-0", text: "היי", start: 0, end: 1 }),
		word({ id: "word-1", text: "קוראים", start: 1, end: 2 }),
		word({ id: "word-2", text: "לי", start: 2, end: 3 }),
		word({ id: "word-3", text: "איתי", start: 3, end: 4 }),
	],
}: {
	id?: string;
	content?: string;
	start?: number;
	duration?: number;
	wordRuns?: TextWordRun[];
} = {}): TextElement {
	return {
		id,
		type: "text",
		name: id,
		startTime: mediaTimeFromSeconds({ seconds: start }),
		duration: mediaTimeFromSeconds({ seconds: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {
			content,
			fontFamily: "Impact",
			fontSize: 48,
		},
		wordRuns,
	};
}

describe("text layer utils", () => {
	test("splits a text element between words", () => {
		const split = splitTextElementAtTime({
			element: textElement(),
			relativeTime: mediaTimeFromSeconds({ seconds: 1 }),
			splitTime: mediaTimeFromSeconds({ seconds: 11 }),
			rightElementId: "text-2",
		});

		expect(split?.left.params.content).toBe("היי");
		expect(split?.left.duration).toBe(mediaTimeFromSeconds({ seconds: 1 }));
		expect(split?.left.params.fontFamily).toBe("Impact");
		expect(split?.right.id).toBe("text-2");
		expect(split?.right.startTime).toBe(mediaTimeFromSeconds({ seconds: 11 }));
		expect(split?.right.params.content).toBe("קוראים לי איתי");
		expect(split?.right.wordRuns?.map((run) => run.startTime)).toEqual([
			mediaTimeFromSeconds({ seconds: 0 }),
			mediaTimeFromSeconds({ seconds: 1 }),
			mediaTimeFromSeconds({ seconds: 2 }),
		]);
	});

	test("merges selected text elements in timeline order", () => {
		const first = textElement({
			id: "first",
			content: "היי",
			start: 10,
			duration: 1,
			wordRuns: [word({ id: "word-0", text: "היי", start: 0, end: 1 })],
		});
		const second = textElement({
			id: "second",
			content: "קוראים לי איתי",
			start: 11,
			duration: 3,
			wordRuns: [
				word({ id: "word-0", text: "קוראים", start: 0, end: 1 }),
				word({ id: "word-1", text: "לי", start: 1, end: 2 }),
				word({ id: "word-2", text: "איתי", start: 2, end: 3 }),
			],
		});

		const merged = mergeTextElements({
			items: [
				{ trackId: "captions", element: second },
				{ trackId: "captions", element: first },
			],
		});

		expect(merged?.targetElementId).toBe("first");
		expect(merged?.mergedElement.params.content).toBe("היי קוראים לי איתי");
		expect(merged?.mergedElement.startTime).toBe(
			mediaTimeFromSeconds({ seconds: 10 }),
		);
		expect(merged?.mergedElement.duration).toBe(
			mediaTimeFromSeconds({ seconds: 4 }),
		);
		expect(merged?.removeElements).toEqual([
			{ trackId: "captions", elementId: "second" },
		]);
	});
});
