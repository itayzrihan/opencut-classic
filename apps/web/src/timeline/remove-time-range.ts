import type { SceneTracks, TimelineElement, TimelineTrack } from "./types";
import { mediaTime, type MediaTime } from "@/wasm";
import { generateUUID } from "@/utils/id";

export function removeTimeRangeFromTracks({
	tracks,
	startTime,
	endTime,
}: {
	tracks: SceneTracks;
	startTime: MediaTime;
	endTime: MediaTime;
}): SceneTracks {
	const duration = Math.max(0, endTime - startTime);
	if (duration <= 0) return tracks;
	const updateTrack = <TTrack extends TimelineTrack>(
		track: TTrack,
	): TTrack => ({
		...track,
		elements: track.elements.flatMap((element) =>
			removeRangeFromElement({ element, startTime, endTime, duration }),
		) as TTrack["elements"],
	});
	return {
		overlay: tracks.overlay.map(updateTrack),
		main: updateTrack(tracks.main),
		audio: tracks.audio.map(updateTrack),
	};
}

function removeRangeFromElement({
	element,
	startTime,
	endTime,
	duration,
}: {
	element: TimelineElement;
	startTime: MediaTime;
	endTime: MediaTime;
	duration: number;
}): TimelineElement[] {
	const elementStart = element.startTime;
	const elementEnd = element.startTime + element.duration;
	if (elementEnd <= startTime) return [element];
	if (elementStart >= endTime)
		return [
			{ ...element, startTime: mediaTime({ ticks: elementStart - duration }) },
		];
	if (elementStart >= startTime && elementEnd <= endTime) return [];
	if (elementStart < startTime && elementEnd > endTime) {
		if (element.type === "video" || element.type === "audio") {
			const leftDuration = startTime - elementStart;
			const rightDuration = elementEnd - endTime;
			return [
				{
					...element,
					duration: mediaTime({ ticks: leftDuration }),
					trimEnd: mediaTime({
						ticks: element.trimEnd + elementEnd - startTime,
					}),
				},
				{
					...element,
					id: generateUUID(),
					startTime: mediaTime({ ticks: startTime }),
					duration: mediaTime({ ticks: rightDuration }),
					trimStart: mediaTime({
						ticks: element.trimStart + endTime - elementStart,
					}),
				},
			];
		}
		return [
			{
				...element,
				duration: mediaTime({ ticks: element.duration - duration }),
			},
		];
	}
	if (elementStart < startTime)
		return [
			{ ...element, duration: mediaTime({ ticks: startTime - elementStart }) },
		];
	const removedHead = endTime - elementStart;
	return [
		{
			...element,
			startTime: mediaTime({ ticks: startTime }),
			duration: mediaTime({ ticks: elementEnd - endTime }),
			trimStart: mediaTime({ ticks: element.trimStart + removedHead }),
		},
	];
}
