import { describe, expect, test } from "bun:test";
import {
	buildDefaultEffectInstance,
	CUSTOM_AI_EFFECT_TYPE,
	getEffectDefinition,
	normalizeEffectType,
} from "@/effects";

describe("custom AI effect fallback", () => {
	test("normalizes descriptive blur requests to the built-in blur effect", () => {
		expect(normalizeEffectType("blur zoom")).toBe("blur");
		expect(normalizeEffectType("Zoom Blur")).toBe("blur");

		const effect = buildDefaultEffectInstance({ effectType: "blur zoom" });

		expect(effect.type).toBe("blur");
		expect(effect.params.intensity).toBe(15);
	});

	test("stores unknown descriptive effects as editable custom AI effects", () => {
		const effect = buildDefaultEffectInstance({
			effectType: "liquid neon chromatic burst",
		});
		const definition = getEffectDefinition(effect.type);

		expect(effect.type).toBe(CUSTOM_AI_EFFECT_TYPE);
		expect(effect.params.requestedType).toBe("liquid neon chromatic burst");
		expect(definition.name).toBe("Custom AI Effect");
		expect(
			definition.renderer.buildPasses?.({
				effectParams: effect.params,
				width: 1920,
				height: 1080,
			}),
		).toEqual([]);
	});
});
