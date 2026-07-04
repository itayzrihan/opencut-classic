import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
	forwardCodexResponsesRequest,
	getOpenAIOAuthStatus,
	setCredentialsCookie,
} from "@/ai/server/openai-codex-oauth";

const MAX_AI_CHAT_BODY_BYTES = 1_000_000;
const MAX_AI_INPUT_ITEMS = 40;
const MAX_AI_TOOLS = 12;

const chatRequestSchema = z
	.object({
		input: z.array(z.unknown()).min(1).max(MAX_AI_INPUT_ITEMS),
		tools: z.array(z.unknown()).max(MAX_AI_TOOLS).optional(),
		model: z.string().trim().min(1).max(80).optional(),
		previousResponseId: z.string().trim().min(1).max(200).optional(),
	})
	.strict();

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (
		Number.isFinite(contentLength) &&
		contentLength > MAX_AI_CHAT_BODY_BYTES
	) {
		return NextResponse.json(
			{ error: "AI request is too large" },
			{ status: 413 },
		);
	}

	const body = await request.json().catch(() => null);
	if (JSON.stringify(body).length > MAX_AI_CHAT_BODY_BYTES) {
		return NextResponse.json(
			{ error: "AI request is too large" },
			{ status: 413 },
		);
	}

	const parsed = chatRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json(
			{
				error: "Invalid AI request",
				details: parsed.error.flatten().fieldErrors,
			},
			{ status: 400 },
		);
	}

	const oauth = await getOpenAIOAuthStatus({ request });
	if (!oauth.status.authenticated || !oauth.credentials) {
		return NextResponse.json(
			{
				error:
					oauth.status.error ??
					"Log in with OpenAI before using the AI editing agent.",
			},
			{ status: 401 },
		);
	}

	try {
		const responseBody = await forwardCodexResponsesRequest({
			credentials: oauth.credentials,
			body: parsed.data,
		});
		const response = NextResponse.json({ response: responseBody });
		if (oauth.refreshedCredentials) {
			setCredentialsCookie({
				response,
				credentials: oauth.refreshedCredentials,
			});
		}
		return response;
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "OpenAI Codex request failed.",
			},
			{ status: 502 },
		);
	}
}
