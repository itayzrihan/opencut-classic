"use client";

import { useCallback } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { CUSTOM_AI_EFFECT_TYPE } from "@/effects";
import { useEditor } from "@/editor/use-editor";
import { buildEffectElement } from "@/timeline/element-utils";
import { VISUAL_ELEMENT_TYPES } from "@/timeline";
import { TRANSITION_PRESETS, type TransitionPreset } from "@/transitions";

export function TransitionsView() {
	return (
		<PanelView title="Transitions">
			<div
				className="grid gap-2"
				style={{ gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))" }}
			>
				{TRANSITION_PRESETS.filter((transition) => transition.id !== "none").map(
					(transition) => (
						<TransitionItem key={transition.id} transition={transition} />
					),
				)}
			</div>
		</PanelView>
	);
}

function TransitionItem({ transition }: { transition: TransitionPreset }) {
	const editor = useEditor();
	const handleAddToTimeline = useCallback(() => {
		const currentTime = editor.playback.getCurrentTime();
		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect" },
			element: buildEffectElement({
				effectType: CUSTOM_AI_EFFECT_TYPE,
				name: `Transition: ${transition.label}`,
				startTime: currentTime,
				params: {
					label: transition.label,
					kind: "transition",
					intent: "Timeline transition adjustment layer",
					transitionId: transition.id,
				},
			}),
		});
	}, [editor, transition.id, transition.label]);

	return (
		<DraggableItem
			name={transition.label}
			preview={<TransitionPreview transition={transition} />}
			dragData={{
				id: transition.id,
				name: transition.label,
				type: "transition",
				transitionId: transition.id,
				targetElementTypes: VISUAL_ELEMENT_TYPES,
			}}
			onAddToTimeline={handleAddToTimeline}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}

function TransitionPreview({ transition }: { transition: TransitionPreset }) {
	return (
		<div className="bg-muted flex size-full items-center justify-center overflow-hidden">
			<div className="relative h-12 w-16">
				<div className="absolute top-2 left-1 h-8 w-8 rounded-sm bg-primary/80" />
				<div className="absolute right-1 bottom-2 h-8 w-8 rounded-sm border border-primary bg-background shadow-sm" />
				<div className="absolute inset-x-3 top-1/2 h-px bg-primary/60" />
			</div>
			<span className="sr-only">{transition.label}</span>
		</div>
	);
}
