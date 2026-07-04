import { NextResponse } from "next/server";
import { clearOpenAICredentials } from "@/ai/server/openai-codex-oauth";

export async function POST() {
	const response = NextResponse.json({ ok: true });
	clearOpenAICredentials({ response });
	return response;
}
