import { describe, expect, test } from "bun:test";
import { AI_SKILLS, listAiSkills, loadAiSkill } from "@/ai/skills";
import { hyperframeGraphicDefinition } from "@/graphics/definitions/hyperframe";
import { getHyperframeRasterTimeBucket } from "@/graphics/html-raster";

describe("AI skills", () => {
	test("lists every skill with name and description only", () => {
		const listed = listAiSkills();
		expect(listed).toHaveLength(AI_SKILLS.length);
		expect(listed.map((skill) => skill.name)).toEqual([
			"hyperframe-authoring",
			"motion-graphics",
			"text-effects",
			"video-workflows",
		]);
		for (const skill of listed) {
			expect(skill.description.length).toBeGreaterThan(0);
			expect("content" in skill).toBe(false);
		}
	});

	test("loads skills by name, tolerating slash prefixes and casing", () => {
		expect(loadAiSkill({ name: "hyperframe-authoring" })?.content).toContain(
			"--hf-delay",
		);
		expect(loadAiSkill({ name: "/Motion-Graphics" })?.name).toBe(
			"motion-graphics",
		);
		expect(loadAiSkill({ name: "unknown" })).toBeNull();
	});
});

describe("hyperframe graphic definition", () => {
	test("derives source size from params with clamping", () => {
		expect(
			hyperframeGraphicDefinition.sourceSize?.({
				params: { html: "", sourceWidth: 1280, sourceHeight: 720 },
			}),
		).toEqual({ width: 1280, height: 720 });
		expect(
			hyperframeGraphicDefinition.sourceSize?.({
				params: { html: "", sourceWidth: 1, sourceHeight: 999_999 },
			}),
		).toEqual({ width: 16, height: 4096 });
		expect(
			hyperframeGraphicDefinition.sourceSize?.({
				params: { html: "" },
			}),
		).toEqual({ width: 1920, height: 1080 });
	});

	test("buckets raster time at 30fps for cache stability", () => {
		expect(getHyperframeRasterTimeBucket({ timeSeconds: 0 })).toBe(0);
		expect(getHyperframeRasterTimeBucket({ timeSeconds: 0.5 })).toBe(0.5);
		expect(
			getHyperframeRasterTimeBucket({ timeSeconds: 1.001 }),
		).toBeCloseTo(1, 5);
	});
});
