import { describe, expect, test } from "bun:test";
import {
	buildCustomAiEffectParams,
	CUSTOM_AI_EFFECT_TYPE,
} from "@/effects/custom-ai-effect";
import { buildFrameDescriptor } from "@/services/renderer/compositor/frame-descriptor";
import { EffectLayerNode } from "@/services/renderer/nodes/effect-layer-node";
import { resolveRenderTree } from "@/services/renderer/resolve";

const renderer = {
	width: 1920,
	height: 1080,
};

describe("effect layer node resolution", () => {
	test("resolves non-renderable custom AI effects to an overlay", async () => {
		const node = new EffectLayerNode({
			effectType: CUSTOM_AI_EFFECT_TYPE,
			effectParams: buildCustomAiEffectParams({
				requestedType: "explode letters",
				label: "Explode letters",
				intent: "Explode each letter outward.",
				spec: { keyframes: [{ x: 40, opacity: 0 }] },
			}),
			timeOffset: 0,
			duration: 100,
		});

		await resolveRenderTree({ node, renderer, time: 50 });

		expect(node.resolved?.passes).toEqual([]);
		expect(node.resolved?.overlay).toEqual({
			label: "Explode letters",
			intent: "Explode each letter outward.",
		});
	});

	test("resolves blur-like custom AI effects to passes without an overlay", async () => {
		const node = new EffectLayerNode({
			effectType: CUSTOM_AI_EFFECT_TYPE,
			effectParams: buildCustomAiEffectParams({
				requestedType: "blur zoom",
				label: "Blur zoom",
				spec: { from: { filter: "blur(18px)" } },
			}),
			timeOffset: 0,
			duration: 100,
		});

		await resolveRenderTree({ node, renderer, time: 50 });

		expect(node.resolved?.passes.length).toBeGreaterThan(0);
		expect(node.resolved?.overlay).toBeNull();
	});

	test("serializes scene effect pass groups with the WASM field name", async () => {
		const node = new EffectLayerNode({
			effectType: "blur",
			effectParams: { intensity: 15 },
			timeOffset: 0,
			duration: 100,
		});

		await resolveRenderTree({ node, renderer, time: 50 });
		const { frame } = await buildFrameDescriptor({ node, renderer });

		expect(frame.items[0]).toMatchObject({
			type: "sceneEffect",
			effect_pass_groups: expect.any(Array),
		});
		expect("effectPassGroups" in (frame.items[0] ?? {})).toBe(false);
	});
});
