import { webEnv } from "@/env/web";
import { type NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const runtime = "nodejs";

interface WhisperSegment {
	text?: string;
	timestamps?: {
		from?: string;
		to?: string;
	};
	offsets?: {
		from?: number;
		to?: number;
	};
	tokens?: Array<{
		text?: string;
		timestamps?: {
			from?: string;
			to?: string;
		};
		offsets?: {
			from?: number;
			to?: number;
		};
	}>;
}

const DEFAULT_BINARY_PATHS = ["whisper-cli"];

function compactStringArray(values: Array<string | null | undefined>) {
	return values.filter((value): value is string => !!value);
}

const DEFAULT_FFMPEG_PATHS = compactStringArray([
	webEnv.WHISPER_CPP_FFMPEG_PATH,
	"ffmpeg",
]);

const whisperJsonSchema = z.object({
	transcription: z
		.array(
			z.object({
				text: z.string().optional(),
				timestamps: z
					.object({
						from: z.string().optional(),
						to: z.string().optional(),
					})
					.optional(),
				offsets: z
					.object({
						from: z.number().optional(),
						to: z.number().optional(),
					})
					.optional(),
				tokens: z
					.array(
						z.object({
							text: z.string().optional(),
							timestamps: z
								.object({
									from: z.string().optional(),
									to: z.string().optional(),
								})
								.optional(),
							offsets: z
								.object({
									from: z.number().optional(),
									to: z.number().optional(),
								})
								.optional(),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
});

function firstExisting(paths: string[]) {
	for (const path of paths) {
		if (path === "ffmpeg" || path === "whisper-cli" || existsSync(path)) {
			return path;
		}
	}
	return null;
}

function parseTimestamp(value?: string) {
	if (!value) return 0;
	const parts = value.trim().replace(",", ".").split(":").map(Number);
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return Number(value) || 0;
}

function segmentStart(segment: WhisperSegment) {
	if (typeof segment.offsets?.from === "number") return segment.offsets.from / 1000;
	return parseTimestamp(segment.timestamps?.from);
}

function segmentEnd(segment: WhisperSegment) {
	if (typeof segment.offsets?.to === "number") return segment.offsets.to / 1000;
	return parseTimestamp(segment.timestamps?.to);
}

function tokenStart({
	token,
	fallback,
}: {
	token: NonNullable<WhisperSegment["tokens"]>[number];
	fallback: number;
}) {
	if (typeof token.offsets?.from === "number") return token.offsets.from / 1000;
	return parseTimestamp(token.timestamps?.from) || fallback;
}

function tokenEnd({
	token,
	fallback,
}: {
	token: NonNullable<WhisperSegment["tokens"]>[number];
	fallback: number;
}) {
	if (typeof token.offsets?.to === "number") return token.offsets.to / 1000;
	return parseTimestamp(token.timestamps?.to) || fallback;
}

function cleanTokenText(text: string) {
	return text.replace(/\[_BEG_\]|\[_TT_\d+\]|\[_EOT_\]|\[_SOLM_\]|\[_PREV_\]|\[_NOT_\]/g, "");
}

function isPunctuationOnly(text: string) {
	return /^[\s.,!?;:()[\]{}"'`\-–—…]+$/.test(text);
}

function buildWords({ segments }: { segments: WhisperSegment[] }) {
	const words: Array<{ text: string; start: number; end: number }> = [];

	for (const segment of segments) {
		const segmentStartTime = segmentStart(segment);
		const segmentEndTime = segmentEnd(segment);
		let current: { text: string; start: number; end: number } | null = null;

		for (const token of segment.tokens || []) {
			const raw = cleanTokenText(token.text || "");
			if (!raw.trim()) continue;

			const start = tokenStart({ token, fallback: segmentStartTime });
			const end = tokenEnd({ token, fallback: segmentEndTime });
			const hasLeadingSpace = /^\s/.test(raw);
			const piece = raw.replace(/\s+/g, " ").trim();
			if (!piece) continue;

			if (isPunctuationOnly(piece)) {
				if (current) {
					current.text += piece;
					current.end = Math.max(current.end, end);
				}
				continue;
			}

			if (!current || hasLeadingSpace) {
				if (current) words.push(current);
				current = { text: piece, start, end: Math.max(end, start + 0.001) };
				continue;
			}

			current.text += piece;
			current.end = Math.max(current.end, end);
		}

		if (current) {
			words.push(current);
			continue;
		}

		const fallbackWords = (segment.text || "").trim().split(/\s+/).filter(Boolean);
		if (fallbackWords.length === 0) continue;
		const duration = Math.max(0.1, segmentEndTime - segmentStartTime);
		const wordDuration = duration / fallbackWords.length;
		fallbackWords.forEach((text, index) => {
			words.push({
				text,
				start: segmentStartTime + index * wordDuration,
				end: segmentStartTime + (index + 1) * wordDuration,
			});
		});
	}

	return words;
}

function runProcess({
	command,
	args,
	cwd,
	timeoutMs = 30 * 60 * 1000,
}: {
	command: string;
	args: string[];
	cwd?: string;
	timeoutMs?: number;
}) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd, windowsHide: true });
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(stderr.slice(-1000) || `${command} exited with ${code}`));
		});
	});
}

export async function POST(request: NextRequest) {
	const workDir = await mkdtemp(join(tmpdir(), "opencut-whisper-"));

	try {
		const form = await request.formData();
		const audio = form.get("audio");
		const language = String(form.get("language") || "he");

		if (!(audio instanceof File)) {
			return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
		}

		const whisperPath = firstExisting([
			webEnv.WHISPER_CPP_BINARY_PATH,
			...DEFAULT_BINARY_PATHS,
		].filter((value): value is string => !!value));
		const modelPath = firstExisting([
			webEnv.WHISPER_CPP_MODEL_PATH,
		].filter((value): value is string => !!value));
		const ffmpegPath = firstExisting(DEFAULT_FFMPEG_PATHS);

		if (!whisperPath || !modelPath || !ffmpegPath) {
			return NextResponse.json(
				{ error: "Missing whisper.cpp binary, model, or ffmpeg" },
				{ status: 503 },
			);
		}

		const inputPath = join(workDir, "input.webm");
		const wavPath = join(workDir, "audio16k.wav");
		const outBase = join(workDir, "transcript");
		const outJson = `${outBase}.json`;

		await writeFile(inputPath, Buffer.from(await audio.arrayBuffer()));
		await runProcess({
			command: ffmpegPath,
			args: ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
			cwd: workDir,
		});

		await runProcess({
			command: whisperPath,
			args: [
				"-m",
				modelPath,
				"-f",
				wavPath,
				"-l",
				language || "he",
				"-ojf",
				"-of",
				outBase,
				"-np",
			],
			cwd: workDir,
		});

		const raw = whisperJsonSchema.parse(JSON.parse(await readFile(outJson, "utf8")));
		const segments = (raw.transcription || [])
			.map((segment) => ({
				text: (segment.text || "").trim(),
				start: segmentStart(segment),
				end: segmentEnd(segment),
			}))
			.filter((segment) => segment.text && segment.end > segment.start);
		const words = buildWords({ segments: raw.transcription || [] });

		return NextResponse.json({
			text: segments.map((segment) => segment.text).join(" "),
			segments,
			words,
			language,
			source: "whisper.cpp",
			model: modelPath,
		});
	} catch (error) {
		console.error("whisper.cpp transcription failed:", error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : "Transcription failed",
			},
			{ status: 500 },
		);
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
