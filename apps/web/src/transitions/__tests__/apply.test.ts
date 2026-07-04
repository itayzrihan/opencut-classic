import { describe, expect, test } from "bun:test";
import type { VideoElement } from "@/timeline";
import {
	TRANSITION_PRESETS,
	buildTransitionAnimations,
	buildTransitionPatch,
} from "@/transitions";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";

function buildVideoElement(overrides: Partial<VideoElement> = {}): VideoElement {
	return {
		id: "video-1",
		type: "video",
		name: "Video",
		mediaId: "media-1",
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTimeFromSeconds({ seconds: 10 }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {
			opacity: 1,
			"transform.positionX": 0,
			"transform.positionY": 0,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
		},
		...overrides,
	};
}

describe("transitions", () => {
	test("exports a populated transition library", () => {
		expect(TRANSITION_PRESETS.length).toBeGreaterThan(20);
		expect(TRANSITION_PRESETS.map((preset) => preset.id)).toContain("fade");
		expect(TRANSITION_PRESETS.map((preset) => preset.id)).toContain("glitch");
	});

	test("builds in and out animation channels", () => {
		const element = buildVideoElement();
		const animations = buildTransitionAnimations({
			element,
			inTransitionId: "fade",
			outTransitionId: "slide-left",
			inPercent: 20,
			outPercent: 30,
		});

		expect(animations?.opacity?.keys.length).toBeGreaterThanOrEqual(4);
		expect(animations?.["transform.positionX"]?.keys.length).toBeGreaterThanOrEqual(3);
	});

	test("records transition metadata for clip starts and ends", () => {
		const element = buildVideoElement();
		const inPatch = buildTransitionPatch({
			element,
			presetId: "fade",
			side: "in",
			percent: 20,
		});
		const outPatch = buildTransitionPatch({
			element: { ...element, ...inPatch },
			presetId: "slide-left",
			side: "out",
			percent: 20,
		});

		expect(inPatch.transitions?.in?.presetId).toBe("fade");
		expect(outPatch.transitions?.in?.presetId).toBe("fade");
		expect(outPatch.transitions?.out?.presetId).toBe("slide-left");
	});
});
