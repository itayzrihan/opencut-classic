import { generateUUID } from "@/utils/id";
import { buildDefaultParamValues } from "@/params/registry";
import { effectsRegistry } from "./registry";
import type { ParamValues } from "@/params";
import type { Effect, EffectDefinition, EffectPass } from "@/effects/types";
import { VISUAL_ELEMENT_TYPES } from "@/timeline";
import { registerDefaultEffects } from "./definitions";
import {
	buildCustomAiEffectParams,
	CUSTOM_AI_EFFECT_TYPE,
	normalizeEffectType,
} from "./custom-ai-effect";

export { effectsRegistry } from "./registry";
export { registerDefaultEffects } from "./definitions";
export { CUSTOM_AI_EFFECT_TYPE, normalizeEffectType } from "./custom-ai-effect";

export function getEffectDefinition(effectType: string): EffectDefinition {
	registerDefaultEffects();
	const normalizedType = normalizeEffectType(effectType);
	if (effectsRegistry.has(normalizedType)) {
		return effectsRegistry.get(normalizedType);
	}
	return effectsRegistry.get(CUSTOM_AI_EFFECT_TYPE);
}

export function resolveEffectPasses({
	definition,
	effectParams,
	width,
	height,
}: {
	definition: EffectDefinition;
	effectParams: ParamValues;
	width: number;
	height: number;
}): EffectPass[] {
	if (definition.renderer.buildPasses) {
		return definition.renderer.buildPasses({ effectParams, width, height });
	}
	return definition.renderer.passes.map((pass) => ({
		shader: pass.shader,
		uniforms: pass.uniforms({ effectParams, width, height }),
	}));
}

export const EFFECT_TARGET_ELEMENT_TYPES = VISUAL_ELEMENT_TYPES;

export function buildDefaultEffectInstance({
	effectType,
}: {
	effectType: string;
}): Effect {
	registerDefaultEffects();
	const normalizedType = normalizeEffectType(effectType);
	const isKnownEffect = effectsRegistry.has(normalizedType);
	const definition = isKnownEffect
		? effectsRegistry.get(normalizedType)
		: effectsRegistry.get(CUSTOM_AI_EFFECT_TYPE);
	const params: ParamValues = isKnownEffect
		? buildDefaultParamValues(definition.params)
		: buildCustomAiEffectParams({ requestedType: effectType });

	return {
		id: generateUUID(),
		type: definition.type,
		params,
		enabled: true,
	};
}
