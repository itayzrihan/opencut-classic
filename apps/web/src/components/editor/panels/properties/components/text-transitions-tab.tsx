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
	| "transform.rotate";

type TransitionState = Partial<Record<TransitionProperty, number>>;

interface TransitionPreset {
	id: string;
	label: string;
	state: TransitionState;
}

const CONTROLLED_PROPERTIES: TransitionProperty[] = [
	"opacity",
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
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
	const uniqueKeys = keys.filter((key, index) => (
		index === 0 || Math.abs(key.time - keys[index - 1].time) > 0.0005
	));
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

	for (const property of CONTROLLED_PROPERTIES) {
		delete nextAnimations[property];
		const usesIn = inPreset.state[property] != null;
		const usesOut = outPreset.state[property] != null;
		if (!usesIn && !usesOut) continue;

		const base = readBaseValue({ element, property });
		const keys: Array<{ time: number; value: number }> = [{ time: 0, value: base }];
		if (usesIn && inEnd > 0) {
			keys[0] = {
				time: 0,
				value: transitionValue({ element, property, state: inPreset.state }),
			};
			keys.push({ time: inEnd, value: base });
		}
		if (usesOut && outStart < durationSeconds) {
			keys.push({ time: outStart, value: base });
			keys.push({
				time: durationSeconds,
				value: transitionValue({ element, property, state: outPreset.state }),
			});
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
