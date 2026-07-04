import type { EffectDefinition } from "@/effects/types";
import type { ParamValues } from "@/params";

export const CUSTOM_AI_EFFECT_TYPE = "custom-ai-effect";

const EFFECT_TYPE_ALIASES = new Map<string, string>([
	["blur-zoom", "blur"],
	["zoom-blur", "blur"],
	["blurzoom", "blur"],
]);

export function normalizeEffectType(effectType: string): string {
	const normalized = effectType.trim().toLowerCase().replace(/[\s_]+/g, "-");
	if (EFFECT_TYPE_ALIASES.has(normalized)) {
		return EFFECT_TYPE_ALIASES.get(normalized) ?? normalized;
	}
	if (/\bblur\b/.test(normalized)) {
		return "blur";
	}
	return normalized;
}

export function buildCustomAiEffectParams({
	requestedType,
}: {
	requestedType: string;
}): ParamValues {
	const trimmed = requestedType.trim();
	return {
		label: trimmed || "Custom AI effect",
		requestedType: trimmed || "custom",
		renderHint:
			"Stored as an AI-requested custom effect. Add a renderer or translate it into supported params to make it visible in export.",
	};
}

export const customAiEffectDefinition: EffectDefinition = {
	type: CUSTOM_AI_EFFECT_TYPE,
	name: "Custom AI Effect",
	keywords: ["ai", "custom", "hyperframes", "extension"],
	params: [
		{
			key: "label",
			label: "Label",
			type: "text",
			default: "Custom AI effect",
			keyframable: false,
		},
		{
			key: "requestedType",
			label: "Requested Effect",
			type: "text",
			default: "custom",
			keyframable: false,
		},
		{
			key: "renderHint",
			label: "Render Hint",
			type: "text",
			default:
				"Stored as an AI-requested custom effect. Add a renderer or translate it into supported params to make it visible in export.",
			keyframable: false,
		},
	],
	renderer: {
		passes: [],
		buildPasses: () => [],
	},
};
