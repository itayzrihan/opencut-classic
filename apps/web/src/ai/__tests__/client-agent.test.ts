import { afterEach, describe, expect, test } from "bun:test";
import { runAiAgent } from "@/ai/client-agent";

const originalFetch = globalThis.fetch;

interface RequestInputItem {
	type?: string;
	output?: string;
	call_id?: string;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("AI client agent", () => {
	test("tries a direct no-tool edit plan before the tool loop", async () => {
		let requestBody: Record<string, unknown> | null = null;
		globalThis.fetch = async (...fetchParameters) => {
			const init = fetchParameters[1];
			if (typeof init?.body === "string") {
				requestBody = parseRequestBody(init.body);
			}
			return new Response(
				JSON.stringify({
					response: {
						id: "resp-direct",
						output_text: JSON.stringify(
							JSON.stringify({
								title: "Direct plan",
								summary: "Done",
								operations: [
									{
										type: "update_element",
										trackId: "track-1",
										elementId: "element-1",
										params: { content: "HELLO" },
									},
								],
							}),
						),
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		};

		const result = await runAiAgent({
			messages: [{ role: "user", content: "change text" }],
			tools: [
				{
					type: "function",
					name: "timeline.propose_edit_plan",
					description: "",
					parameters: { type: "object", properties: {} },
				},
			],
			executeTool: async () => {
				throw new Error("The direct plan should not execute tools.");
			},
		});

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(1);
		expect(result.editPlan?.title).toBe("Direct plan");
		expect(result.editPlan?.operations[0]).toMatchObject({
			type: "update_element",
			patch: { params: { content: "HELLO" } },
		});
		expect(requestBody?.tools).toEqual([]);
	});

	test("falls back to tools when the direct edit plan is malformed", async () => {
		let callCount = 0;
		let secondRequestBody: Record<string, unknown> | null = null;
		globalThis.fetch = async (...fetchParameters) => {
			callCount += 1;
			const init = fetchParameters[1];
			if (callCount === 2 && typeof init?.body === "string") {
				secondRequestBody = parseRequestBody(init.body);
			}
			return new Response(
				JSON.stringify({
					response:
						callCount === 1
							? {
									id: "resp-malformed-direct",
									output_text:
										'{"title":"Bad plan","summary":"Missing patch","operations":[{"type":"update_element","trackId":"track-1","elementId":"element-1"}]}',
								}
							: {
									id: "resp-fallback",
									output_text:
										'{"title":"Fallback plan","summary":"Done","operations":[]}',
								},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		};

		const result = await runAiAgent({
			messages: [{ role: "user", content: "change text" }],
			tools: [
				{
					type: "function",
					name: "timeline.propose_edit_plan",
					description: "",
					parameters: { type: "object", properties: {} },
				},
			],
			executeTool: async () => {
				throw new Error("No tool execution is needed for fallback text.");
			},
		});

		expect(callCount).toBe(2);
		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(1);
		expect(result.editPlan?.title).toBe("Fallback plan");
		expect(getToolNames(secondRequestBody)[0]).toBe(
			"timeline_propose_edit_plan",
		);
	});

	test("executes tool calls and returns the final edit plan", async () => {
		let callCount = 0;
		let firstRequestBody: Record<string, unknown> | null = null;
		let executedToolName = "";
		globalThis.fetch = async (...fetchParameters) => {
			const init = fetchParameters[1];
			callCount += 1;
			if (callCount === 1 && typeof init?.body === "string") {
				firstRequestBody = parseRequestBody(init.body);
			}
			return new Response(
				JSON.stringify({
					response:
						callCount === 1
							? {
									id: "resp-1",
									output: [
										{
											type: "function_call",
											call_id: "call-1",
											name: "timeline_get_visible_state",
											arguments: "{}",
										},
									],
								}
							: {
									id: "resp-2",
									output_text:
										'{"title":"No edits","summary":"Done","operations":[]}',
								},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		};

		const result = await runAiAgent({
			messages: [{ role: "user", content: "do nothing" }],
			tools: [
				{
					type: "function",
					name: "timeline.get_visible_state",
					description: "",
					parameters: { type: "object", properties: {} },
				},
			],
			executeTool: async (toolCall) => {
				executedToolName = toolCall.name;
				return { ok: true };
			},
		});

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(2);
		expect(result.editPlan?.title).toBe("No edits");
		expect(getToolNames(firstRequestBody)[0]).toBe("timeline_get_visible_state");
		expect(executedToolName).toBe("timeline.get_visible_state");
	});

	test("stops when the max iteration budget is exhausted", async () => {
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					response: {
						id: "resp-loop",
						output: [
							{
								type: "function_call",
								call_id: "call-loop",
								name: "timeline_get_visible_state",
								arguments: "{}",
							},
						],
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);

		const result = await runAiAgent({
			messages: [{ role: "user", content: "loop" }],
			tools: [
				{
					type: "function",
					name: "timeline.get_visible_state",
					description: "",
					parameters: { type: "object", properties: {} },
				},
			],
			executeTool: async () => ({ ok: true }),
			maxIterations: 2,
		});

		expect(result.status).toBe("max_iterations");
		expect(result.iterations).toBe(2);
		expect(result.error).toContain("2 step limit");
	});

	test("returns immediately when the edit-plan validation tool succeeds", async () => {
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount += 1;
			return new Response(
				JSON.stringify({
					response: {
						id: "resp-plan-tool",
						output: [
							{
								type: "function_call",
								call_id: "call-plan",
								name: "timeline_propose_edit_plan",
								arguments:
									'{"plan":{"title":"Fast plan","summary":"Done","operations":[]}}',
							},
						],
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		};

		const result = await runAiAgent({
			messages: [{ role: "user", content: "validate this" }],
			tools: [
				{
					type: "function",
					name: "timeline.propose_edit_plan",
					description: "",
					parameters: { type: "object", properties: {} },
				},
			],
			executeTool: async () => ({
				success: true,
				plan: { title: "Fast plan", summary: "Done", operations: [] },
				errors: [],
			}),
			preferDirectPlan: false,
		});

		expect(callCount).toBe(1);
		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(1);
		expect(result.editPlan?.title).toBe("Fast plan");
	});

	test("bounds large tool outputs before sending the next turn", async () => {
		let secondRequestBody: Record<string, unknown> | null = null;
		let callCount = 0;
		globalThis.fetch = async (...fetchParameters) => {
			callCount += 1;
			const init = fetchParameters[1];
			if (callCount === 2 && typeof init?.body === "string") {
				secondRequestBody = parseRequestBody(init.body);
			}
			return new Response(
				JSON.stringify({
					response:
						callCount === 1
							? {
									id: "resp-large-tool",
									output: [
										{
											type: "reasoning",
											id: "rs-1",
										},
										{
											type: "message",
											content: [
												{
													type: "output_text",
													text: "Inspecting the layer.",
												},
											],
										},
										{
											type: "function_call",
											call_id: "call-large",
											name: "timeline_get_layer",
											arguments: '{"trackId":"track-1"}',
										},
									],
								}
							: {
									id: "resp-final",
									output_text:
										'{"title":"Done","summary":"Done","operations":[]}',
								},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		};

		const result = await runAiAgent({
			messages: [{ role: "user", content: "inspect layer" }],
			tools: [
				{
					type: "function",
					name: "timeline.get_layer",
					description: "",
					parameters: { type: "object", properties: {} },
				},
			],
			executeTool: async () => ({ text: "x".repeat(20_000) }),
		});

		const secondInput = getInputItems(secondRequestBody);
		const functionCall = secondInput.find(
			(item) => item.type === "function_call",
		);
		const functionOutput = secondInput.find(
			(item) => item.type === "function_call_output",
		);

		expect(result.status).toBe("completed");
		expect(secondRequestBody?.previousResponseId).toBeUndefined();
		expect(secondInput.some((item) => item.type === "reasoning")).toBe(false);
		expect(secondInput.some((item) => item.type === "message")).toBe(false);
		expect(functionCall?.call_id).toBe("call-large");
		expect(functionOutput?.call_id).toBe("call-large");
		expect(functionOutput?.output?.length).toBeLessThan(17_000);
		expect(functionOutput?.output).toContain('"truncated":true');
	});
});

function parseRequestBody(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	if (!isRecord(parsed)) {
		throw new Error("Expected request body to be a JSON object");
	}
	return parsed;
}

function getToolNames(body: Record<string, unknown> | null): string[] {
	const tools = body?.tools;
	if (!Array.isArray(tools)) {
		return [];
	}
	return tools.map((tool) =>
		isRecord(tool) && typeof tool.name === "string" ? tool.name : "",
	);
}

function getInputItems(body: Record<string, unknown> | null): RequestInputItem[] {
	const input = body?.input;
	if (!Array.isArray(input)) {
		return [];
	}
	return input.filter(isRecord).map((item) => ({
		type: typeof item.type === "string" ? item.type : undefined,
		output: typeof item.output === "string" ? item.output : undefined,
		call_id: typeof item.call_id === "string" ? item.call_id : undefined,
	}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
