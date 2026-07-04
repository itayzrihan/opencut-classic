import { afterEach, describe, expect, test } from "bun:test";
import { runAiAgent } from "@/ai/client-agent";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("AI client agent", () => {
	test("executes tool calls and returns the final edit plan", async () => {
		let callCount = 0;
		let firstRequestBody: Record<string, unknown> | null = null;
		let executedToolName = "";
		globalThis.fetch = async (...fetchParameters) => {
			const init = fetchParameters[1];
			callCount += 1;
			if (callCount === 1 && typeof init?.body === "string") {
				firstRequestBody = JSON.parse(init.body) as Record<string, unknown>;
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
		expect(
			(
				(firstRequestBody?.tools as Array<{ name: string }> | undefined)?.[0]
			)?.name,
		).toBe("timeline_get_visible_state");
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
	});

	test("bounds large tool outputs before sending the next turn", async () => {
		let secondRequestBody: Record<string, unknown> | null = null;
		let callCount = 0;
		globalThis.fetch = async (...fetchParameters) => {
			callCount += 1;
			const init = fetchParameters[1];
			if (callCount === 2 && typeof init?.body === "string") {
				secondRequestBody = JSON.parse(init.body) as Record<string, unknown>;
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

		const secondInput = secondRequestBody?.input as
			| Array<{ type?: string; output?: string; call_id?: string }>
			| undefined;
		const functionCall = secondInput?.find(
			(item) => item.type === "function_call",
		);
		const functionOutput = secondInput?.find(
			(item) => item.type === "function_call_output",
		);

		expect(result.status).toBe("completed");
		expect(secondRequestBody?.previousResponseId).toBeUndefined();
		expect(secondInput?.some((item) => item.type === "reasoning")).toBe(false);
		expect(secondInput?.some((item) => item.type === "message")).toBe(false);
		expect(functionCall?.call_id).toBe("call-large");
		expect(functionOutput?.call_id).toBe("call-large");
		expect(functionOutput?.output?.length).toBeLessThan(17_000);
		expect(functionOutput?.output).toContain('"truncated":true');
	});
});
