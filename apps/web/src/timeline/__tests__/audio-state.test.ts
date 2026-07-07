import { describe, expect, test } from "bun:test";
import type { AudioElement } from "@/timeline/types";
import {
	buildCompactWaveformGainSamples,
	buildCompactWaveformGainSamplesFromState,
	dBToLinear,
} from "@/timeline/audio-state";
import { mediaTime, TICKS_PER_SECOND, ZERO_MEDIA_TIME } from "@/wasm/media-time";

function audioElement({
	volume = 0,
	muted = false,
	hasAnimatedVolume = false,
}: {
	volume?: number;
	muted?: boolean;
	hasAnimatedVolume?: boolean;
} = {}): AudioElement {
	return {
		id: "audio-1",
		name: "Audio 1",
		type: "audio",
		sourceType: "upload",
		mediaId: "media-1",
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTime({ ticks: TICKS_PER_SECOND }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {
			volume,
			muted,
		},
		animations: hasAnimatedVolume
			? {
					volume: {
						keys: [
							{
								id: "volume-start",
								time: ZERO_MEDIA_TIME,
								value: 0,
								segmentToNext: "linear",
								tangentMode: "auto",
							},
							{
								id: "volume-end",
								time: mediaTime({ ticks: TICKS_PER_SECOND }),
								value: -6,
								segmentToNext: "linear",
								tangentMode: "auto",
							},
						],
					},
				}
			: undefined,
	};
}

describe("compact waveform gain samples", () => {
	test("omits gain samples for the default unmuted 0 dB envelope", () => {
		expect(
			buildCompactWaveformGainSamples({
				element: audioElement(),
				count: 4,
			}),
		).toBeUndefined();
	});

	test("uses one sample for muted or constant-volume clips", () => {
		expect(
			buildCompactWaveformGainSamples({
				element: audioElement({ muted: true }),
				count: 4,
			}),
		).toEqual([0]);

		expect(
			buildCompactWaveformGainSamples({
				element: audioElement({ volume: -6 }),
				count: 4,
			}),
		).toEqual([dBToLinear(-6)]);
	});

	test("keeps full samples for animated volume envelopes", () => {
		const samples = buildCompactWaveformGainSamples({
			element: audioElement({ hasAnimatedVolume: true }),
			count: 4,
		});

		expect(samples).toHaveLength(4);
		expect(samples?.[0]).toBeGreaterThan(samples?.[3] ?? 0);
	});

	test("matches element-based samples when called from scalar timeline state", () => {
		const element = audioElement({ volume: -6, hasAnimatedVolume: true });

		expect(
			buildCompactWaveformGainSamplesFromState({
				animations: element.animations,
				count: 4,
				duration: element.duration,
				muted: element.params.muted === true,
				volume: element.params.volume,
			}),
		).toEqual(buildCompactWaveformGainSamples({ element, count: 4 }));
	});
});
