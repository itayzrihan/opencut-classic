import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
	forwardCodexResponsesRequest,
	getOpenAIOAuthStatus,
	setCredentialsCookie,
} from "@/ai/server/openai-codex-oauth";

const chatRequestSchema = z.object({
	input: z.array(z.unknown()).min(1),
	tools: z.array(z.unknown()).optional(),
	model: z.string().optional(),
	previousResponseId: z.string().optional(),
});

export async function POST(request: NextRequest) {
	const body = await request.json().catch(() => null);
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
