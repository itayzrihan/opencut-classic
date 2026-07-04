import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import type { TextTrack } from "@/timeline";

export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
	captionSource,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	captionSource?: TextTrack["captionSource"];
}): string | null {
	if (captions.length === 0) {
		return null;
	}

	const addTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const insertCommands = captions.map(
		(caption, index) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: buildSubtitleTextElement({
					index,
					caption,
					canvasSize,
				}),
			}),
	);
	editor.command.execute({
		command: new BatchCommand([addTrackCommand, ...insertCommands]),
	});
	if (captionSource) {
		const activeScene = editor.scenes.getActiveScene();
		editor.timeline.updateTracks({
			...activeScene.tracks,
			overlay: activeScene.tracks.overlay.map((track) =>
				track.id === trackId && track.type === "text"
					? { ...track, captionSource }
					: track,
			),
		});
	}

	return trackId;
}
