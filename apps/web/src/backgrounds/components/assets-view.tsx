"use client";

import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { useEditor } from "@/editor/use-editor";
import {
	BACKGROUND_PRESETS,
	type BackgroundPreset,
} from "@/backgrounds/presets";
import { buildGraphicPreviewUrl } from "@/graphics";
import { buildGraphicElement } from "@/timeline/element-utils";
import Image from "next/image";

const BACKGROUND_DEFINITION_ID = "preset-background";

export function BackgroundsView() {
	return (
		<PanelView title="Backgrounds">
			<div
				className="grid gap-2"
				style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}
			>
				{BACKGROUND_PRESETS.map((preset) => (
					<BackgroundPresetItem key={preset.id} preset={preset} />
				))}
			</div>
		</PanelView>
	);
}

function BackgroundPresetItem({ preset }: { preset: BackgroundPreset }) {
	const editor = useEditor();
	const previewUrl = buildGraphicPreviewUrl({
		definitionId: BACKGROUND_DEFINITION_ID,
		params: preset.params,
		size: 256,
	});

	const handleAddToTimeline = () => {
		const element = buildGraphicElement({
			definitionId: BACKGROUND_DEFINITION_ID,
			name: preset.name,
			startTime: editor.playback.getCurrentTime(),
			params: preset.params,
		});
		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "graphic" },
			element,
		});
	};

	return (
		<DraggableItem
			name={preset.name}
			preview={
				<div className="relative size-full">
					<Image
						src={previewUrl}
						alt=""
						className="size-full object-cover"
						width={256}
						height={144}
						unoptimized
					/>
					<div className="absolute inset-x-0 bottom-0 bg-black/45 px-1.5 py-1">
						<p className="truncate text-[10px] leading-none text-white/85">
							{preset.description}
						</p>
					</div>
				</div>
			}
			dragData={{
				id: preset.id,
				name: preset.name,
				type: "graphic",
				definitionId: BACKGROUND_DEFINITION_ID,
				params: preset.params,
			}}
			onAddToTimeline={handleAddToTimeline}
			aspectRatio={16 / 9}
			variant="card"
			containerClassName="w-full"
		/>
	);
}
