"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Section, SectionContent, SectionField, SectionFields } from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import type {
	ElementAnimations,
	ScalarAnimationChannel,
	ScalarAnimationKey,
} from "@/animation/types";
import type { TimelineElement } from "@/timeline";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { generateUUID } from "@/utils/id";
import { useState } from "react";
import type { ElementWithTrackForParams } from "./element-params-tab";

type TransitionProperty =
	| "opacity"
	| "transform.positionX"
	| "transform.positionY"
	| "transform.scaleX"
	| "transform.scaleY"
	| "transform.rotate"
	| "background.paddingX"
	| "background.paddingY"
	| "background.offsetX"
	| "background.offsetY"
	| "background.cornerRadius";

type TransitionState = Partial<Record<TransitionProperty, number>>;
type TransitionRecipe = Partial<
	Record<TransitionProperty, Array<{ at: number; value: number }>>
>;

interface TransitionPreset {
	id: string;
	label: string;
	state: TransitionState;
	recipe?: TransitionRecipe;
}

const CONTROLLED_PROPERTIES: TransitionProperty[] = [
	"opacity",
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
	"background.cornerRadius",
];

const TRANSITIONS: TransitionPreset[] = [
	{ id: "none", label: "None", state: {} },
	{ id: "fade", label: "Fade", state: { opacity: 0 } },
	{ id: "slide-left", label: "Slide Left", state: { "transform.positionX": -120, opacity: 0 } },
	{ id: "slide-right", label: "Slide Right", state: { "transform.positionX": 120, opacity: 0 } },
	{ id: "slide-up", label: "Slide Up", state: { "transform.positionY": -120, opacity: 0 } },
	{ id: "slide-down", label: "Slide Down", state: { "transform.positionY": 120, opacity: 0 } },
	{ id: "push-left", label: "Push Left", state: { "transform.positionX": -240 } },
	{ id: "push-right", label: "Push Right", state: { "transform.positionX": 240 } },
	{ id: "push-up", label: "Push Up", state: { "transform.positionY": -240 } },
	{ id: "push-down", label: "Push Down", state: { "transform.positionY": 240 } },
	{ id: "zoom-in", label: "Zoom In", state: { "transform.scaleX": 0.25, "transform.scaleY": 0.25, opacity: 0 } },
	{ id: "zoom-out", label: "Zoom Out", state: { "transform.scaleX": 1.8, "transform.scaleY": 1.8, opacity: 0 } },
	{ id: "pop", label: "Pop", state: { "transform.scaleX": 0, "transform.scaleY": 0, opacity: 0 } },
	{ id: "shrink", label: "Shrink", state: { "transform.scaleX": 0.7, "transform.scaleY": 0.7, opacity: 0 } },
	{ id: "grow", label: "Grow", state: { "transform.scaleX": 1.35, "transform.scaleY": 1.35, opacity: 0 } },
	{ id: "flip-x", label: "Flip X", state: { "transform.scaleX": -1, opacity: 0 } },
	{ id: "flip-y", label: "Flip Y", state: { "transform.scaleY": -1, opacity: 0 } },
	{ id: "spin-left", label: "Spin Left", state: { "transform.rotate": -180, opacity: 0 } },
	{ id: "spin-right", label: "Spin Right", state: { "transform.rotate": 180, opacity: 0 } },
	{ id: "tilt-left", label: "Tilt Left", state: { "transform.rotate": -25, opacity: 0 } },
	{ id: "tilt-right", label: "Tilt Right", state: { "transform.rotate": 25, opacity: 0 } },
	{ id: "rise-soft", label: "Rise Soft", state: { "transform.positionY": 45, opacity: 0 } },
	{ id: "drop-soft", label: "Drop Soft", state: { "transform.positionY": -45, opacity: 0 } },
	{ id: "drift-left", label: "Drift Left", state: { "transform.positionX": 45, opacity: 0 } },
	{ id: "drift-right", label: "Drift Right", state: { "transform.positionX": -45, opacity: 0 } },
	{ id: "corner-tl", label: "Corner Top Left", state: { "transform.positionX": -160, "transform.positionY": -90, opacity: 0 } },
	{ id: "corner-tr", label: "Corner Top Right", state: { "transform.positionX": 160, "transform.positionY": -90, opacity: 0 } },
	{ id: "corner-bl", label: "Corner Bottom Left", state: { "transform.positionX": -160, "transform.positionY": 90, opacity: 0 } },
	{ id: "corner-br", label: "Corner Bottom Right", state: { "transform.positionX": 160, "transform.positionY": 90, opacity: 0 } },
	{ id: "squash", label: "Squash", state: { "transform.scaleX": 1.6, "transform.scaleY": 0.25, opacity: 0 } },
	{ id: "stretch", label: "Stretch", state: { "transform.scaleX": 0.35, "transform.scaleY": 1.6, opacity: 0 } },
	{ id: "wipe-left", label: "Wipe Left", state: { "transform.scaleX": 0.05, "transform.positionX": -80, opacity: 0 } },
	{ id: "wipe-right", label: "Wipe Right", state: { "transform.scaleX": 0.05, "transform.positionX": 80, opacity: 0 } },
	{ id: "wipe-up", label: "Wipe Up", state: { "transform.scaleY": 0.05, "transform.positionY": -60, opacity: 0 } },
	{ id: "wipe-down", label: "Wipe Down", state: { "transform.scaleY": 0.05, "transform.positionY": 60, opacity: 0 } },
	{ id: "float-spin", label: "Float Spin", state: { "transform.positionY": 80, "transform.rotate": -90, opacity: 0 } },
	{ id: "snap-spin", label: "Snap Spin", state: { "transform.scaleX": 0.4, "transform.scaleY": 0.4, "transform.rotate": 90, opacity: 0 } },
	{
		id: "typewriter-snap",
		label: "Typewriter Snap",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.18, value: 1 }, { at: 0.32, value: 0.25 }, { at: 0.45, value: 1 }, { at: 1, value: 1 }],
			"transform.positionX": [{ at: 0, value: -18 }, { at: 0.2, value: 8 }, { at: 0.38, value: -4 }, { at: 1, value: 0 }],
			"transform.scaleX": [{ at: 0, value: 0.92 }, { at: 0.25, value: 1.04 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "explode",
		label: "Explode",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.12, value: 1 }, { at: 0.72, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 2.8 }, { at: 0.35, value: 0.82 }, { at: 0.58, value: 1.12 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 2.8 }, { at: 0.35, value: 0.82 }, { at: 0.58, value: 1.12 }, { at: 1, value: 1 }],
			"transform.rotate": [{ at: 0, value: -35 }, { at: 0.35, value: 12 }, { at: 0.62, value: -5 }, { at: 1, value: 0 }],
		},
	},
	{
		id: "implode",
		label: "Implode",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.22, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.02 }, { at: 0.35, value: 1.22 }, { at: 0.65, value: 0.92 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 0.02 }, { at: 0.35, value: 1.22 }, { at: 0.65, value: 0.92 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "glow-pop",
		label: "Fade Glow Pop",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.18, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.72 }, { at: 0.32, value: 1.1 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 0.72 }, { at: 0.32, value: 1.1 }, { at: 1, value: 1 }],
			"background.paddingX": [{ at: 0, value: 44 }, { at: 0.42, value: 22 }, { at: 1, value: 0 }],
			"background.paddingY": [{ at: 0, value: 28 }, { at: 0.42, value: 14 }, { at: 1, value: 0 }],
			"background.cornerRadius": [{ at: 0, value: 48 }, { at: 1, value: 8 }],
		},
	},
	{
		id: "elastic-drop",
		label: "Elastic Drop",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.18, value: 1 }, { at: 1, value: 1 }],
			"transform.positionY": [{ at: 0, value: -220 }, { at: 0.38, value: 28 }, { at: 0.58, value: -16 }, { at: 0.78, value: 7 }, { at: 1, value: 0 }],
			"transform.scaleY": [{ at: 0, value: 1.35 }, { at: 0.38, value: 0.82 }, { at: 0.58, value: 1.08 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "rubber-band",
		label: "Rubber Band",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.1, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.2 }, { at: 0.28, value: 1.35 }, { at: 0.45, value: 0.75 }, { at: 0.65, value: 1.12 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 1.8 }, { at: 0.28, value: 0.72 }, { at: 0.45, value: 1.25 }, { at: 0.65, value: 0.92 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "glitch",
		label: "Glitch",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.08, value: 1 }, { at: 0.16, value: 0.15 }, { at: 0.24, value: 1 }, { at: 0.36, value: 0.45 }, { at: 0.48, value: 1 }, { at: 1, value: 1 }],
			"transform.positionX": [{ at: 0, value: -70 }, { at: 0.12, value: 55 }, { at: 0.2, value: -35 }, { at: 0.34, value: 22 }, { at: 0.52, value: -8 }, { at: 1, value: 0 }],
			"transform.positionY": [{ at: 0, value: 14 }, { at: 0.18, value: -10 }, { at: 0.34, value: 8 }, { at: 1, value: 0 }],
		},
	},
	{
		id: "shake-reveal",
		label: "Shake Reveal",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.18, value: 1 }, { at: 1, value: 1 }],
			"transform.positionX": [{ at: 0, value: -42 }, { at: 0.18, value: 36 }, { at: 0.32, value: -24 }, { at: 0.46, value: 16 }, { at: 0.62, value: -8 }, { at: 1, value: 0 }],
			"transform.rotate": [{ at: 0, value: -8 }, { at: 0.32, value: 7 }, { at: 0.62, value: -3 }, { at: 1, value: 0 }],
		},
	},
	{
		id: "neon-pulse",
		label: "Neon Pulse",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.15, value: 1 }, { at: 0.28, value: 0.35 }, { at: 0.42, value: 1 }, { at: 1, value: 1 }],
			"background.paddingX": [{ at: 0, value: 60 }, { at: 0.25, value: 12 }, { at: 0.5, value: 36 }, { at: 1, value: 0 }],
			"background.paddingY": [{ at: 0, value: 36 }, { at: 0.25, value: 6 }, { at: 0.5, value: 20 }, { at: 1, value: 0 }],
			"background.cornerRadius": [{ at: 0, value: 64 }, { at: 1, value: 8 }],
		},
	},
	{
		id: "cinema-slam",
		label: "Cinema Slam",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.12, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 4.2 }, { at: 0.18, value: 0.88 }, { at: 0.36, value: 1.06 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 0.12 }, { at: 0.18, value: 1.18 }, { at: 0.36, value: 0.95 }, { at: 1, value: 1 }],
			"transform.positionY": [{ at: 0, value: 120 }, { at: 0.18, value: -12 }, { at: 1, value: 0 }],
		},
	},
	{
		id: "orbit-in",
		label: "Orbit In",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.22, value: 1 }, { at: 1, value: 1 }],
			"transform.positionX": [{ at: 0, value: -220 }, { at: 0.35, value: 70 }, { at: 0.68, value: -22 }, { at: 1, value: 0 }],
			"transform.positionY": [{ at: 0, value: 120 }, { at: 0.35, value: -65 }, { at: 0.68, value: 18 }, { at: 1, value: 0 }],
			"transform.rotate": [{ at: 0, value: -270 }, { at: 0.68, value: 35 }, { at: 1, value: 0 }],
		},
	},
	{
		id: "magnetic-snap",
		label: "Magnetic Snap",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.12, value: 1 }, { at: 1, value: 1 }],
			"transform.positionX": [{ at: 0, value: 260 }, { at: 0.28, value: -38 }, { at: 0.48, value: 18 }, { at: 0.7, value: -7 }, { at: 1, value: 0 }],
			"transform.scaleX": [{ at: 0, value: 0.65 }, { at: 0.28, value: 1.16 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 0.65 }, { at: 0.28, value: 1.16 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "heartbeat",
		label: "Heartbeat",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.08, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.72 }, { at: 0.2, value: 1.28 }, { at: 0.36, value: 0.92 }, { at: 0.52, value: 1.16 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 0.72 }, { at: 0.2, value: 1.28 }, { at: 0.36, value: 0.92 }, { at: 0.52, value: 1.16 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "liquid-rise",
		label: "Liquid Rise",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.2, value: 1 }, { at: 1, value: 1 }],
			"transform.positionY": [{ at: 0, value: 160 }, { at: 0.36, value: -24 }, { at: 0.62, value: 12 }, { at: 1, value: 0 }],
			"transform.scaleX": [{ at: 0, value: 1.45 }, { at: 0.36, value: 0.86 }, { at: 0.62, value: 1.08 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 0.4 }, { at: 0.36, value: 1.24 }, { at: 0.62, value: 0.92 }, { at: 1, value: 1 }],
		},
	},
	{
		id: "portal",
		label: "Portal",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.26, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.05 }, { at: 0.42, value: 1.22 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 1.9 }, { at: 0.42, value: 0.82 }, { at: 1, value: 1 }],
			"transform.rotate": [{ at: 0, value: 360 }, { at: 1, value: 0 }],
		},
	},
	{
		id: "strobe-build",
		label: "Strobe Build",
		state: {},
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.12, value: 1 }, { at: 0.22, value: 0 }, { at: 0.32, value: 1 }, { at: 0.42, value: 0.2 }, { at: 0.54, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 1.4 }, { at: 0.54, value: 0.92 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 1.4 }, { at: 0.54, value: 0.92 }, { at: 1, value: 1 }],
		},
	},
];

function clampPercent(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

function getPreset({ id }: { id: string }) {
	return TRANSITIONS.find((transition) => transition.id === id) ?? TRANSITIONS[0];
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
	if (property === "transform.scaleX" || property === "transform.scaleY") return 1;
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
	if (property === "opacity" || property === "transform.scaleX" || property === "transform.scaleY") {
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
	if (property === "opacity" || property === "transform.scaleX" || property === "transform.scaleY") {
		return value;
	}
	return base + value;
}

function getPresetProperties({
	preset,
}: {
	preset: TransitionPreset;
}) {
	return new Set(
		CONTROLLED_PROPERTIES.filter(
			(property) =>
				preset.state[property] != null || preset.recipe?.[property] != null,
		),
	);
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
	if (outStart >= durationSeconds) return [{ time: durationSeconds, value: base }];

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

function buildTransitionAnimations({
	element,
	inTransitionId,
	outTransitionId,
	inPercent,
	outPercent,
}: {
	element: TimelineElement;
	inTransitionId: string;
	outTransitionId: string;
	inPercent: number;
	outPercent: number;
}) {
	const durationSeconds = Math.max(0.001, mediaTimeToSeconds({ time: element.duration }));
	const inPreset = getPreset({ id: inTransitionId });
	const outPreset = getPreset({ id: outTransitionId });
	const inEnd = durationSeconds * (clampPercent(inPercent) / 100);
	const outDuration = durationSeconds * (clampPercent(outPercent) / 100);
	const outStart = Math.max(inEnd, durationSeconds - outDuration);
	const nextAnimations: ElementAnimations = { ...(element.animations ?? {}) };
	const inProperties = getPresetProperties({ preset: inPreset });
	const outProperties = getPresetProperties({ preset: outPreset });

	for (const property of CONTROLLED_PROPERTIES) {
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
			keys.push(...buildInKeysForProperty({
				element,
				property,
				preset: inPreset,
				inEnd,
			}));
		}
		if (usesOut) {
			keys.push(...buildOutKeysForProperty({
				element,
				property,
				preset: outPreset,
				outStart,
				durationSeconds,
			}));
		}

		nextAnimations[property] = scalarChannel({
			keys: keys.sort((left, right) => left.time - right.time),
		});
	}

	return Object.keys(nextAnimations).length > 0 ? nextAnimations : undefined;
}

export function TextTransitionsTab({
	element,
	trackId,
	elementsWithTracks,
}: {
	element: TimelineElement;
	trackId: string;
	elementsWithTracks?: ElementWithTrackForParams[];
}) {
	const editor = useEditor();
	const [inTransitionId, setInTransitionId] = useState("fade");
	const [outTransitionId, setOutTransitionId] = useState("fade");
	const [inPercent, setInPercent] = useState(20);
	const [outPercent, setOutPercent] = useState(20);
	const targets = elementsWithTracks?.length
		? elementsWithTracks
		: [{ track: { id: trackId }, element }];

	const applyTransitions = () => {
		editor.timeline.updateElements({
			updates: targets.map((target) => ({
				trackId: target.track.id,
				elementId: target.element.id,
				patch: {
					animations: buildTransitionAnimations({
						element: target.element,
						inTransitionId,
						outTransitionId,
						inPercent,
						outPercent,
					}),
				},
			})),
		});
	};

	return (
		<Section sectionKey={`${element.id}:transitions`}>
			<SectionContent className="pt-4">
				<SectionFields>
					<SectionField label="In transition">
						<Select value={inTransitionId} onValueChange={setInTransitionId}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{TRANSITIONS.map((transition) => (
									<SelectItem key={transition.id} value={transition.id}>
										{transition.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					<SectionField label="In %">
						<Input
							type="number"
							min={0}
							max={100}
							step={1}
							value={inPercent}
							onChange={(event) =>
								setInPercent(clampPercent(Number(event.currentTarget.value)))
							}
						/>
					</SectionField>
					<SectionField label="Out transition">
						<Select value={outTransitionId} onValueChange={setOutTransitionId}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{TRANSITIONS.map((transition) => (
									<SelectItem key={transition.id} value={transition.id}>
										{transition.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					<SectionField label="Out %">
						<Input
							type="number"
							min={0}
							max={100}
							step={1}
							value={outPercent}
							onChange={(event) =>
								setOutPercent(clampPercent(Number(event.currentTarget.value)))
							}
						/>
					</SectionField>
					<Button type="button" onClick={applyTransitions}>
						Apply transitions
					</Button>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
