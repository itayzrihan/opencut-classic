import type { EffectDefinition } from "@/effects/types";
import type { ParamValues } from "@/params";
import {
	buildGaussianBlurPasses,
	intensityToSigma,
} from "@/effects/definitions/blur";

export const CUSTOM_AI_EFFECT_TYPE = "custom-ai-effect";
export const CUSTOM_AI_EFFECT_SCHEMA_VERSION = "1";

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
	label,
	kind,
	intent,
	spec,
}: {
	requestedType: string;
	label?: string;
	kind?: string;
	intent?: string;
	spec?: unknown;
}): ParamValues {
	const trimmed = requestedType.trim();
	const resolvedLabel = label?.trim() || trimmed || "Custom AI edit";
	const resolvedKind = kind?.trim() || "effect";
	const resolvedIntent = intent?.trim() || trimmed || resolvedLabel;
	return {
		schemaVersion: CUSTOM_AI_EFFECT_SCHEMA_VERSION,
		label: resolvedLabel,
		kind: resolvedKind,
		requestedType: trimmed || "custom",
		intent: resolvedIntent,
		specJson: stringifyCustomAiEffectSpec({
			spec:
				spec ??
				({
					type: trimmed || "custom",
					kind: resolvedKind,
					intent: resolvedIntent,
				} satisfies Record<string, unknown>),
		}),
		status: "hosted",
		renderHint:
			"Stored as an AI-requested custom edit. Add an interpreter/renderer or translate this spec into supported OpenCut operations to make it visible in export.",
	};
}

export function stringifyCustomAiEffectSpec({ spec }: { spec: unknown }): string {
	if (typeof spec === "string") {
		const trimmed = spec.trim();
		if (!trimmed) {
			return "{}";
		}
		const parsed = parseJson({ value: trimmed });
		return parsed ? stableStringify(parsed) : trimmed;
	}
	return stableStringify(spec ?? {});
}

function parseJson({ value }: { value: string }): unknown | null {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortForStableStringify(value), null, 2);
}

function sortForStableStringify(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortForStableStringify);
	}
	if (typeof value !== "object" || value === null) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, nestedValue]) => [
				key,
				sortForStableStringify(nestedValue),
			]),
	);
}

function buildCustomAiEffectPasses({
	effectParams,
	width,
	height,
}: {
	effectParams: ParamValues;
	width: number;
	height: number;
}) {
	const intensity = resolveBlurIntensity({ params: effectParams });
	if (intensity === null || intensity <= 0) {
		return [];
	}

	return buildGaussianBlurPasses({
		sigmaX: intensityToSigma({
			intensity,
			resolution: width,
			reference: 1920,
		}),
		sigmaY: intensityToSigma({
			intensity,
			resolution: height,
			reference: 1080,
		}),
	});
}

function resolveBlurIntensity({
	params,
}: {
	params: ParamValues;
}): number | null {
	const text = [
		params.label,
		params.kind,
		params.requestedType,
		params.intent,
		params.specJson,
	]
		.filter((value) => typeof value === "string")
		.join(" ")
		.toLowerCase();
	const spec = parseJson({
		value: typeof params.specJson === "string" ? params.specJson : "",
	});
	const intensityFromSpec = findLargestBlurNumber({ value: spec });
	if (intensityFromSpec !== null) {
		return clampBlurIntensity({ value: intensityFromSpec });
	}
	if (text.includes("blur")) {
		return 15;
	}
	return null;
}

function findLargestBlurNumber({ value }: { value: unknown }): number | null {
	let largest: number | null = null;
	const visit = ({ current, parentKey }: { current: unknown; parentKey: string }) => {
		if (typeof current === "number" && Number.isFinite(current)) {
			if (parentKey.toLowerCase().includes("blur")) {
				largest = Math.max(largest ?? 0, current);
			}
			return;
		}
		if (typeof current === "string") {
			const parsed = Number.parseFloat(current);
			if (Number.isFinite(parsed) && parentKey.toLowerCase().includes("blur")) {
				largest = Math.max(largest ?? 0, parsed);
			}
			const blurMatch = current.match(/blur\D*(\d+(?:\.\d+)?)/i);
			if (blurMatch?.[1]) {
				const blurValue = Number.parseFloat(blurMatch[1]);
				if (Number.isFinite(blurValue)) {
					largest = Math.max(largest ?? 0, blurValue);
				}
			}
			return;
		}
		if (Array.isArray(current)) {
			for (const item of current) {
				visit({ current: item, parentKey });
			}
			return;
		}
		if (typeof current === "object" && current !== null) {
			for (const [key, nestedValue] of Object.entries(current)) {
				visit({ current: nestedValue, parentKey: key });
			}
		}
	};
	visit({ current: value, parentKey: "" });
	return largest;
}

function clampBlurIntensity({ value }: { value: number }): number {
	return Math.max(0, Math.min(100, value));
}

export const customAiEffectDefinition: EffectDefinition = {
	type: CUSTOM_AI_EFFECT_TYPE,
	name: "Custom AI Edit",
	keywords: ["ai", "custom", "hyperframes", "extension"],
	params: [
		{
			key: "schemaVersion",
			label: "Schema Version",
			type: "text",
			default: CUSTOM_AI_EFFECT_SCHEMA_VERSION,
			keyframable: false,
		},
		{
			key: "label",
			label: "Label",
			type: "text",
			default: "Custom AI edit",
			keyframable: false,
		},
		{
			key: "kind",
			label: "Kind",
			type: "text",
			default: "effect",
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
			key: "intent",
			label: "Intent",
			type: "text",
			default: "Custom AI edit",
			keyframable: false,
		},
		{
			key: "specJson",
			label: "Spec JSON",
			type: "text",
			default: "{}",
			keyframable: false,
		},
		{
			key: "status",
			label: "Status",
			type: "text",
			default: "hosted",
			keyframable: false,
		},
		{
			key: "renderHint",
			label: "Render Hint",
			type: "text",
			default:
				"Stored as an AI-requested custom edit. Add an interpreter/renderer or translate this spec into supported OpenCut operations to make it visible in export.",
			keyframable: false,
		},
	],
	renderer: {
		passes: [],
		buildPasses: buildCustomAiEffectPasses,
	},
};
