import type { MediaAsset } from "@/media/types";
import type {
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TrackType,
} from "@/timeline";
import type {
	AiElementSummary,
	AiLayerSummary,
	AiTimelineIndex,
	AiTimelineRange,
} from "./types";

export function rangesOverlap({
	firstStart,
	firstEnd,
	secondStart,
	secondEnd,
}: {
	firstStart: number;
	firstEnd: number;
	secondStart: number;
	secondEnd: number;
}): boolean {
	return firstStart < secondEnd && firstEnd > secondStart;
}

export function elementOverlapsRange({
	element,
	range,
}: {
	element: Pick<TimelineElement, "startTime" | "duration">;
	range: AiTimelineRange;
}): boolean {
	return rangesOverlap({
		firstStart: element.startTime,
		firstEnd: element.startTime + element.duration,
		secondStart: range.startTime,
		secondEnd: range.endTime,
	});
}

export function getDisplayTracks(tracks: SceneTracks): TimelineTrack[] {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

export function buildTimelineContextIndex({
	tracks,
	mediaAssets = [],
}: {
	tracks: SceneTracks;
	mediaAssets?: MediaAsset[];
}): AiTimelineIndex {
	const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const displayTracks = getDisplayTracks(tracks);
	const layers: AiLayerSummary[] = [];
	const elements: AiElementSummary[] = [];

	for (const [index, track] of displayTracks.entries()) {
		const section =
			track.id === tracks.main.id
				? "main"
				: track.type === "audio"
					? "audio"
					: "overlay";
		layers.push({
			id: track.id,
			name: track.name,
			type: track.type,
			index,
			section,
			elementCount: track.elements.length,
			...("hidden" in track ? { hidden: track.hidden } : {}),
			...("muted" in track ? { muted: track.muted } : {}),
		});

		for (const element of track.elements) {
			const mediaId =
				element.type === "video" || element.type === "image"
					? element.mediaId
					: element.type === "audio" && element.sourceType === "upload"
						? element.mediaId
						: undefined;
			const mediaAsset = mediaId ? assetsById.get(mediaId) : undefined;
			elements.push({
				trackId: track.id,
				elementId: element.id,
				name: element.name,
				type: element.type,
				startTime: element.startTime,
				endTime: element.startTime + element.duration,
				duration: element.duration,
				params: summarizeParams(element.params),
				...(mediaId ? { mediaId } : {}),
				...(element.type === "audio" && element.sourceType === "library"
					? { sourceUrl: element.sourceUrl }
					: {}),
				...(mediaAsset?.name ? { text: mediaAsset.name } : {}),
				...("text" in element.params && typeof element.params.text === "string"
					? { text: element.params.text }
					: {}),
				...("hidden" in element ? { hidden: element.hidden } : {}),
				...(element.type === "audio" && element.params.muted === true
					? { muted: true }
					: {}),
			});
		}
	}

	return {
		layers,
		elements,
		layersById: new Map(layers.map((layer) => [layer.id, layer])),
		elementsById: new Map(
			elements.map((element) => [
				`${element.trackId}:${element.elementId}`,
				element,
			]),
		),
	};
}

export function getElementsInRange({
	index,
	range,
}: {
	index: AiTimelineIndex;
	range: AiTimelineRange;
}): AiElementSummary[] {
	return index.elements
		.filter((element) =>
			rangesOverlap({
				firstStart: element.startTime,
				firstEnd: element.endTime,
				secondStart: range.startTime,
				secondEnd: range.endTime,
			}),
		)
		.sort(
			(a, b) => a.startTime - b.startTime || a.trackId.localeCompare(b.trackId),
		);
}

export function getLayersInRange({
	index,
	range,
}: {
	index: AiTimelineIndex;
	range: AiTimelineRange;
}): AiLayerSummary[] {
	const trackIds = new Set(
		getElementsInRange({ index, range }).map((element) => element.trackId),
	);
	return index.layers.filter((layer) => trackIds.has(layer.id));
}

export function searchLayers({
	index,
	query = "",
	types,
	cursor = 0,
	limit = 20,
}: {
	index: AiTimelineIndex;
	query?: string;
	types?: TrackType[];
	cursor?: number;
	limit?: number;
}): { items: AiLayerSummary[]; nextCursor: number | null } {
	const normalizedQuery = query.trim().toLowerCase();
	const filtered = index.layers.filter((layer) => {
		const matchesType = !types || types.includes(layer.type);
		const matchesQuery =
			normalizedQuery.length === 0 ||
			layer.name.toLowerCase().includes(normalizedQuery) ||
			layer.id.toLowerCase().includes(normalizedQuery);
		return matchesType && matchesQuery;
	});
	return pageItems({ items: filtered, cursor, limit });
}

export function searchElements({
	index,
	query = "",
	trackId,
	type,
	range,
	cursor = 0,
	limit = 25,
}: {
	index: AiTimelineIndex;
	query?: string;
	trackId?: string;
	type?: string;
	range?: AiTimelineRange;
	cursor?: number;
	limit?: number;
}): { items: AiElementSummary[]; nextCursor: number | null } {
	const normalizedQuery = query.trim().toLowerCase();
	const filtered = index.elements.filter((element) => {
		if (trackId && element.trackId !== trackId) return false;
		if (type && element.type !== type) return false;
		if (
			range &&
			!rangesOverlap({
				firstStart: element.startTime,
				firstEnd: element.endTime,
				secondStart: range.startTime,
				secondEnd: range.endTime,
			})
		) {
			return false;
		}
		if (normalizedQuery.length === 0) return true;
		return [
			element.name,
			element.elementId,
			element.trackId,
			element.text ?? "",
		]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery);
	});
	return pageItems({ items: filtered, cursor, limit });
}

function pageItems<T>({
	items,
	cursor,
	limit,
}: {
	items: T[];
	cursor: number;
	limit: number;
}): { items: T[]; nextCursor: number | null } {
	const safeCursor = Math.max(0, cursor);
	const safeLimit = Math.max(1, Math.min(100, limit));
	const page = items.slice(safeCursor, safeCursor + safeLimit);
	const nextCursor =
		safeCursor + safeLimit < items.length ? safeCursor + safeLimit : null;
	return { items: page, nextCursor };
}

function summarizeParams(
	params: TimelineElement["params"],
): Record<string, string | number | boolean> {
	const result: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(params)) {
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			result[key] = value;
		}
	}
	return result;
}
