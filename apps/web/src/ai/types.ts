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
	effects?: Array<{
		id: string;
		type: string;
		enabled: boolean;
		params: Record<string, string | number | boolean>;
	}>;
	keyframes?: Array<{
		propertyPath: string;
		keyframeId: string;
		time: number;
		value: string | number | boolean;
		interpolation?: string;
		componentKey?: string;
	}>;
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

export type AiCustomEditSpec =
	| string
	| number
	| boolean
	| null
	| AiCustomEditSpec[]
	| { [key: string]: AiCustomEditSpec };

export type AiEditOperation =
	| {
			type: "update_element";
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
			reason?: string;
	  }
	| {
			type: "insert_text_element";
			trackId?: string;
			name?: string;
			content: string;
			startTime: MediaTime;
			duration: MediaTime;
			params?: Record<string, string | number | boolean>;
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
			params?: Record<string, string | number | boolean>;
			reason?: string;
	  }
	| {
			type: "attach_custom_edit";
			trackId: string;
			elementId: string;
			label: string;
			kind?: string;
			intent?: string;
			startTime?: MediaTime;
			duration?: MediaTime;
			spec: AiCustomEditSpec;
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
	  }
	| {
			type: "add_track";
			trackType: TrackType;
			index?: number;
			reason?: string;
	  }
	| {
			type: "remove_track";
			trackId: string;
			reason?: string;
	  }
	| {
			type: "reorder_track";
			trackId: string;
			toIndex: number;
			reason?: string;
	  }
	| {
			type: "set_track_state";
			trackId: string;
			muted?: boolean;
			hidden?: boolean;
			reason?: string;
	  }
	| {
			type: "insert_media_element";
			mediaId: string;
			startTime: MediaTime;
			trackId?: string;
			duration?: MediaTime;
			name?: string;
			reason?: string;
	  }
	| {
			type: "insert_graphic_element";
			definitionId: string;
			startTime: MediaTime;
			duration: MediaTime;
			trackId?: string;
			name?: string;
			params?: Record<string, string | number | boolean>;
			reason?: string;
	  }
	| {
			type: "insert_html_element";
			html: string;
			startTime: MediaTime;
			duration: MediaTime;
			trackId?: string;
			name?: string;
			sourceWidth?: number;
			sourceHeight?: number;
			params?: Record<string, string | number | boolean>;
			reason?: string;
	  }
	| {
			type: "duplicate_element";
			trackId: string;
			elementId: string;
			reason?: string;
	  }
	| {
			type: "apply_transition";
			trackId: string;
			elementId: string;
			presetId: string;
			side: "in" | "out";
			percent?: number;
			reason?: string;
	  }
	| {
			type: "set_element_state";
			trackId: string;
			elementId: string;
			hidden?: boolean;
			muted?: boolean;
			reason?: string;
	  }
	| {
			type: "retime_element";
			trackId: string;
			elementId: string;
			rate: number;
			maintainPitch?: boolean;
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
