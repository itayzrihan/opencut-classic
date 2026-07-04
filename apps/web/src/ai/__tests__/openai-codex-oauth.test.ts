import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function fakeJwt(payload: Record<string, unknown>): string {
	return [
		Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
		"signature",
	].join(".");
}

describe("OpenAI Codex OAuth helpers", () => {
	test("extracts identity from Codex JWT claims", async () => {
		setRequiredEnv();
		const { testing } = await import("@/ai/server/openai-codex-oauth");
		const identity = testing.resolveCodexAuthIdentity({
			accessToken: fakeJwt({
				sub: "user-1",
				"https://api.openai.com/profile": { email: "person@example.com" },
				"https://api.openai.com/auth": {
					chatgpt_account_id: "acct-1",
					chatgpt_plan_type: "plus",
				},
			}),
		});

		expect(identity.accountId).toBe("acct-1");
		expect(identity.email).toBe("person@example.com");
		expect(identity.chatgptPlanType).toBe("plus");
	});

	test("blocks open redirects in OAuth return path", async () => {
		setRequiredEnv();
		const { testing } = await import("@/ai/server/openai-codex-oauth");
		expect(
			testing.normalizeReturnTo({
				value: "https://evil.example/editor",
				origin: "http://localhost:3000",
			}),
		).toBe("http://localhost:3000");
		expect(
			testing.normalizeReturnTo({
				value: "/editor/project",
				origin: "http://localhost:3000",
			}),
		).toBe("http://localhost:3000/editor/project");
	});

	test("uses the registered Codex loopback redirect URI", async () => {
		setRequiredEnv();
		const { testing } = await import("@/ai/server/openai-codex-oauth");
		const redirectUri = testing.resolveLoopbackRedirectUri();
		const authorizeUrl = testing.createAuthorizationUrl({
			challenge: "challenge",
			redirectUri,
			state: "state",
		});

		expect(redirectUri).toBe("http://localhost:1455/auth/callback");
		expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
		expect(authorizeUrl.searchParams.get("client_id")).toBe(
			"app_EMoamEEZ73f0CkXaXp7hrann",
		);
		expect(authorizeUrl.searchParams.get("codex_cli_simplified_flow")).toBe(
			"true",
		);
		expect(authorizeUrl.searchParams.get("scope")).toBe(
			"openid profile email offline_access",
		);
	});

	test("keeps large OAuth tokens server-side behind a small session cookie", async () => {
		setRequiredEnv();
		const { getOpenAIOAuthStatus, setCredentialsCookie } = await import(
			"@/ai/server/openai-codex-oauth"
		);
		const sessionBinding = createHash("sha256")
			.update("sessionless")
			.digest("base64url");
		const response = NextResponse.json({ ok: true });

		setCredentialsCookie({
			response,
			credentials: {
				access: `access-${"a".repeat(8000)}`,
				refresh: `refresh-${"r".repeat(8000)}`,
				expires: Date.now() + 300_000,
				accountId: "acct-large-token",
				sessionBinding,
			},
		});

		const sessionCookie = response.cookies.get(
			"opencut_openai_oauth_session",
		)?.value;
		expect(typeof sessionCookie).toBe("string");
		expect(sessionCookie?.length).toBeLessThan(700);
		expect(
			response.cookies.get("opencut_openai_oauth_token")?.value ?? "",
		).toBe("");

		const request = new NextRequest("http://localhost:3000/api/ai/oauth/status", {
			headers: {
				cookie: `opencut_openai_oauth_session=${sessionCookie}`,
			},
		});
		const result = await getOpenAIOAuthStatus({ request });

		expect(result.status.authenticated).toBe(true);
		expect(result.status.identity?.accountId).toBe("acct-large-token");
		expect(result.credentials?.access.startsWith("access-")).toBe(true);
	});
});

function setRequiredEnv() {
	process.env.NODE_ENV ??= "test";
	process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
	process.env.NEXT_PUBLIC_MARBLE_API_URL ??= "http://localhost:3001";
	process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/opencut";
	process.env.BETTER_AUTH_SECRET ??= "test-secret";
	process.env.UPSTASH_REDIS_REST_URL ??= "https://example.com";
	process.env.UPSTASH_REDIS_REST_TOKEN ??= "test-token";
	process.env.MARBLE_WORKSPACE_KEY ??= "test-workspace";
	process.env.FREESOUND_CLIENT_ID ??= "test-client";
	process.env.FREESOUND_API_KEY ??= "test-api-key";
	process.env.OPENAI_CODEX_OAUTH_CALLBACK_HOST ??= "localhost";
}
