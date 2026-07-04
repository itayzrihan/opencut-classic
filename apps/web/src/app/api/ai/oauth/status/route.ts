import { type NextRequest, NextResponse } from "next/server";
import {
	getOpenAIOAuthStatus,
	setCredentialsCookie,
} from "@/ai/server/openai-codex-oauth";

export async function GET(request: NextRequest) {
	const result = await getOpenAIOAuthStatus({ request });
	const response = NextResponse.json(result.status);
	if (result.refreshedCredentials) {
		setCredentialsCookie({
			response,
			credentials: result.refreshedCredentials,
		});
	}
	return response;
}
