import { type NextRequest } from "next/server";
import { createOpenAIAuthorizationResponse } from "@/ai/server/openai-codex-oauth";

export async function GET(request: NextRequest) {
	return createOpenAIAuthorizationResponse({ request });
}
