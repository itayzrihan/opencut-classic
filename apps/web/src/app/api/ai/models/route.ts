import { NextResponse } from "next/server";
import {
	CHATGPT_CODEX_MODEL_FALLBACKS,
	CHATGPT_CODEX_MODELS,
	DEFAULT_CHATGPT_CODEX_MODEL,
	normalizeCodexModelId,
} from "@/ai/codex-models";
import { webEnv } from "@/env/web";

export const runtime = "nodejs";

export function GET() {
	return NextResponse.json({
		models: CHATGPT_CODEX_MODELS,
		defaultModel: DEFAULT_CHATGPT_CODEX_MODEL,
		configuredModel: webEnv.OPENAI_CODEX_MODEL,
		selectedModel: normalizeCodexModelId(webEnv.OPENAI_CODEX_MODEL),
		fallbackOrder: CHATGPT_CODEX_MODEL_FALLBACKS,
		liveDiscovery: false,
		source: "https://developers.openai.com/codex/models",
		note: "The ChatGPT Codex backend path used by this app does not expose a documented model-list endpoint. This list follows official Codex docs, and chat requests retry supported fallbacks when a configured legacy model is rejected.",
	});
}
