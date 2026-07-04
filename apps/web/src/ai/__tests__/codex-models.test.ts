import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CHATGPT_CODEX_MODEL,
	getCodexModelCandidates,
	isUnsupportedCodexModelError,
	normalizeCodexModelId,
} from "@/ai/codex-models";

describe("Codex model helpers", () => {
	test("normalizes legacy ChatGPT Codex model ids to the current default", () => {
		expect(normalizeCodexModelId("gpt-5.1-codex")).toBe(
			DEFAULT_CHATGPT_CODEX_MODEL,
		);
		expect(normalizeCodexModelId("codex:gpt-5.3-codex")).toBe(
			DEFAULT_CHATGPT_CODEX_MODEL,
		);
		expect(normalizeCodexModelId("gpt-5.4-codex")).toBe("gpt-5.4");
	});

	test("keeps explicit unknown model ids first so experiments remain possible", () => {
		expect(getCodexModelCandidates("future-model").at(0)).toBe("future-model");
	});

	test("includes supported fallbacks after the requested model", () => {
		expect(getCodexModelCandidates("gpt-5.1-codex")).toEqual([
			DEFAULT_CHATGPT_CODEX_MODEL,
			"gpt-5.4",
			"gpt-5.4-mini",
		]);
	});

	test("recognizes unsupported model errors from the Codex backend", () => {
		expect(
			isUnsupportedCodexModelError({
				status: 400,
				message:
					"The 'gpt-5.1-codex' model is not supported when using Codex with a ChatGPT account.",
			}),
		).toBe(true);
		expect(
			isUnsupportedCodexModelError({
				status: 401,
				message: "Unauthorized",
			}),
		).toBe(false);
	});
});
