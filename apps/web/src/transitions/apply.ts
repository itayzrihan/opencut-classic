import type {
	ElementAnimations,
	ScalarAnimationChannel,
	ScalarAnimationKey,
} from "@/animation/types";
import type { TimelineElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds, mediaTimeToSeconds, type MediaTime } from "@/wasm";
import {
	CONTROLLED_TRANSITION_PROPERTIES,
	getTransitionPreset,
} from "./registry";
import type {
	BuildTransitionAnimationsParams,
	TransitionPreset,
	TransitionProperty,
	TransitionState,
} from "./types";

export const DEFAULT_TRANSITION_PERCENT = 5;
export const MAX_DEFAULT_TRANSITION_SECONDS = 3;

export function clampTransitionPercent(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

function readBaseValue({
	element,
	property,
}: {
	element: TimelineElement;
	property: TransitionProperty;
}) {
	const value = element.params[property];
	if (typeof value === "number") return value;
	if (property === "opacity") return 1;
	if (property === "transform.scaleX" || property === "transform.scaleY") {
		return 1;
	}
	if (property === "background.cornerRadius") return 0;
	return 0;
}

function transitionValue({
	element,
	property,
	state,
}: {
	element: TimelineElement;
	property: TransitionProperty;
	state: TransitionState;
}) {
	const base = readBaseValue({ element, property });
	const offset = state[property];
	if (offset == null) return base;
	if (
		property === "opacity" ||
		property === "transform.scaleX" ||
		property === "transform.scaleY"
	) {
		return offset;
	}
	return base + offset;
}

function transitionRecipeValue({
	element,
	property,
	value,
}: {
	element: TimelineElement;
	property: TransitionProperty;
	value: number;
}) {
	const base = readBaseValue({ element, property });
	if (
		property === "opacity" ||
		property === "transform.scaleX" ||
		property === "transform.scaleY"
	) {
		return value;
	}
	return base + value;
}

function getPresetProperties({ preset }: { preset: TransitionPreset }) {
	return new Set(
		CONTROLLED_TRANSITION_PROPERTIES.filter(
			(property) =>
				preset.state[property] != null || preset.recipe?.[property] != null,
		),
	);
}

function stripTransitionAnimationChannels({
	animations,
}: {
	animations: ElementAnimations | undefined;
}): ElementAnimations | undefined {
	if (!animations) return undefined;
	const nextAnimations: ElementAnimations = { ...animations };
	for (const property of CONTROLLED_TRANSITION_PROPERTIES) {
		delete nextAnimations[property];
	}
	return Object.keys(nextAnimations).length > 0 ? nextAnimations : undefined;
}

function buildInKeysForProperty({
	element,
	property,
	preset,
	inEnd,
}: {
	element: TimelineElement;
	property: TransitionProperty;
	preset: TransitionPreset;
	inEnd: number;
}) {
	const base = readBaseValue({ element, property });
	if (inEnd <= 0) return [{ time: 0, value: base }];

	const recipe = preset.recipe?.[property];
	if (recipe?.length) {
		return recipe.map((key) => ({
			time: key.at * inEnd,
			value: transitionRecipeValue({
				element,
				property,
				value: key.value,
			}),
		}));
	}

	return [
		{
			time: 0,
			value: transitionValue({ element, property, state: preset.state }),
		},
		{ time: inEnd, value: base },
	];
}

function buildOutKeysForProperty({
	element,
	property,
	preset,
	outStart,
	durationSeconds,
}: {
	element: TimelineElement;
	property: TransitionProperty;
	preset: TransitionPreset;
	outStart: number;
	durationSeconds: number;
}) {
	const base = readBaseValue({ element, property });
	if (outStart >= durationSeconds) {
		return [{ time: durationSeconds, value: base }];
	}

	const recipe = preset.recipe?.[property];
	if (recipe?.length) {
		return recipe.map((key) => ({
			time: outStart + (1 - key.at) * (durationSeconds - outStart),
			value: transitionRecipeValue({
				element,
				property,
				value: key.value,
			}),
		}));
	}

	return [
		{ time: outStart, value: base },
		{
			time: durationSeconds,
			value: transitionValue({ element, property, state: preset.state }),
		},
	];
}

function scalarKey({
	time,
	value,
}: {
	time: number;
	value: number;
}): ScalarAnimationKey {
	return {
		id: generateUUID(),
		time: mediaTimeFromSeconds({ seconds: time }),
		value,
		segmentToNext: "linear",
		tangentMode: "flat",
	};
}

function scalarChannel({
	keys,
}: {
	keys: Array<{ time: number; value: number }>;
}): ScalarAnimationChannel {
	const uniqueKeys: Array<{ time: number; value: number }> = [];
	for (const key of keys) {
		const lastKey = uniqueKeys[uniqueKeys.length - 1];
		if (lastKey && Math.abs(key.time - lastKey.time) <= 0.0005) {
			uniqueKeys[uniqueKeys.length - 1] = key;
			continue;
		}
		uniqueKeys.push(key);
	}
	return {
		keys: uniqueKeys.map((key) => scalarKey(key)),
	};
}

export function buildTransitionAnimations({
	element,
	inTransitionId,
	outTransitionId,
	inDuration,
	outDuration,
	inPercent,
	outPercent,
}: BuildTransitionAnimationsParams) {
	const durationSeconds = Math.max(
		0.001,
		mediaTimeToSeconds({ time: element.duration }),
	);
	const inPreset = getTransitionPreset({ id: inTransitionId });
	const outPreset = getTransitionPreset({ id: outTransitionId });
	const inEnd =
		inDuration !== undefined
			? mediaTimeToSeconds({ time: inDuration })
			: durationSeconds * (clampTransitionPercent(inPercent ?? 0) / 100);
	const outDurationSeconds =
		outDuration !== undefined
			? mediaTimeToSeconds({ time: outDuration })
			: durationSeconds * (clampTransitionPercent(outPercent ?? 0) / 100);
	const outStart = Math.max(inEnd, durationSeconds - outDurationSeconds);
	const nextAnimations: ElementAnimations = { ...(element.animations ?? {}) };
	const inProperties = getPresetProperties({ preset: inPreset });
	const outProperties = getPresetProperties({ preset: outPreset });

	for (const property of CONTROLLED_TRANSITION_PROPERTIES) {
		delete nextAnimations[property];
		const usesIn = inProperties.has(property);
		const usesOut = outProperties.has(property);
		if (!usesIn && !usesOut) continue;

		const base = readBaseValue({ element, property });
		const keys: Array<{ time: number; value: number }> = [
			{ time: 0, value: base },
			{ time: durationSeconds, value: base },
		];
		if (usesIn) {
			keys.push(
				...buildInKeysForProperty({
					element,
					property,
					preset: inPreset,
					inEnd,
				}),
			);
		}
		if (usesOut) {
			keys.push(
				...buildOutKeysForProperty({
					element,
					property,
					preset: outPreset,
					outStart,
					durationSeconds,
				}),
			);
		}

		nextAnimations[property] = scalarChannel({
			keys: keys.sort((left, right) => left.time - right.time),
		});
	}

	return Object.keys(nextAnimations).length > 0 ? nextAnimations : undefined;
}

export function buildTransitionPatch({
	element,
	presetId,
	side,
	percent,
	duration,
}: {
	element: TimelineElement;
	presetId: string;
	side: "in" | "out";
	percent?: number;
	duration?: MediaTime;
}): Partial<TimelineElement> {
	const transitionDuration =
		duration ??
		mediaTimeFromSeconds({
			seconds: getDefaultTransitionDurationSeconds({ element, percent }),
		});
	const nextTransitions = { ...(element.transitions ?? {}) };

	if (presetId === "none") {
		delete nextTransitions[side];
		return {
			animations: stripTransitionAnimationChannels({
				animations: element.animations,
			}),
			transitions:
				nextTransitions.in || nextTransitions.out ? nextTransitions : undefined,
		};
	}

	return {
		animations: stripTransitionAnimationChannels({
			animations: element.animations,
		}),
		transitions: {
			...nextTransitions,
			[side]: {
				id: generateUUID(),
				presetId,
				placement: side,
				duration: transitionDuration,
				startTime: side === "out" ? element.duration - transitionDuration : 0,
				createdAt: new Date().toISOString(),
			},
		},
	};
}

export function getDefaultTransitionDurationSeconds({
	element,
	percent = DEFAULT_TRANSITION_PERCENT,
}: {
	element: TimelineElement;
	percent?: number;
}): number {
	const elementSeconds = mediaTimeToSeconds({ time: element.duration });
	const percentSeconds =
		(elementSeconds * clampTransitionPercent(percent)) / 100;
	return Math.max(
		0,
		Math.min(percentSeconds, MAX_DEFAULT_TRANSITION_SECONDS),
	);
}

export function buildTransitionAnimationsFromElement({
	element,
}: {
	element: TimelineElement;
}): ElementAnimations | undefined {
	const inTransitionId = element.transitions?.in?.presetId ?? "none";
	const outTransitionId = element.transitions?.out?.presetId ?? "none";
	if (inTransitionId === "none" && outTransitionId === "none") {
		return element.animations;
	}

	return buildTransitionAnimations({
		element,
		inTransitionId,
		outTransitionId,
		inDuration: element.transitions?.in?.duration,
		outDuration: element.transitions?.out?.duration,
	});
}
