import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { NextResponse, type NextRequest } from "next/server";
import { webEnv } from "@/env/web";

const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const SCOPE = "openid profile email offline_access";
const OAUTH_TOKEN_COOKIE = "opencut_openai_oauth_token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const OAUTH_FLOW_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const REFRESH_SKEW_MS = 60_000;

export interface OpenAICodexCredentials {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	chatgptPlanType?: string;
	profileName?: string;
	sessionBinding: string;
}

interface OAuthState {
	state: string;
	codeVerifier: string;
	redirectUri: string;
	returnTo: string;
	appOrigin: string;
	sessionBinding: string;
	createdAt: number;
}

interface OAuthHandoff {
	credentials: OpenAICodexCredentials;
	returnTo: string;
	sessionBinding: string;
	createdAt: number;
}

interface OAuthRuntimeState {
	server: Server | null;
	serverStart: Promise<void> | null;
	flows: Map<string, OAuthState>;
	handoffs: Map<string, OAuthHandoff>;
}

export interface OAuthStatus {
	authenticated: boolean;
	identity: {
		accountId?: string;
		email?: string;
		chatgptPlanType?: string;
		profileName?: string;
	} | null;
	error?: string;
}

declare global {
	var __opencutOpenAIOAuthRuntime: OAuthRuntimeState | undefined;
}

export async function createOpenAIAuthorizationResponse({
	request,
}: {
	request: NextRequest;
}): Promise<NextResponse> {
	const { verifier, challenge } = createPkcePair();
	const state = randomUUID();
	const redirectUri = resolveLoopbackRedirectUri();
	const returnTo = normalizeReturnTo({
		value: request.nextUrl.searchParams.get("returnTo"),
		origin: request.nextUrl.origin,
	});
	const sessionBinding = getSessionBinding({ request });
	const statePayload: OAuthState = {
		state,
		codeVerifier: verifier,
		redirectUri,
		returnTo,
		appOrigin: request.nextUrl.origin,
		sessionBinding,
		createdAt: Date.now(),
	};

	try {
		await registerOAuthFlow(statePayload);
	} catch (error) {
		return NextResponse.redirect(
			createReturnUrl({
				request,
				status: "error",
				message:
					error instanceof Error
						? error.message
						: "OpenAI OAuth callback server could not start.",
				returnTo,
			}).toString(),
			302,
		);
	}

	return NextResponse.redirect(
		createAuthorizationUrl({
			challenge,
			redirectUri,
			state,
		}).toString(),
		302,
	);
}

export async function completeOpenAIAuthorization({
	request,
}: {
	request: NextRequest;
}): Promise<{ response: NextResponse; success: boolean }> {
	return {
		response: NextResponse.redirect(
			createReturnUrl({
				request,
				status: "error",
				message:
					"OpenAI redirected to the app callback directly. Restart login so OpenCut can use the Codex loopback callback.",
			}).toString(),
			302,
		),
		success: false,
	};
}

export async function completeOpenAIAuthorizationHandoff({
	request,
}: {
	request: NextRequest;
}): Promise<{ response: NextResponse; success: boolean }> {
	const handoffId = request.nextUrl.searchParams.get("handoff");
	const handoff = handoffId ? consumeOAuthHandoff(handoffId) : null;
	if (!handoff) {
		return {
			response: NextResponse.redirect(
				createReturnUrl({
					request,
					status: "error",
					message: "OpenAI OAuth handoff expired. Please try logging in again.",
				}).toString(),
				302,
			),
			success: false,
		};
	}

	if (handoff.sessionBinding !== getSessionBinding({ request })) {
		return {
			response: NextResponse.redirect(
				createReturnUrl({
					request,
					status: "error",
					message: "OpenAI OAuth session changed before login completed.",
					returnTo: handoff.returnTo,
				}).toString(),
				302,
			),
			success: false,
		};
	}

	const response = NextResponse.redirect(
		createReturnUrl({
			request,
			status: "success",
			returnTo: handoff.returnTo,
		}).toString(),
		302,
	);
	setCredentialsCookie({ response, credentials: handoff.credentials });
	return { response, success: true };
}

export async function getOpenAIOAuthStatus({
	request,
}: {
	request: NextRequest;
}): Promise<{
	status: OAuthStatus;
	credentials?: OpenAICodexCredentials;
	refreshedCredentials?: OpenAICodexCredentials;
}> {
	const credentials = readCredentialsCookie({ request });
	if (!credentials) {
		return { status: { authenticated: false, identity: null } };
	}

	if (credentials.sessionBinding !== getSessionBinding({ request })) {
		return {
			status: {
				authenticated: false,
				identity: null,
				error: "OpenAI login is tied to a different app session.",
			},
		};
	}

	try {
		const refreshedCredentials = await refreshIfNeeded(credentials);
		const activeCredentials = refreshedCredentials ?? credentials;
		return {
			status: {
				authenticated: true,
				identity: {
					accountId: activeCredentials.accountId,
					email: activeCredentials.email,
					chatgptPlanType: activeCredentials.chatgptPlanType,
					profileName: activeCredentials.profileName,
				},
			},
			credentials: activeCredentials,
			...(refreshedCredentials ? { refreshedCredentials } : {}),
		};
	} catch (error) {
		return {
			status: {
				authenticated: false,
				identity: null,
				error:
					error instanceof Error
						? error.message
						: "OpenAI OAuth refresh failed.",
			},
		};
	}
}

export function setCredentialsCookie({
	response,
	credentials,
}: {
	response: NextResponse;
	credentials: OpenAICodexCredentials;
}): void {
	setSealedCookie({
		response,
		name: OAUTH_TOKEN_COOKIE,
		value: credentials,
		maxAge: TOKEN_MAX_AGE_SECONDS,
	});
}

export function clearOpenAICredentials({
	response,
}: {
	response: NextResponse;
}): void {
	clearCookie({ response, name: OAUTH_TOKEN_COOKIE });
}

export async function forwardCodexResponsesRequest({
	credentials,
	body,
}: {
	credentials: OpenAICodexCredentials;
	body: Record<string, unknown>;
}): Promise<unknown> {
	const response = await fetch(
		`${webEnv.OPENAI_CODEX_RESPONSES_BASE_URL}/responses`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${credentials.access}`,
				...(credentials.accountId
					? { "ChatGPT-Account-ID": credentials.accountId }
					: {}),
			},
			body: JSON.stringify({
				model:
					typeof body.model === "string" && body.model.trim()
						? body.model
						: webEnv.OPENAI_CODEX_MODEL,
				input: body.input,
				tools: body.tools,
				parallel_tool_calls: false,
				...(typeof body.previousResponseId === "string"
					? { previous_response_id: body.previousResponseId }
					: {}),
			}),
		},
	);

	const responseBody = await response.json().catch(async () => ({
		error: await response.text().catch(() => response.statusText),
	}));

	if (!response.ok) {
		const message =
			typeof responseBody === "object" &&
			responseBody !== null &&
			"error" in responseBody
				? JSON.stringify(responseBody.error)
				: response.statusText;
		throw new Error(
			`OpenAI Codex request failed (${response.status}): ${message}`,
		);
	}

	return responseBody;
}

function createAuthorizationUrl({
	challenge,
	redirectUri,
	state,
}: {
	challenge: string;
	redirectUri: string;
	state: string;
}): URL {
	const authorizeUrl = new URL(AUTHORIZE_URL);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set(
		"client_id",
		webEnv.OPENAI_CODEX_OAUTH_CLIENT_ID,
	);
	authorizeUrl.searchParams.set("redirect_uri", redirectUri);
	authorizeUrl.searchParams.set("scope", SCOPE);
	authorizeUrl.searchParams.set("code_challenge", challenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("id_token_add_organizations", "true");
	authorizeUrl.searchParams.set("codex_cli_simplified_flow", "true");
	authorizeUrl.searchParams.set("originator", "opencut");
	return authorizeUrl;
}

function resolveLoopbackRedirectUri(
	host = webEnv.OPENAI_CODEX_OAUTH_CALLBACK_HOST,
): string {
	const hostForUrl = host === "::1" ? "[::1]" : host;
	const url = new URL(`http://${hostForUrl}:${CALLBACK_PORT}`);
	url.pathname = CALLBACK_PATH;
	return url.toString();
}

async function registerOAuthFlow(flow: OAuthState): Promise<void> {
	const runtime = getOAuthRuntime();
	cleanupOAuthRuntime(runtime);
	await ensureOAuthCallbackServer(runtime);
	runtime.flows.set(flow.state, flow);
}

function consumeOAuthHandoff(handoffId: string): OAuthHandoff | null {
	const runtime = getOAuthRuntime();
	cleanupOAuthRuntime(runtime);
	const handoff = runtime.handoffs.get(handoffId) ?? null;
	if (handoff) {
		runtime.handoffs.delete(handoffId);
	}
	return handoff;
}

function getOAuthRuntime(): OAuthRuntimeState {
	globalThis.__opencutOpenAIOAuthRuntime ??= {
		server: null,
		serverStart: null,
		flows: new Map(),
		handoffs: new Map(),
	};
	return globalThis.__opencutOpenAIOAuthRuntime;
}

async function ensureOAuthCallbackServer(
	runtime: OAuthRuntimeState,
): Promise<void> {
	if (runtime.server?.listening) return;
	if (runtime.serverStart) return runtime.serverStart;

	runtime.serverStart = new Promise<void>((resolve, reject) => {
		const server = createServer((request, response) => {
			void handleOAuthLoopbackCallback({ request, response });
		});
		const fail = (error: Error) => {
			runtime.server = null;
			const host = webEnv.OPENAI_CODEX_OAUTH_CALLBACK_HOST;
			reject(
				new Error(
					`OpenAI OAuth needs ${host}:${CALLBACK_PORT} for the Codex loopback callback, but it could not be opened: ${error.message}`,
				),
			);
		};
		server.once("error", fail);
		server.listen(
			CALLBACK_PORT,
			webEnv.OPENAI_CODEX_OAUTH_CALLBACK_HOST,
			() => {
				server.off("error", fail);
				server.unref?.();
				runtime.server = server;
				resolve();
			},
		);
	});

	try {
		await runtime.serverStart;
	} finally {
		runtime.serverStart = null;
	}
}

async function handleOAuthLoopbackCallback({
	request,
	response,
}: {
	request: IncomingMessage;
	response: ServerResponse;
}): Promise<void> {
	const runtime = getOAuthRuntime();
	cleanupOAuthRuntime(runtime);
	const url = new URL(request.url ?? "/", "http://localhost");
	if (url.pathname !== CALLBACK_PATH) {
		writeOAuthHtml({
			response,
			statusCode: 404,
			message: "OpenAI OAuth callback route not found.",
		});
		return;
	}

	const state = url.searchParams.get("state");
	const flow = state ? runtime.flows.get(state) : null;
	if (!state || !flow) {
		writeOAuthHtml({
			response,
			statusCode: 400,
			message: "OpenAI OAuth state was missing or expired.",
		});
		return;
	}

	runtime.flows.delete(state);
	const providerError = url.searchParams.get("error");
	if (providerError) {
		writeRedirect({
			response,
			url: createReturnUrlFromReturnTo({
				returnTo: flow.returnTo,
				status: "error",
				message: providerError,
			}),
		});
		return;
	}

	const code = url.searchParams.get("code");
	if (!code) {
		writeRedirect({
			response,
			url: createReturnUrlFromReturnTo({
				returnTo: flow.returnTo,
				status: "error",
				message: "OpenAI OAuth callback did not include an authorization code.",
			}),
		});
		return;
	}

	try {
		const credentials = await exchangeAuthorizationCode({
			code,
			codeVerifier: flow.codeVerifier,
			redirectUri: flow.redirectUri,
			sessionBinding: flow.sessionBinding,
		});
		const handoffId = randomUUID();
		runtime.handoffs.set(handoffId, {
			credentials,
			returnTo: flow.returnTo,
			sessionBinding: flow.sessionBinding,
			createdAt: Date.now(),
		});
		writeRedirect({
			response,
			url: createHandoffUrl({
				appOrigin: flow.appOrigin,
				handoffId,
			}),
		});
	} catch (error) {
		writeRedirect({
			response,
			url: createReturnUrlFromReturnTo({
				returnTo: flow.returnTo,
				status: "error",
				message:
					error instanceof Error
						? error.message
						: "OpenAI OAuth token exchange failed.",
			}),
		});
	}
}

function cleanupOAuthRuntime(runtime: OAuthRuntimeState): void {
	const now = Date.now();
	for (const [state, flow] of runtime.flows) {
		if (now - flow.createdAt > OAUTH_FLOW_MAX_AGE_MS) {
			runtime.flows.delete(state);
		}
	}
	for (const [handoffId, handoff] of runtime.handoffs) {
		if (now - handoff.createdAt > OAUTH_HANDOFF_MAX_AGE_MS) {
			runtime.handoffs.delete(handoffId);
		}
	}
}

function createHandoffUrl({
	appOrigin,
	handoffId,
}: {
	appOrigin: string;
	handoffId: string;
}): URL {
	const url = new URL("/api/ai/oauth/complete", appOrigin);
	url.searchParams.set("handoff", handoffId);
	return url;
}

function createReturnUrlFromReturnTo({
	returnTo,
	status,
	message,
}: {
	returnTo: string;
	status: "success" | "error";
	message?: string;
}): URL {
	const url = new URL(returnTo);
	url.searchParams.set("ai_oauth", status);
	if (message) {
		url.searchParams.set("ai_oauth_error", message);
	}
	return url;
}

function writeRedirect({
	response,
	url,
}: {
	response: ServerResponse;
	url: URL;
}): void {
	response.statusCode = 302;
	response.setHeader("Location", url.toString());
	response.end();
}

function writeOAuthHtml({
	response,
	statusCode,
	message,
}: {
	response: ServerResponse;
	statusCode: number;
	message: string;
}): void {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "text/html; charset=utf-8");
	response.end(
		`<!doctype html><title>OpenAI OAuth</title><main style="font-family:system-ui;padding:24px"><h1>OpenAI OAuth</h1><p>${escapeHtml(message)}</p></main>`,
	);
}

async function exchangeAuthorizationCode({
	code,
	codeVerifier,
	redirectUri,
	sessionBinding,
}: {
	code: string;
	codeVerifier: string;
	redirectUri: string;
	sessionBinding: string;
}): Promise<OpenAICodexCredentials> {
	const json = await postTokenForm({
		grant_type: "authorization_code",
		client_id: webEnv.OPENAI_CODEX_OAUTH_CLIENT_ID,
		code,
		code_verifier: codeVerifier,
		redirect_uri: redirectUri,
	});
	return normalizeTokenResponse({ json, sessionBinding });
}

async function refreshIfNeeded(
	credentials: OpenAICodexCredentials,
): Promise<OpenAICodexCredentials | null> {
	if (Date.now() + REFRESH_SKEW_MS < credentials.expires) {
		return null;
	}
	const json = await postTokenForm({
		grant_type: "refresh_token",
		refresh_token: credentials.refresh,
		client_id: webEnv.OPENAI_CODEX_OAUTH_CLIENT_ID,
	});
	return normalizeTokenResponse({
		json,
		sessionBinding: credentials.sessionBinding,
	});
}

async function postTokenForm(
	body: Record<string, string>,
): Promise<Record<string, unknown>> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(
			`OpenAI Codex token request failed (${response.status}): ${text}`,
		);
	}
	const json: unknown = await response.json();
	if (!isRecord(json)) {
		throw new Error("OpenAI Codex token response was not an object.");
	}
	return json;
}

function normalizeTokenResponse({
	json,
	sessionBinding,
}: {
	json: Record<string, unknown>;
	sessionBinding: string;
}): OpenAICodexCredentials {
	const access = typeof json.access_token === "string" ? json.access_token : "";
	const refresh =
		typeof json.refresh_token === "string" ? json.refresh_token : "";
	const expiresIn =
		typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
			? json.expires_in
			: 0;
	if (!access || !refresh || expiresIn <= 0) {
		throw new Error("OpenAI Codex token response was missing required fields.");
	}
	const identity = resolveCodexAuthIdentity({ accessToken: access });
	return {
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000,
		sessionBinding,
		...identity,
	};
}

function createPkcePair(): { verifier: string; challenge: string } {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

function setSealedCookie({
	response,
	name,
	value,
	maxAge,
}: {
	response: NextResponse;
	name: string;
	value: unknown;
	maxAge: number;
}): void {
	response.cookies.set(name, sealJson(value), {
		httpOnly: true,
		sameSite: "lax",
		secure: webEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
		path: "/",
		maxAge,
	});
}

function readSealedCookie({
	request,
	name,
}: {
	request: NextRequest;
	name: string;
}): unknown | null {
	const value = request.cookies.get(name)?.value;
	if (!value) return null;
	try {
		return unsealJson(value);
	} catch {
		return null;
	}
}

function readCredentialsCookie({
	request,
}: {
	request: NextRequest;
}): OpenAICodexCredentials | null {
	const value = readSealedCookie({ request, name: OAUTH_TOKEN_COOKIE });
	return isOpenAICodexCredentials(value) ? value : null;
}

function clearCookie({
	response,
	name,
}: {
	response: NextResponse;
	name: string;
}): void {
	response.cookies.set(name, "", {
		httpOnly: true,
		sameSite: "lax",
		secure: webEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
		path: "/",
		maxAge: 0,
	});
}

function sealJson(value: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", getCookieKey(), iv);
	const plaintext = Buffer.from(JSON.stringify(value), "utf8");
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return base64url(
		Buffer.from(
			JSON.stringify({
				v: 1,
				iv: base64url(iv),
				tag: base64url(tag),
				data: base64url(encrypted),
			}),
			"utf8",
		),
	);
}

function unsealJson(sealed: string): unknown {
	const parsedEnvelope: unknown = JSON.parse(
		Buffer.from(sealed, "base64url").toString("utf8"),
	);
	if (!isSealedEnvelope(parsedEnvelope)) {
		throw new Error("Invalid sealed cookie envelope");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		getCookieKey(),
		Buffer.from(parsedEnvelope.iv, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(parsedEnvelope.tag, "base64url"));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(parsedEnvelope.data, "base64url")),
		decipher.final(),
	]);
	return JSON.parse(decrypted.toString("utf8"));
}

function getCookieKey(): Buffer {
	return createHash("sha256").update(webEnv.BETTER_AUTH_SECRET).digest();
}

function getSessionBinding({ request }: { request: NextRequest }): string {
	const sessionCookie =
		request.cookies.get("better-auth.session_token")?.value ??
		request.cookies.get("__Secure-better-auth.session_token")?.value ??
		request.cookies.get("better-auth.session-token")?.value ??
		"sessionless";
	return createHash("sha256").update(sessionCookie).digest("base64url");
}

function normalizeReturnTo({
	value,
	origin,
}: {
	value: string | null;
	origin: string;
}): string {
	if (!value) return origin;
	try {
		const parsed = new URL(value, origin);
		return parsed.origin === origin ? parsed.toString() : origin;
	} catch {
		return origin;
	}
}

function createReturnUrl({
	request,
	status,
	message,
	returnTo,
}: {
	request: NextRequest;
	status: "success" | "error";
	message?: string;
	returnTo?: string;
}): URL {
	const url = new URL(returnTo ?? request.nextUrl.origin);
	url.searchParams.set("ai_oauth", status);
	if (message) {
		url.searchParams.set("ai_oauth_error", message);
	}
	return url;
}

function resolveCodexAuthIdentity({
	accessToken,
}: {
	accessToken: string;
}): Pick<
	OpenAICodexCredentials,
	"accountId" | "email" | "chatgptPlanType" | "profileName"
> {
	const payload = decodeJwtPayload(accessToken);
	const auth = asRecord(payload?.["https://api.openai.com/auth"]);
	const profile = asRecord(payload?.["https://api.openai.com/profile"]);
	const email = trimNonEmptyString(profile?.email);
	const accountId = trimNonEmptyString(auth?.chatgpt_account_id);
	const chatgptPlanType = trimNonEmptyString(auth?.chatgpt_plan_type);
	const subject =
		trimNonEmptyString(auth?.chatgpt_account_user_id) ??
		trimNonEmptyString(auth?.chatgpt_user_id) ??
		trimNonEmptyString(auth?.user_id) ??
		trimNonEmptyString(payload?.sub);
	return {
		...(accountId ? { accountId } : {}),
		...(email ? { email, profileName: email } : {}),
		...(chatgptPlanType ? { chatgptPlanType } : {}),
		...(!email && subject
			? { profileName: `id-${Buffer.from(subject).toString("base64url")}` }
			: {}),
	};
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const [, payload] = token.split(".");
	if (!payload) return null;
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isSealedEnvelope(value: unknown): value is {
	iv: string;
	tag: string;
	data: string;
} {
	return (
		isRecord(value) &&
		typeof value.iv === "string" &&
		typeof value.tag === "string" &&
		typeof value.data === "string"
	);
}

function isOpenAICodexCredentials(
	value: unknown,
): value is OpenAICodexCredentials {
	return (
		isRecord(value) &&
		typeof value.access === "string" &&
		typeof value.refresh === "string" &&
		typeof value.expires === "number" &&
		typeof value.sessionBinding === "string"
	);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function trimNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function base64url(value: Buffer): string {
	return value.toString("base64url");
}

function escapeHtml(value: string): string {
	return value.replaceAll(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

export const testing = {
	createPkcePair,
	createAuthorizationUrl,
	resolveCodexAuthIdentity,
	resolveLoopbackRedirectUri,
	normalizeReturnTo,
};
