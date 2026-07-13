import { expect, test } from "bun:test";
import { removeTimeRangeFromTracks } from "../remove-time-range";
import type { SceneTracks, TimelineElement, TimelineTrack } from "../types";
import { mediaTime } from "@/wasm";

const element = (
	id: string,
	startTime: number,
	duration: number,
): TimelineElement => ({
	id,
	type: "text",
	name: id,
	startTime: mediaTime({ ticks: startTime }),
	duration: mediaTime({ ticks: duration }),
	trimStart: mediaTime({ ticks: 0 }),
	trimEnd: mediaTime({ ticks: 0 }),
	params: {},
});
const track = (id: string, elements: TimelineElement[]): TimelineTrack =>
	({
		id,
		type: "text",
		name: id,
		elements,
		hidden: false,
	}) as TimelineTrack;

test("removes a range and closes it across every layer", () => {
	const tracks = {
		overlay: [
			track("text", [element("inside", 10, 5), element("later", 30, 5)]),
		],
		main: {
			...track("main", [element("left", 0, 10), element("right", 20, 10)]),
			type: "main",
		},
		audio: [track("audio", [element("sound", 20, 10)])],
	} as unknown as SceneTracks;
	const result = removeTimeRangeFromTracks({
		tracks,
		startTime: mediaTime({ ticks: 10 }),
		endTime: mediaTime({ ticks: 20 }),
	});
	expect(
		result.overlay[0].elements.map((item) => [item.id, item.startTime]),
	).toEqual([["later", 20]]);
	expect(result.main.elements[1]?.startTime).toBe(10);
	expect(result.audio[0].elements[0]?.startTime).toBe(10);
});

test("splices an internal range out of video media instead of trimming its tail", () => {
	const video = {
		...element("video", 0, 30),
		type: "video",
		mediaId: "asset-1",
		trimStart: mediaTime({ ticks: 5 }),
		trimEnd: mediaTime({ ticks: 0 }),
	} as TimelineElement;
	const tracks = {
		overlay: [],
		main: {
			...track("main", [video]),
			type: "main",
		},
		audio: [],
	} as unknown as SceneTracks;

	const result = removeTimeRangeFromTracks({
		tracks,
		startTime: mediaTime({ ticks: 10 }),
		endTime: mediaTime({ ticks: 20 }),
	});
	const [left, right] = result.main.elements;

	expect(left).toMatchObject({ id: "video", startTime: 0, duration: 10 });
	expect(right).toMatchObject({ startTime: 10, duration: 10, trimStart: 25 });
	expect(right?.id).not.toBe("video");
});
