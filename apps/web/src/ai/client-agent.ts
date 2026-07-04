import type {
	AiAgentMessage,
	AiAgentResult,
	AiEditPlan,
	AiToolCall,
	AiToolDefinition,
} from "./types";
import { extractAiEditPlanFromText } from "./edit-plan";

export const AI_AGENT_MAX_ITERATIONS = 12;
const TOOL_OUTPUT_MAX_CHARS = 16_000;

export interface AiAgentRunOptions {
	messages: AiAgentMessage[];
	tools: AiToolDefinition[];
	executeTool: (toolCall: AiToolCall) => Promise<unknown>;
	model?: string;
	signal?: AbortSignal;
	maxIterations?: number;
	onStep?: (message: string) => void;
}

interface ResponsesOutputItem {
	id?: string;
	call_id?: string;
	type?: string;
	name?: string;
	arguments?: string | Record<string, unknown>;
	content?: Array<{ type?: string; text?: string; output_text?: string }>;
}

interface ResponsesApiResult {
	id?: string;
	output?: ResponsesOutputItem[];
	output_text?: string;
	error?: { message?: string };
}

export async function runAiAgent({
	messages,
	tools,
	executeTool,
	model,
	signal,
	maxIterations = AI_AGENT_MAX_ITERATIONS,
	onStep,
}: AiAgentRunOptions): Promise<AiAgentResult> {
	let input: unknown[] = messages.map((message) => ({
		role: message.role,
		content: message.content,
	}));
	let lastText = "";

	for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
		if (signal?.aborted) {
			return {
				status: "cancelled",
				text: lastText,
				editPlan: null,
				iterations: iteration - 1,
			};
		}

		onStep?.(`Planning ${iteration}/${maxIterations}`);
		const response = await callAiChatRoute({
			input,
			tools: toWireToolDefinitions(tools),
			model,
			signal,
		});
		lastText = getResponseText(response) || lastText;

		const toolCalls = getResponseToolCalls(response);
		if (toolCalls.length === 0) {
			const extractedPlan = extractAiEditPlanFromText(lastText);
			return {
				status: "completed",
				text: lastText,
				editPlan: isAiEditPlan(extractedPlan) ? extractedPlan : null,
				iterations: iteration,
			};
		}

		const toolOutputs = [];
		for (const toolCall of toolCalls) {
			try {
				onStep?.(`Running ${toolCall.name}`);
				const output = await executeTool(toolCall);
				if (toolCall.name === "timeline.propose_edit_plan") {
					const plan = readSuccessfulValidationPlan(output);
					if (plan) {
						return {
							status: "completed",
							text: JSON.stringify(plan),
							editPlan: plan,
							iterations: iteration,
						};
					}
				}
				toolOutputs.push({
					type: "function_call_output",
					call_id: toolCall.id,
					output: serializeToolOutput({ ok: true, result: output }),
				});
			} catch (error) {
				toolOutputs.push({
					type: "function_call_output",
					call_id: toolCall.id,
					output: serializeToolOutput({
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				});
			}
		}
		input = [
			...input,
			...getResponseContinuationItems(response),
			...toolOutputs,
		];
	}

	return {
		status: "max_iterations",
		text: lastText,
		editPlan: null,
		iterations: maxIterations,
		error: `The AI agent reached the ${maxIterations} step limit before returning an edit plan.`,
	};
}

async function callAiChatRoute({
	input,
	tools,
	model,
	signal,
}: {
	input: unknown[];
	tools: AiToolDefinition[];
	model?: string;
	signal?: AbortSignal;
}): Promise<ResponsesApiResult> {
	const response = await fetch("/api/ai/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			input,
			tools,
			model,
		}),
		signal,
	});

	const data = await readAiChatJson(response);
	if (!response.ok) {
		throw new Error(data.error ?? `AI request failed (${response.status})`);
	}
	if (!data.response) {
		throw new Error("AI response was empty");
	}
	if (data.response.error?.message) {
		throw new Error(data.response.error.message);
	}
	return data.response;
}

async function readAiChatJson(
	response: Response,
): Promise<{ response?: ResponsesApiResult; error?: string }> {
	const value: unknown = await response.json().catch(() => ({}));
	if (!isRecord(value)) {
		return {};
	}
	return {
		response: isResponsesApiResult(value.response) ? value.response : undefined,
		error: typeof value.error === "string" ? value.error : undefined,
	};
}

function getResponseToolCalls(response: ResponsesApiResult): AiToolCall[] {
	return (response.output ?? [])
		.filter((item) => item.type === "function_call")
		.map((item) => ({
			id: item.call_id ?? item.id ?? crypto.randomUUID(),
			name: fromWireToolName(item.name ?? ""),
			arguments: parseToolArguments(item.arguments),
		}))
		.filter((toolCall) => toolCall.name.length > 0);
}

function getResponseContinuationItems(
	response: ResponsesApiResult,
): ResponsesOutputItem[] {
	return (response.output ?? []).filter(
		(item) => item.type === "function_call",
	);
}

const TOOL_WIRE_NAMES = new Map<string, string>([
	["timeline.search_layers", "timeline_search_layers"],
	["timeline.get_layer", "timeline_get_layer"],
	["timeline.search_elements", "timeline_search_elements"],
	["timeline.get_element", "timeline_get_element"],
	["timeline.get_visible_state", "timeline_get_visible_state"],
	["preview.capture_frame", "preview_capture_frame"],
	["timeline.propose_edit_plan", "timeline_propose_edit_plan"],
]);

const TOOL_INTERNAL_NAMES = new Map(
	[...TOOL_WIRE_NAMES.entries()].map(([internalName, wireName]) => [
		wireName,
		internalName,
	]),
);

function toWireToolDefinitions(tools: AiToolDefinition[]): AiToolDefinition[] {
	return tools.map((tool) => ({
		...tool,
		name: TOOL_WIRE_NAMES.get(tool.name) ?? tool.name,
	}));
}

function fromWireToolName(name: string): string {
	return TOOL_INTERNAL_NAMES.get(name) ?? name;
}

function getResponseText(response: ResponsesApiResult): string {
	if (typeof response.output_text === "string") {
		return response.output_text;
	}

	return (response.output ?? [])
		.flatMap((item) => item.content ?? [])
		.map((content) => content.text ?? content.output_text ?? "")
		.filter(Boolean)
		.join("\n")
		.trim();
}

function parseToolArguments(
	value: ResponsesOutputItem["arguments"],
): Record<string, unknown> {
	if (!value) {
		return {};
	}
	if (typeof value === "object") {
		return isRecord(value) ? value : {};
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function serializeToolOutput(value: Record<string, unknown>): string {
	const serialized = safeJsonStringify(value);
	if (serialized.length <= TOOL_OUTPUT_MAX_CHARS) {
		return serialized;
	}

	return safeJsonStringify({
		ok: value.ok === true,
		truncated: true,
		originalLength: serialized.length,
		resultPreview: serialized.slice(0, TOOL_OUTPUT_MAX_CHARS),
		note: "Tool output was shortened. Search or fetch a narrower layer/element if more detail is needed.",
	});
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch (error) {
		return JSON.stringify({
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Tool output could not be serialized.",
		});
	}
}

function isAiEditPlan(value: unknown): value is AiEditPlan {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		typeof value.summary === "string" &&
		Array.isArray(value.operations)
	);
}

function readSuccessfulValidationPlan(value: unknown): AiEditPlan | null {
	if (!isRecord(value) || value.success !== true) {
		return null;
	}
	const plan = value.plan;
	return isAiEditPlan(plan) ? plan : null;
}

function isResponsesApiResult(value: unknown): value is ResponsesApiResult {
	return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
