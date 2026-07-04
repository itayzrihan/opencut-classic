import type {
	ElementRef,
	ElementType,
	TimelineElement,
	TrackType,
} from "@/timeline";
import type { MediaTime } from "@/wasm";

export interface AiTimelineRange {
	startTime: MediaTime;
	endTime: MediaTime;
}

export interface AiLayerSummary {
	id: string;
	name: string;
	type: TrackType;
	index: number;
	section: "overlay" | "main" | "audio";
	elementCount: number;
	hidden?: boolean;
	muted?: boolean;
}

export interface AiElementSummary extends ElementRef {
	name: string;
	type: ElementType;
	startTime: MediaTime;
	endTime: number;
	duration: MediaTime;
	params: Record<string, string | number | boolean>;
	mediaId?: string;
	sourceUrl?: string;
	text?: string;
	hidden?: boolean;
	muted?: boolean;
}

export interface AiTimelineIndex {
	layers: AiLayerSummary[];
	elements: AiElementSummary[];
	elementsById: Map<string, AiElementSummary>;
	layersById: Map<string, AiLayerSummary>;
}

export interface AiEditPlan {
	title: string;
	summary: string;
	operations: AiEditOperation[];
	notes?: string[];
}

export type AiEditOperation =
	| {
			type: "update_element";
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
			reason?: string;
	  }
	| {
			type: "trim_element";
			trackId: string;
			elementId: string;
			trimStart?: MediaTime;
			trimEnd?: MediaTime;
			startTime?: MediaTime;
			duration?: MediaTime;
			reason?: string;
	  }
	| {
			type: "move_element";
			sourceTrackId: string;
			targetTrackId: string;
			elementId: string;
			startTime: MediaTime;
			reason?: string;
	  }
	| {
			type: "split_element";
			trackId: string;
			elementId: string;
			splitTime: MediaTime;
			retainSide?: "both" | "left" | "right";
			reason?: string;
	  }
	| {
			type: "delete_element";
			trackId: string;
			elementId: string;
			reason?: string;
	  }
	| {
			type: "add_clip_effect";
			trackId: string;
			elementId: string;
			effectType: string;
			reason?: string;
	  }
	| {
			type: "update_clip_effect_params";
			trackId: string;
			elementId: string;
			effectId: string;
			params: Record<string, string | number | boolean>;
			reason?: string;
	  }
	| {
			type: "upsert_keyframe";
			trackId: string;
			elementId: string;
			propertyPath: string;
			time: MediaTime;
			value: string | number | boolean;
			interpolation?: "linear" | "hold";
			keyframeId?: string;
			reason?: string;
	  }
	| {
			type: "remove_keyframe";
			trackId: string;
			elementId: string;
			propertyPath: string;
			keyframeId: string;
			reason?: string;
	  };

export interface AiToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface AiToolDefinition {
	type: "function";
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	strict?: boolean;
}

export interface AiAgentMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface AiAgentResult {
	status: "completed" | "cancelled" | "max_iterations" | "error";
	text: string;
	editPlan: AiEditPlan | null;
	iterations: number;
	error?: string;
}
