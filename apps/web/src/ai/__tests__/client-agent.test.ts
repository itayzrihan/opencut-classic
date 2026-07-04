import { afterEach, describe, expect, test } from "bun:test";
import { runAiAgent } from "@/ai/client-agent";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("AI client agent", () => {
	test("executes tool calls and returns the final edit plan", async () => {
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount += 1;
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
											name: "timeline.get_visible_state",
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
			executeTool: async () => ({ ok: true }),
		});

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(2);
		expect(result.editPlan?.title).toBe("No edits");
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
								name: "timeline.get_visible_state",
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
});
