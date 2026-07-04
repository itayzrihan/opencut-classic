import { createHash } from "node:crypto";

setEnvDefault("NODE_ENV", "test");
setEnvDefault("NEXT_PUBLIC_SITE_URL", "http://localhost:3001");
setEnvDefault("NEXT_PUBLIC_MARBLE_API_URL", "http://localhost:3001");
setEnvDefault("DATABASE_URL", "postgres://user:pass@localhost:5432/opencut");
setEnvDefault("BETTER_AUTH_SECRET", "test-secret");
setEnvDefault("UPSTASH_REDIS_REST_URL", "https://example.com");
setEnvDefault("UPSTASH_REDIS_REST_TOKEN", "test-token");
setEnvDefault("MARBLE_WORKSPACE_KEY", "test-workspace");
setEnvDefault("FREESOUND_CLIENT_ID", "test-client");
setEnvDefault("FREESOUND_API_KEY", "test-api-key");
setEnvDefault(
	"OPENAI_CODEX_RESPONSES_BASE_URL",
	"https://codex.example.test/backend-api/codex",
);
setEnvDefault("OPENAI_CODEX_MODEL", "gpt-5.1-codex");

function setEnvDefault(key: string, value: string): void {
	process.env[key] ??= value;
}

const { NextRequest, NextResponse } = await import("next/server");
const { runAiAgent } = await import("../src/ai/client-agent");
const { POST } = await import("../src/app/api/ai/chat/route");
const { setCredentialsCookie } = await import(
	"../src/ai/server/openai-codex-oauth"
);

const originalFetch = globalThis.fetch;
const upstreamRequests: Array<Record<string, unknown>> = [];
const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

const sessionBinding = createHash("sha256")
	.update("sessionless")
	.digest("base64url");
const cookieResponse = NextResponse.json({});
setCredentialsCookie({
	response: cookieResponse,
	credentials: {
		access: "access-token",
		refresh: "refresh-token",
		expires: Date.now() + 60 * 60 * 1000,
		accountId: "acct-smoke",
		email: "smoke@example.com",
		chatgptPlanType: "plus",
		profileName: "Smoke",
		sessionBinding,
	},
});
const sessionCookie = cookieResponse.cookies.get(
	"opencut_openai_oauth_session",
)?.value;
if (!sessionCookie) {
	throw new Error("Failed to create OpenAI OAuth smoke-test session cookie.");
}

globalThis.fetch = (async (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.toString()
				: input.url;

	if (url === "/api/ai/chat") {
		const headers = new Headers(init?.headers);
		headers.set(
			"cookie",
			`opencut_openai_oauth_session=${encodeURIComponent(sessionCookie)}`,
		);
		const request = new NextRequest("http://localhost:3001/api/ai/chat", {
			method: init?.method ?? "POST",
			headers,
			body: init?.body,
		});
		return POST(request);
	}

	if (url === "https://codex.example.test/backend-api/codex/responses") {
		const requestBody =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as Record<string, unknown>)
				: {};
		upstreamRequests.push(requestBody);

		if (requestBody.model === "future-model") {
			return new Response(
				JSON.stringify({
					detail:
						"The 'future-model' model is not supported when using Codex with a ChatGPT account.",
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		if (requestBody.previous_response_id === "resp-tool") {
			return new Response(
				'{"title":"Route smoke edit","summary":"Tool loop completed","operations":[]}',
				{ headers: { "Content-Type": "text/plain" } },
			);
		}

		return new Response(
			[
				{
					type: "response.output_item.added",
					output_index: 0,
					item: {
						type: "function_call",
						call_id: "call-search",
						name: "timeline_search_elements",
						arguments: "",
					},
				},
				{
					type: "response.function_call_arguments.delta",
					output_index: 0,
					delta: '{"inActiveRange":true,"limit":2}',
				},
				{
					type: "response.completed",
					response: { id: "resp-tool", status: "completed" },
				},
			]
				.map((event) => `data: ${JSON.stringify(event)}\n\n`)
				.join(""),
			{ headers: { "Content-Type": "text/plain; charset=utf-8" } },
		);
	}

	throw new Error(`Unexpected fetch in AI chat route smoke test: ${url}`);
}) as typeof fetch;

try {
	const result = await runAiAgent({
		model: "future-model",
		messages: [
			{
				role: "system",
				content: "Use timeline tools, then return an AiEditPlan JSON object.",
			},
			{
				role: "user",
				content: "Make a no-op edit inside the active range.",
			},
		],
		tools: [
			{
				type: "function",
				name: "timeline.search_elements",
				description: "Search timeline elements.",
				parameters: {
					type: "object",
					properties: {
						inActiveRange: { type: "boolean" },
						limit: { type: "number" },
					},
					additionalProperties: false,
				},
			},
		],
		executeTool: async (toolCall) => {
			toolCalls.push({
				name: toolCall.name,
				arguments: toolCall.arguments,
			});
			return {
				items: [
					{
						trackId: "caption-track-1",
						elementId: "word-1",
						text: "hello",
						debugPayload: "x".repeat(30_000),
					},
				],
			};
		},
		maxIterations: 4,
	});

	if (
		result.status !== "completed" ||
		result.editPlan?.title !== "Route smoke edit"
	) {
		throw new Error(`AI chat route smoke test failed: ${JSON.stringify(result)}`);
	}

	if (toolCalls[0]?.name !== "timeline.search_elements") {
		throw new Error(`Expected timeline.search_elements, got ${toolCalls[0]?.name}`);
	}
	if (toolCalls[0]?.arguments.inActiveRange !== true) {
		throw new Error("Expected active-range tool arguments to round-trip.");
	}

	const firstAcceptedRequest = upstreamRequests.find(
		(request) => request.model === "gpt-5.5",
	);
	if (!firstAcceptedRequest) {
		throw new Error("Expected unsupported model retry to use gpt-5.5.");
	}

	const continuationRequest = upstreamRequests.find(
		(request) => request.previous_response_id === "resp-tool",
	);
	if (!continuationRequest) {
		throw new Error("Expected a continuation request with previous_response_id.");
	}
	const continuationInput = continuationRequest?.input;
	if (!Array.isArray(continuationInput)) {
		throw new Error("Expected continuation request to include tool output input.");
	}
	const toolOutput = continuationInput[0] as
		| { type?: string; output?: string }
		| undefined;
	if (toolOutput?.type !== "function_call_output") {
		throw new Error("Expected continuation input to be a function_call_output.");
	}
	if (typeof toolOutput.output !== "string") {
		throw new Error("Expected continuation tool output to be serialized.");
	}
	if (!toolOutput.output.includes('"truncated":true')) {
		throw new Error("Expected large tool output to be truncated.");
	}
	if (toolOutput.output.length > 17_000) {
		throw new Error("Expected truncated tool output to stay bounded.");
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				iterations: result.iterations,
				upstreamRequestCount: upstreamRequests.length,
				modelsTried: upstreamRequests.map((request) => request.model),
				previousResponseId: continuationRequest.previous_response_id,
				toolOutputLength: toolOutput.output.length,
			},
			null,
			2,
		),
	);
} finally {
	globalThis.fetch = originalFetch;
}
