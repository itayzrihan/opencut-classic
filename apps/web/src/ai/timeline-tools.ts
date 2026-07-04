import type { EditorCore } from "@/core";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import type {
	ElementRef,
	OverlayTrack,
	TextTrack,
	TrackType,
} from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import type { AiTimelineRange, AiToolCall, AiToolDefinition } from "./types";
import { listAiSkills, loadAiSkill } from "./skills";
import {
	buildTimelineContextIndex,
	getElementsInRange,
	getLayersInRange,
	searchElements,
	searchLayers,
} from "./timeline-context";
import { validateAiEditPlan } from "./edit-plan";
import {
	diffTimelineSource,
	parseTimelineSource,
	serializeTimelineSource,
	type TimelineSourceState,
} from "./timeline-source";
import { applySourceEdits, type SourceEdit } from "./source-edits";
import type { AiEditPlan } from "./types";

export interface TimelineToolContextOptions {
	range?: AiTimelineRange | null;
	selectedElements?: ElementRef[];
	includePreviewImage?: boolean;
	includeLayerAccess?: boolean;
}

export interface TimelineToolRuntime {
	tools: AiToolDefinition[];
	executeTool: (toolCall: AiToolCall) => Promise<unknown>;
	/** Plan accumulated from timeline.edit_source calls, if any succeeded. */
	getSourceEditPlan: () => AiEditPlan | null;
}

export function createTimelineToolRuntime({
	editor,
	options = {},
}: {
	editor: EditorCore;
	options?: TimelineToolContextOptions;
}): TimelineToolRuntime {
	const includeLayerAccess = options.includeLayerAccess ?? true;
	const tools = createTimelineToolDefinitions().filter((tool) => {
		if (tool.name === "preview.capture_frame") {
			return options.includePreviewImage === true;
		}
		if (
			tool.name === "timeline.propose_edit_plan" ||
			tool.name === "timeline.edit_source" ||
			tool.name === "timeline.read_source" ||
			tool.name === "timeline.list_media" ||
			tool.name === "skills.list" ||
			tool.name === "skills.load"
		) {
			return true;
		}
		return includeLayerAccess;
	});

	let sourceState: (TimelineSourceState & { currentText: string }) | null =
		null;
	let sourceEditPlan: AiEditPlan | null = null;
	const getSourceState = () => {
		if (!sourceState) {
			const scene = editor.scenes.getActiveSceneOrNull();
			if (!scene) {
				throw new Error("No active scene");
			}
			const serialized = serializeTimelineSource({ tracks: scene.tracks });
			sourceState = { ...serialized, currentText: serialized.text };
		}
		return sourceState;
	};

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
			case "timeline.read_source": {
				return { source: getSourceState().currentText };
			}
			case "timeline.edit_source": {
				const state = getSourceState();
				const edits = getSourceEditsArg({ args: toolCall.arguments });
				const editedText = applySourceEdits({
					content: state.currentText,
					edits,
				});
				const before = parseTimelineSource({ text: state.text });
				const after = parseTimelineSource({ text: editedText });
				const diff = diffTimelineSource({
					before,
					after,
					idMap: state.idMap,
				});
				if (diff.errors.length > 0) {
					throw new Error(
						`Source edits were not applied:\n${diff.errors.join("\n")}`,
					);
				}
				const validation = validateAiEditPlan({
					value: {
						title: "Timeline source edits",
						summary: "",
						operations: diff.operations,
					},
					tracks: scene.tracks,
					range: options.range,
					mediaAssets,
				});
				if (!validation.success || !validation.plan) {
					throw new Error(
						`Source edits were not applied because the resulting operations failed validation:\n${validation.errors.join("\n")}`,
					);
				}
				state.currentText = editedText;
				sourceEditPlan = validation.plan;
				return {
					success: true,
					appliedEdits: edits.length,
					pendingOperations: validation.plan.operations.length,
					operationTypes: validation.plan.operations.map(
						(operation) => operation.type,
					),
					notes: diff.notes,
					message:
						'Edits staged. They apply when the user approves the plan. Make further timeline.edit_source calls to refine, then reply with a short JSON {"title":...,"summary":...} and no operations.',
				};
			}
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
			case "timeline.list_media":
				return {
					mediaAssets: mediaAssets.map((asset) => ({
						id: asset.id,
						name: asset.name,
						type: asset.type,
						durationSeconds: asset.duration,
						durationTicks: asset.duration
							? Math.round(asset.duration * TICKS_PER_SECOND)
							: undefined,
						width: asset.width,
						height: asset.height,
					})),
				};
			case "skills.list":
				return { skills: listAiSkills() };
			case "skills.load": {
				const name = requireStringArg({
					args: toolCall.arguments,
					key: "name",
				});
				const skill = loadAiSkill({ name });
				if (!skill) {
					throw new Error(
						`Unknown skill ${name}. Available: ${listAiSkills()
							.map((candidate) => candidate.name)
							.join(", ")}`,
					);
				}
				return skill;
			}
			case "preview.capture_frame":
				return capturePreviewFrame({ editor });
			case "timeline.propose_edit_plan": {
				const validation = validateAiEditPlan({
					value: toolCall.arguments.plan ?? toolCall.arguments,
					tracks: scene.tracks,
					range: options.range,
					mediaAssets,
				});
				return validation;
			}
			default:
				throw new Error(`Unknown tool ${toolCall.name}`);
		}
	};

	return {
		tools,
		executeTool,
		getSourceEditPlan: () => sourceEditPlan,
	};
}

function getSourceEditsArg({
	args,
}: {
	args: Record<string, unknown>;
}): SourceEdit[] {
	const raw = args.edits;
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error(
			'timeline.edit_source needs edits: [{"oldText":"...","newText":"..."}].',
		);
	}
	return raw.map((entry, index) => {
		if (typeof entry !== "object" || entry === null) {
			throw new Error(
				`edits[${index}] must be an object with oldText and newText.`,
			);
		}
		const record = entry as Record<string, unknown>;
		const oldText =
			typeof record.oldText === "string"
				? record.oldText
				: typeof record.old_str === "string"
					? record.old_str
					: typeof record.old_string === "string"
						? record.old_string
						: null;
		const newText =
			typeof record.newText === "string"
				? record.newText
				: typeof record.new_str === "string"
					? record.new_str
					: typeof record.new_string === "string"
						? record.new_string
						: null;
		if (oldText === null || newText === null) {
			throw new Error(
				`edits[${index}] must have string oldText and newText fields.`,
			);
		}
		return { oldText, newText };
	});
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
			name: "timeline.edit_source",
			description:
				'PRIMARY editing tool. Apply exact-text replacements to OPENCUT_TIMELINE_SOURCE, like editing a code file. Each edit is {oldText, newText}; oldText must match the source exactly and uniquely (copy lines verbatim). Edit values in place, delete lines to delete, add lines with id "new" to insert. The staged changes become the edit plan the user approves.',
			parameters: objectSchema({
				properties: {
					edits: {
						type: "array",
						items: {
							type: "object",
							properties: {
								oldText: { type: "string" },
								newText: { type: "string" },
							},
							required: ["oldText", "newText"],
							additionalProperties: false,
						},
					},
				},
				required: ["edits"],
			}),
		},
		{
			type: "function",
			name: "timeline.read_source",
			description:
				"Return the current timeline source text (including your staged edits). Use it to re-check exact line content before editing.",
			parameters: objectSchema({ properties: {} }),
		},
		{
			type: "function",
			name: "timeline.list_media",
			description:
				"List the project's imported media assets (id, name, type, duration, dimensions) usable with insert_media_element.",
			parameters: objectSchema({ properties: {} }),
		},
		{
			type: "function",
			name: "skills.list",
			description:
				"List available editing skills (name + description). Skills contain authoring recipes for HTML frames, motion graphics, text effects, and video workflows.",
			parameters: objectSchema({ properties: {} }),
		},
		{
			type: "function",
			name: "skills.load",
			description:
				"Load the full instructions of one skill by name. ALWAYS load hyperframe-authoring before using insert_html_element.",
			parameters: objectSchema({
				properties: {
					name: { type: "string" },
				},
				required: ["name"],
			}),
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
		"You are an in-app video editing agent for OpenCut. You can perform any edit the app supports: cut, trim, split, move, rearrange, duplicate, delete, insert text/media/graphics/HTML motion graphics, manage tracks (layers), apply effects, transitions, keyframe animations, retiming, and mute/hide state.",
		"",
		"WORKFLOW - the timeline is a code file. The user message includes OPENCUT_TIMELINE_SOURCE: one JSON object per line (track / el / kf lines), times in SECONDS. Treat it exactly like source code:",
		"1. Read the relevant lines. Do NOT regenerate or restate the timeline.",
		'2. Call timeline.edit_source with small, surgical {oldText, newText} replacements - change a value in place, delete a line to delete the thing, add an el/kf line with "id":"new" to insert. oldText must be copied verbatim from the source and be unique; the full line including its unique "id" is the safest unit.',
		"3. The tool validates and stages your changes as the edit plan. Repeat with more edits if needed; each call re-diffs against the original, so the staged plan is always the total change.",
		'4. When done, reply with ONLY {"title":"...","summary":"..."} - a short human title and summary. Do not repeat the operations.',
		"Multiple similar edits (e.g. restyling 12 captions) = one timeline.edit_source call with 12 line replacements. This is much faster than any other approach.",
		"",
		"SOURCE FIELDS - el: track, at (start s), dur (s), name, text (text content), html, w/h (html render size), media (asset id), graphic (definition id), params (element params object), hidden, muted, rate (speed 0.1-10), tin/tout (transition preset in/out), tinDur/toutDur (s). kf: el (element id), path (animation path), at (s, element-local), v (value), interp (linear|hold).",
		'Insertable element types: text (needs "text"), html (needs "html"), graphic (needs "graphic": rectangle, ellipse, polygon, star, preset-background), media (needs "media" asset id from the media summary or timeline.list_media).',
		"Transition presets: fade, slide-left/right/up/down, push-left/right/up/down, zoom-in, zoom-out, pop, shrink, grow, flip-x, flip-y, spin-left/right, tilt-left/right, rise-soft, drop-soft, drift-left/right, corner-tl/tr/bl/br, none (removes).",
		"Keyframable paths: opacity, transform.positionX, transform.positionY, transform.scaleX, transform.scaleY, transform.rotate, color, background.color (text only).",
		"",
		'html elements render a self-contained HTML+CSS fragment (a hyperframe) as video - use them for designed motion graphics, kinetic typography, lower-thirds, stat hits, animated cards, charts, and any visual the built-in elements cannot express. BEFORE writing html, call skills.load with name "hyperframe-authoring" and follow its contract exactly (CSS keyframes only, --hf-delay for stagger, self-contained, no scripts or external URLs). Transparent backgrounds composite over the video below. Other skills: motion-graphics, text-effects, video-workflows (call skills.list).',
		"",
		"RULES:",
		'- Never invent ids. Use ids from OPENCUT_TIMELINE_SOURCE; never edit or reuse an existing "id" value.',
		"- Keep edits inside the selected range when a range is active.",
		"- Elements on the same track must not overlap in time.",
		"- Splitting a clip: not expressible as a source edit; fall back to a JSON plan with a split_element operation (see below).",
		"",
		'FALLBACK - JSON edit plan. If timeline.edit_source cannot express the change (split_element, add_clip_effect, attach_custom_edit, update_clip_effect_params, duplicate_element), reply instead with JSON only: {"title":"...","summary":"...","operations":[...],"notes":[]} using tick times (120000 ticks = 1 second) and full ids from tools. Supported operation types: update_element, insert_text_element, insert_media_element, insert_graphic_element, insert_html_element, trim_element, move_element, split_element, delete_element, duplicate_element, set_element_state, retime_element, apply_transition, add_track, remove_track, reorder_track, set_track_state, add_clip_effect, attach_custom_edit, update_clip_effect_params, upsert_keyframe (propertyPath, time, value), remove_keyframe. You may validate a JSON plan with timeline.propose_edit_plan.',
		"",
		'If no edit is needed, reply {"title":"No changes","summary":"<why>"}.',
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
	const mediaAssets = editor.media.getAssets();
	const documentRange = includeActiveRange ? range : null;
	const displayTracks = [
		...scene.tracks.overlay,
		scene.tracks.main,
		...scene.tracks.audio,
	];
	const elementCount = displayTracks.reduce(
		(total, track) => total + track.elements.length,
		0,
	);
	parts.push(
		`Timeline summary: ${scene.tracks.overlay.length} overlay layers, 1 main layer, ${scene.tracks.audio.length} audio layers, ${elementCount} total elements.`,
	);
	if (includePlayheadTime) {
		const playheadTicks = editor.playback.getCurrentTime();
		parts.push(
			`Playhead: ${(playheadTicks / TICKS_PER_SECOND).toFixed(3)}s (${playheadTicks} ticks)`,
		);
	}
	if (documentRange) {
		parts.push(
			`Active range: ${(documentRange.startTime / TICKS_PER_SECOND).toFixed(3)}s to ${(documentRange.endTime / TICKS_PER_SECOND).toFixed(3)}s (${documentRange.startTime} to ${documentRange.endTime} ticks). Keep all edits inside this range.`,
		);
		const index = buildTimelineContextIndex({
			tracks: scene.tracks,
			mediaAssets,
		});
		const rangeLayers = getLayersInRange({ index, range: documentRange });
		const rangeElements = getElementsInRange({ index, range: documentRange });
		parts.push(
			`Active range summary: ${rangeLayers.length} layers and ${rangeElements.length} elements overlap this range.`,
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
				mediaAssets.map((asset) => ({
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
	parts.push(
		[
			"OPENCUT_TIMELINE_SOURCE (edit with timeline.edit_source):",
			"```",
			serializeTimelineSource({ tracks: scene.tracks }).text.trimEnd(),
			"```",
		].join("\n"),
	);

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
