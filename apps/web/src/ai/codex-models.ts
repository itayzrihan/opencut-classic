export interface ChatGptCodexModel {
	id: string;
	label: string;
	description: string;
	recommended?: boolean;
	requiresPlan?: "pro";
}

export const DEFAULT_CHATGPT_CODEX_MODEL = "gpt-5.5";

export const CHATGPT_CODEX_MODEL_FALLBACKS = [
	DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.4",
	"gpt-5.4-mini",
] as const;

export const CHATGPT_CODEX_MODELS: ChatGptCodexModel[] = [
	{
		id: DEFAULT_CHATGPT_CODEX_MODEL,
		label: "GPT-5.5",
		description: "Recommended Codex model for ChatGPT sign-in.",
		recommended: true,
	},
	{
		id: "gpt-5.4",
		label: "GPT-5.4",
		description: "Previous frontier Codex-capable model.",
	},
	{
		id: "gpt-5.4-mini",
		label: "GPT-5.4 Mini",
		description: "Faster model for smaller edits and lighter tool loops.",
	},
	{
		id: "gpt-5.3-codex-spark",
		label: "GPT-5.3 Codex Spark",
		description: "Research preview Codex model.",
		requiresPlan: "pro",
	},
];

const LEGACY_MODEL_ALIASES: Record<string, string> = {
	"gpt-5.1": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.1-codex": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.1-codex-max": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.1-codex-mini": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.2": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.2-codex": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.3-codex": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.3-codex-mini": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.3-instant": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.3-instant-codex": DEFAULT_CHATGPT_CODEX_MODEL,
	"gpt-5.4-codex": "gpt-5.4",
	"gpt-5.4-codex-max": "gpt-5.4",
	"gpt-5.4-codex-mini": "gpt-5.4-mini",
};

export function normalizeCodexModelId(value?: string | null): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		return DEFAULT_CHATGPT_CODEX_MODEL;
	}

	const withoutProvider = trimmed.startsWith("codex:")
		? trimmed.slice("codex:".length).trim()
		: trimmed;
	const lower = withoutProvider.toLowerCase();
	return LEGACY_MODEL_ALIASES[lower] ?? withoutProvider;
}

export function getCodexModelCandidates(value?: string | null): string[] {
	return uniqueStrings([
		normalizeCodexModelId(value),
		...CHATGPT_CODEX_MODEL_FALLBACKS,
	]);
}

export function isUnsupportedCodexModelError({
	status,
	message,
}: {
	status: number;
	message: string;
}): boolean {
	const normalizedMessage = message.toLowerCase();
	return (
		status === 400 &&
		normalizedMessage.includes("model") &&
		(normalizedMessage.includes("not supported") ||
			normalizedMessage.includes("unsupported"))
	);
}

function uniqueStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		unique.push(value);
	}
	return unique;
}
