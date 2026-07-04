import type {
	AiAgentMessage,
	AiAgentResult,
	AiEditPlan,
	AiToolCall,
	AiToolDefinition,
} from "./types";
import { extractAiEditPlanFromText } from "./edit-plan";

export const AI_AGENT_MAX_ITERATIONS = 12;

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
	let previousResponseId: string | undefined;
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

		onStep?.(`Thinking ${iteration}/${maxIterations}`);
		const response = await callAiChatRoute({
			input,
			tools,
			model,
			previousResponseId,
			signal,
		});
		previousResponseId = response.id;
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
				toolOutputs.push({
					type: "function_call_output",
					call_id: toolCall.id,
					output: JSON.stringify({ ok: true, result: output }),
				});
			} catch (error) {
				toolOutputs.push({
					type: "function_call_output",
					call_id: toolCall.id,
					output: JSON.stringify({
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				});
			}
		}
		input = toolOutputs;
	}

	return {
		status: "max_iterations",
		text: lastText,
		editPlan: null,
		iterations: maxIterations,
		error:
			"The AI agent reached the 12 step limit before returning an edit plan.",
	};
}

async function callAiChatRoute({
	input,
	tools,
	model,
	previousResponseId,
	signal,
}: {
	input: unknown[];
	tools: AiToolDefinition[];
	model?: string;
	previousResponseId?: string;
	signal?: AbortSignal;
}): Promise<ResponsesApiResult> {
	const response = await fetch("/api/ai/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			input,
			tools,
			model,
			previousResponseId,
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
			name: item.name ?? "",
			arguments: parseToolArguments(item.arguments),
		}))
		.filter((toolCall) => toolCall.name.length > 0);
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
		return value;
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
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

function isResponsesApiResult(value: unknown): value is ResponsesApiResult {
	return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
