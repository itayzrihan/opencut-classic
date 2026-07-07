"use client";

import { createAudioContext } from "@/media/audio";
import {
	buildSourceWaveformSummaryAsync,
	type SourceWaveformSummary,
} from "@/media/waveform-summary";
import type { WaveformWorkerMessage, WaveformWorkerResponse } from "./worker";

const WAVEFORM_WORKER_MIN_TOTAL_SAMPLES = 1_000_000;

interface GetSourceWaveformSummaryArgs {
	sourceKey: string;
	audioBuffer?: AudioBuffer;
	sourceFile?: File;
	audioUrl?: string;
}

export function shouldUseWaveformWorker({
	totalSamples,
	channelCount,
	isWorkerAvailable = typeof Worker !== "undefined",
}: {
	totalSamples: number;
	channelCount: number;
	isWorkerAvailable?: boolean;
}): boolean {
	return (
		isWorkerAvailable &&
		Math.max(0, totalSamples) * Math.max(1, channelCount) >=
			WAVEFORM_WORKER_MIN_TOTAL_SAMPLES
	);
}

function cloneAudioBufferChannelData({
	buffer,
}: {
	buffer: AudioBuffer;
}): Float32Array[] {
	return Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
		Float32Array.from(buffer.getChannelData(channel)),
	);
}

function getTransferableBuffers({
	channelData,
}: {
	channelData: Float32Array[];
}): Transferable[] {
	return channelData
		.map((channel) => channel.buffer)
		.filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}

async function buildSourceWaveformSummaryInWorker({
	sourceKey,
	buffer,
}: {
	sourceKey: string;
	buffer: AudioBuffer;
}): Promise<SourceWaveformSummary> {
	const worker = new Worker(new URL("./worker.ts", import.meta.url), {
		type: "module",
	});
	const channelData = cloneAudioBufferChannelData({ buffer });
	const transferableBuffers = getTransferableBuffers({ channelData });

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			worker.removeEventListener("message", handleMessage);
			worker.removeEventListener("error", handleError);
			worker.terminate();
		};
		const handleMessage = (event: MessageEvent<WaveformWorkerResponse>) => {
			const response = event.data;
			cleanup();
			if (response.type === "build-summary-complete") {
				resolve(response.summary);
			} else {
				reject(new Error(response.error));
			}
		};
		const handleError = (event: ErrorEvent) => {
			cleanup();
			reject(
				event.error instanceof Error ? event.error : new Error(event.message),
			);
		};

		worker.addEventListener("message", handleMessage);
		worker.addEventListener("error", handleError);
		worker.postMessage(
			{
				type: "build-summary",
				sourceKey,
				channelData,
				sampleRate: buffer.sampleRate,
				totalSamples: buffer.length,
			} satisfies WaveformWorkerMessage,
			transferableBuffers,
		);
	});
}

export class WaveformCache {
	private summaries = new Map<string, Promise<SourceWaveformSummary>>();

	getSourceSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
	}: GetSourceWaveformSummaryArgs): Promise<SourceWaveformSummary> {
		const existing = this.summaries.get(sourceKey);
		if (existing) {
			return existing;
		}

		const promise = this.buildSummary({
			sourceKey,
			audioBuffer,
			sourceFile,
			audioUrl,
		}).catch((error) => {
			this.summaries.delete(sourceKey);
			throw error;
		});

		this.summaries.set(sourceKey, promise);
		return promise;
	}

	clearSource({ sourceKey }: { sourceKey: string }): void {
		this.summaries.delete(sourceKey);
	}

	clearAll(): void {
		this.summaries.clear();
	}

	private async buildSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
	}: GetSourceWaveformSummaryArgs): Promise<SourceWaveformSummary> {
		if (audioBuffer) {
			return this.buildSummaryForBuffer({
				sourceKey,
				buffer: audioBuffer,
			});
		}

		let arrayBuffer: ArrayBuffer | null = null;
		if (sourceFile) {
			arrayBuffer = await sourceFile.arrayBuffer();
		} else if (audioUrl) {
			const response = await fetch(audioUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch waveform source: ${response.status}`);
			}
			arrayBuffer = await response.arrayBuffer();
		}

		if (!arrayBuffer) {
			throw new Error(`No waveform source available for ${sourceKey}`);
		}

		const audioContext = createAudioContext();
		try {
			const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
			return this.buildSummaryForBuffer({ sourceKey, buffer });
		} finally {
			void audioContext.close();
		}
	}

	private async buildSummaryForBuffer({
		sourceKey,
		buffer,
	}: {
		sourceKey: string;
		buffer: AudioBuffer;
	}): Promise<SourceWaveformSummary> {
		if (
			shouldUseWaveformWorker({
				totalSamples: buffer.length,
				channelCount: buffer.numberOfChannels,
			})
		) {
			try {
				return await buildSourceWaveformSummaryInWorker({ sourceKey, buffer });
			} catch (error) {
				console.warn(
					"Waveform worker failed; falling back to async summary",
					error,
				);
			}
		}

		return buildSourceWaveformSummaryAsync({ sourceKey, buffer });
	}
}

export const waveformCache = new WaveformCache();
