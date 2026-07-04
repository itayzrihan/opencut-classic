import { type NextRequest } from "next/server";
import { completeOpenAIAuthorization } from "@/ai/server/openai-codex-oauth";

export async function GET(request: NextRequest) {
	const { response } = await completeOpenAIAuthorization({ request });
	return response;
}
