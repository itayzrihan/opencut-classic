import type { EditorCore } from "@/core";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import type {
	ElementRef,
	OverlayTrack,
	TextTrack,
	TrackType,
} from "@/timeline";
import type { AiTimelineRange, AiToolCall, AiToolDefinition } from "./types";
import {
	buildTimelineContextIndex,
	getElementsInRange,
	getLayersInRange,
	searchElements,
	searchLayers,
} from "./timeline-context";
import { validateAiEditPlan } from "./edit-plan";

export interface TimelineToolContextOptions {
	range?: AiTimelineRange | null;
	selectedElements?: ElementRef[];
	includePreviewImage?: boolean;
}

export interface TimelineToolRuntime {
	tools: AiToolDefinition[];
	executeTool: (toolCall: AiToolCall) => Promise<unknown>;
}

export function createTimelineToolRuntime({
	editor,
	options = {},
}: {
	editor: EditorCore;
	options?: TimelineToolContextOptions;
}): TimelineToolRuntime {
	const tools = createTimelineToolDefinitions();
	const executeTool = async (toolCall: AiToolCall) => {
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) {
			throw new Error("No active scene");
		}

		const mediaAssets = editor.media.getAssets();
		const index = buildTimelineContextIndex({
			tracks: scene.tracks,
			mediaAssets,
		});

		switch (toolCall.name) {
			case "timeline.search_layers":
				return searchLayers({
					index,
					query: getStringArg({ args: toolCall.arguments, key: "query" }),
					types: getTrackTypesArg({ args: toolCall.arguments, key: "types" }),
					cursor:
						getNumberArg({ args: toolCall.arguments, key: "cursor" }) ?? 0,
					limit: getNumberArg({ args: toolCall.arguments, key: "limit" }) ?? 20,
				});
			case "timeline.get_layer": {
				const trackId = requireStringArg({
					args: toolCall.arguments,
					key: "trackId",
				});
				const layer = index.layersById.get(trackId);
				if (!layer) throw new Error(`Layer ${trackId} not found`);
				return {
					layer,
					elements: index.elements.filter(
						(element) => element.trackId === trackId,
					),
				};
			}
			case "timeline.search_elements":
				return searchElements({
					index,
					query: getStringArg({ args: toolCall.arguments, key: "query" }),
					trackId: getStringArg({ args: toolCall.arguments, key: "trackId" }),
					type: getStringArg({ args: toolCall.arguments, key: "type" }),
					range: getBooleanArg({
						args: toolCall.arguments,
						key: "inActiveRange",
					})
						? (options.range ?? undefined)
						: undefined,
					cursor:
						getNumberArg({ args: toolCall.arguments, key: "cursor" }) ?? 0,
					limit: getNumberArg({ args: toolCall.arguments, key: "limit" }) ?? 25,
				});
			case "timeline.get_element": {
				const trackId = requireStringArg({
					args: toolCall.arguments,
					key: "trackId",
				});
				const elementId = requireStringArg({
					args: toolCall.arguments,
					key: "elementId",
				});
				const element = index.elementsById.get(`${trackId}:${elementId}`);
				if (!element) throw new Error(`Element ${elementId} not found`);
				return element;
			}
			case "timeline.get_visible_state":
				return getVisibleState({ editor, range: options.range });
			case "preview.capture_frame":
				return capturePreviewFrame({ editor });
			case "timeline.propose_edit_plan": {
				const validation = validateAiEditPlan({
					value: toolCall.arguments.plan ?? toolCall.arguments,
					tracks: scene.tracks,
					range: options.range,
				});
				return validation;
			}
			default:
				throw new Error(`Unknown tool ${toolCall.name}`);
		}
	};

	return { tools, executeTool };
}

export function createTimelineToolDefinitions(): AiToolDefinition[] {
	return [
		{
			type: "function",
			name: "timeline.search_layers",
			description:
				"Search timeline layers/tracks by name, id, or type. Returns paged summaries only.",
			parameters: objectSchema({
				properties: {
					query: { type: "string" },
					types: {
						type: "array",
						items: {
							type: "string",
							enum: ["video", "text", "audio", "graphic", "effect"],
						},
					},
					cursor: { type: "number" },
					limit: { type: "number" },
				},
			}),
		},
		{
			type: "function",
			name: "timeline.get_layer",
			description: "Get one layer and the elements on it by trackId.",
			parameters: objectSchema({
				properties: {
					trackId: { type: "string" },
				},
				required: ["trackId"],
			}),
		},
		{
			type: "function",
			name: "timeline.search_elements",
			description:
				"Search timeline elements by name, id, text, type, track, and optional active range.",
			parameters: objectSchema({
				properties: {
					query: { type: "string" },
					trackId: { type: "string" },
					type: { type: "string" },
					inActiveRange: { type: "boolean" },
					cursor: { type: "number" },
					limit: { type: "number" },
				},
			}),
		},
		{
			type: "function",
			name: "timeline.get_element",
			description:
				"Get a single timeline element summary by trackId and elementId.",
			parameters: objectSchema({
				properties: {
					trackId: { type: "string" },
					elementId: { type: "string" },
				},
				required: ["trackId", "elementId"],
			}),
		},
		{
			type: "function",
			name: "timeline.get_visible_state",
			description:
				"Get current playhead, active range, bookmarks, selected elements, and visible preview bounds.",
			parameters: objectSchema({ properties: {} }),
		},
		{
			type: "function",
			name: "preview.capture_frame",
			description:
				"Capture the current preview frame as a compact data URL for visual context.",
			parameters: objectSchema({ properties: {} }),
		},
		{
			type: "function",
			name: "timeline.propose_edit_plan",
			description:
				"Validate a proposed AiEditPlan against the current timeline and active range before final response.",
			parameters: objectSchema({
				properties: {
					plan: { type: "object" },
				},
				required: ["plan"],
			}),
		},
	];
}

export function buildAiSystemPrompt(): string {
	return [
		"You are an in-app video editing agent for OpenCut.",
		"Use tools to inspect timeline layers instead of asking for the whole project.",
		"Never invent trackId, elementId, effectId, or keyframeId values. Look them up first.",
		"Keep edits inside the selected range when a range is active.",
		"Supported operations: update_element, insert_text_element, trim_element, move_element, split_element, delete_element, add_clip_effect, update_clip_effect_params, upsert_keyframe, remove_keyframe.",
		"For insert_text_element, provide content, startTime, duration, and optional trackId, name, params, and reason.",
		"Before the final answer, validate your proposed plan with timeline.propose_edit_plan.",
		'Your final answer must be JSON only and match this shape: {"title":"...","summary":"...","operations":[],"notes":[]}.',
		"Return an empty operations array when no edit is needed.",
	].join("\n");
}

export function buildTimelineContextPrompt({
	editor,
	range,
	selectedElements = [],
	includePlayheadTime,
	includeBookmarks,
	includeSelectedElements,
	includeActiveRange,
	includeCaptions,
	includeMediaSummary,
}: {
	editor: EditorCore;
	range?: AiTimelineRange | null;
	selectedElements?: ElementRef[];
	includePlayheadTime?: boolean;
	includeBookmarks?: boolean;
	includeSelectedElements?: boolean;
	includeActiveRange?: boolean;
	includeCaptions?: boolean;
	includeMediaSummary?: boolean;
}): string {
	const scene = editor.scenes.getActiveSceneOrNull();
	const project = editor.project.getActiveOrNull();
	if (!scene || !project) {
		return "No active project is loaded.";
	}

	const parts: string[] = [`Project: ${project.metadata.name}`];
	if (includePlayheadTime) {
		parts.push(`Playhead time ticks: ${editor.playback.getCurrentTime()}`);
	}
	if (includeActiveRange && range) {
		parts.push(`Active range ticks: ${range.startTime} to ${range.endTime}`);
		const index = buildTimelineContextIndex({
			tracks: scene.tracks,
			mediaAssets: editor.media.getAssets(),
		});
		parts.push(
			`Range layers: ${JSON.stringify(getLayersInRange({ index, range }))}`,
		);
		parts.push(
			`Range elements: ${JSON.stringify(getElementsInRange({ index, range }).slice(0, 30))}`,
		);
	}
	if (includeSelectedElements) {
		parts.push(`Selected elements: ${JSON.stringify(selectedElements)}`);
	}
	if (includeBookmarks) {
		parts.push(`Bookmarks: ${JSON.stringify(scene.bookmarks)}`);
	}
	if (includeMediaSummary) {
		parts.push(
			`Media assets: ${JSON.stringify(
				editor.media.getAssets().map((asset) => ({
					id: asset.id,
					name: asset.name,
					type: asset.type,
					duration: asset.duration,
					width: asset.width,
					height: asset.height,
				})),
			)}`,
		);
	}
	if (includeCaptions) {
		parts.push(
			`Caption tracks: ${JSON.stringify(
				scene.tracks.overlay.filter(isGeneratedCaptionTrack).map((track) => ({
					trackId: track.id,
					name: track.name,
					wordCount: track.captionSource.words.length,
					settings: track.captionSource.settings,
				})),
			)}`,
		);
	}

	return parts.join("\n");
}

async function getVisibleState({
	editor,
	range,
}: {
	editor: EditorCore;
	range?: AiTimelineRange | null;
}) {
	const scene = editor.scenes.getActiveSceneOrNull();
	const project = editor.project.getActiveOrNull();
	if (!scene || !project) {
		return { error: "No active project" };
	}
	const currentTime = editor.playback.getCurrentTime();
	return {
		currentTime,
		activeRange: range ?? null,
		bookmarks: scene.bookmarks,
		visibleElements: getVisibleElementsWithBounds({
			tracks: scene.tracks,
			currentTime,
			canvasSize: project.settings.canvasSize,
			mediaAssets: editor.media.getAssets(),
		}).map((item) => ({
			trackId: item.trackId,
			elementId: item.elementId,
			name: item.element.name,
			type: item.element.type,
			bounds: item.bounds,
		})),
	};
}

async function capturePreviewFrame({ editor }: { editor: EditorCore }) {
	const snapshot = await editor.renderer.captureSnapshot();
	if (!snapshot.success) {
		return snapshot;
	}
	const dataUrl = await blobToDataUrl(snapshot.blob);
	return {
		success: true,
		filename: snapshot.filename,
		mimeType: snapshot.blob.type || "image/png",
		dataUrl,
	};
}

function objectSchema({
	properties,
	required = [],
}: {
	properties: Record<string, unknown>;
	required?: string[];
}): Record<string, unknown> {
	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

function getStringArg({
	args,
	key,
}: {
	args: Record<string, unknown>;
	key: string;
}): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

function requireStringArg({
	args,
	key,
}: {
	args: Record<string, unknown>;
	key: string;
}): string {
	const value = getStringArg({ args, key });
	if (!value) {
		throw new Error(`Missing ${key}`);
	}
	return value;
}

function getNumberArg({
	args,
	key,
}: {
	args: Record<string, unknown>;
	key: string;
}): number | undefined {
	const value = args[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function getBooleanArg({
	args,
	key,
}: {
	args: Record<string, unknown>;
	key: string;
}): boolean {
	return args[key] === true;
}

function getTrackTypesArg({
	args,
	key,
}: {
	args: Record<string, unknown>;
	key: string;
}): TrackType[] | undefined {
	const value = args[key];
	if (!Array.isArray(value)) {
		return undefined;
	}
	const trackTypes = value.filter(isTrackType);
	return trackTypes.length > 0 ? trackTypes : undefined;
}

function isTrackType(value: unknown): value is TrackType {
	return (
		value === "video" ||
		value === "text" ||
		value === "audio" ||
		value === "graphic" ||
		value === "effect"
	);
}

function isGeneratedCaptionTrack(track: OverlayTrack): track is TextTrack & {
	captionSource: NonNullable<TextTrack["captionSource"]>;
} {
	return track.type === "text" && track.captionSource !== undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () =>
			reject(reader.error ?? new Error("Failed to read frame"));
		reader.readAsDataURL(blob);
	});
}
