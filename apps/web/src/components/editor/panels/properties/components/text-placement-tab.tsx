"use client";

import { Section, SectionContent, SectionField } from "@/components/section";
import { Input } from "@/components/ui/input";
import { useEditor } from "@/editor/use-editor";
import { getCaptionPlacementGrid } from "@/subtitles/caption-layout";
import {
	getTextMeasurementContext,
	measureTextElement,
} from "@/text/measure-element";
import type { MeasuredWordGlyph } from "@/text/primitives";
import type { TextElement } from "@/timeline";
import { buildTransformFromParams, type Transform } from "@/rendering";
import type { ElementWithTrackForParams } from "./element-params-tab";
import {
	buildScopedTextPatch,
	getScopedSettings,
	getWordRuns,
	type TextOverrideScope,
} from "../text-scope";

type Point = { x: number; y: number };

interface ScopedPlacement {
	center: Point;
	localCenter: Point;
	scope: TextOverrideScope;
	transform: Transform;
}

export function TextPlacementTab({
	element,
	trackId,
	elementsWithTracks,
	textScope,
}: {
	element: TextElement;
	trackId: string;
	elementsWithTracks?: ElementWithTrackForParams[];
	textScope?: TextOverrideScope;
}) {
	const editor = useEditor();
	const canvasSize = useEditor(
		(e) => e.project.getActive().settings.canvasSize,
	);
	const isBulk = (elementsWithTracks?.length ?? 0) > 1;
	const scope = textScope ?? { type: "layer" as const };
	const grid = getCaptionPlacementGrid({ canvasSize });
	const placement = isBulk
		? null
		: resolveScopedPlacement({
				element,
				scope,
				canvasSize,
			});
	const selectedCell = placement
		? getNearestGridCell({ center: placement.center, canvasSize, grid })
		: null;

	const applyCenter = (targetCenter: Point) => {
		if (!placement) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: buildPlacementPatch({
						element,
						placement,
						targetCenter,
					}),
				},
			],
		});
	};

	const applyAxis = ({ axis, value }: { axis: "x" | "y"; value: string }) => {
		if (!placement) return;
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return;
		applyCenter({
			x: axis === "x" ? parsed : placement.center.x,
			y: axis === "y" ? parsed : placement.center.y,
		});
	};

	if (isBulk) {
		return (
			<Section sectionKey={`${element.id}:placement`}>
				<SectionContent className="pt-4">
					<p className="text-muted-foreground text-sm">
						Select one text layer to edit scoped placement.
					</p>
				</SectionContent>
			</Section>
		);
	}

	return (
		<Section sectionKey={`${element.id}:placement`}>
			<SectionContent className="pt-4">
				<div className="flex flex-col gap-3.5">
					<SectionField label={`Grid position (${grid.columns}x${grid.rows})`}>
						<div
							className="grid gap-1"
							style={{
								gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
							}}
						>
							{Array.from({ length: grid.rows }).flatMap((_, rowIndex) =>
								Array.from({ length: grid.columns }).map((__, columnIndex) => {
									const isSelected =
										selectedCell?.columnIndex === columnIndex &&
										selectedCell?.rowIndex === rowIndex;
									return (
										<button
											key={`${columnIndex}:${rowIndex}`}
											type="button"
											aria-label={`Place ${scope.type} at column ${columnIndex + 1}, row ${rowIndex + 1}`}
											className={`border-border bg-input hover:bg-accent focus-visible:ring-ring flex h-7 items-center justify-center rounded-sm border outline-none focus-visible:ring-2 ${
												isSelected ? "border-primary bg-primary/15" : ""
											}`}
											onClick={() =>
												applyCenter(
													getGridCellCenter({
														columnIndex,
														rowIndex,
														grid,
														canvasSize,
													}),
												)
											}
										>
											<span
												className={`size-1.5 rounded-full ${
													isSelected ? "bg-primary" : "bg-muted-foreground/35"
												}`}
											/>
										</button>
									);
								}),
							)}
						</div>
					</SectionField>

					<SectionField label="Exact center X/Y">
						<div className="grid grid-cols-2 gap-2">
							<Input
								type="number"
								step={1}
								size="sm"
								value={
									placement ? formatPlacementValue(placement.center.x) : ""
								}
								aria-label={`${scope.type} center X position`}
								onChange={(event) =>
									applyAxis({ axis: "x", value: event.target.value })
								}
							/>
							<Input
								type="number"
								step={1}
								size="sm"
								value={
									placement ? formatPlacementValue(placement.center.y) : ""
								}
								aria-label={`${scope.type} center Y position`}
								onChange={(event) =>
									applyAxis({ axis: "y", value: event.target.value })
								}
							/>
						</div>
					</SectionField>
				</div>
			</SectionContent>
		</Section>
	);
}

function resolveScopedPlacement({
	element,
	scope,
	canvasSize,
}: {
	element: TextElement;
	scope: TextOverrideScope;
	canvasSize: { width: number; height: number };
}): ScopedPlacement {
	const transform = buildTransformFromParams({ params: element.params });
	const measurementElement =
		(element.wordRuns?.length ?? 0) > 0
			? element
			: {
					...element,
					wordRuns: getWordRuns({ element }),
				};
	const measured = measureTextElement({
		element: measurementElement,
		canvasHeight: canvasSize.height,
		localTime: 0,
		ctx: getTextMeasurementContext(),
	});
	const localCenter =
		scope.type === "layer"
			? getRectCenter(measured.visualRect)
			: (getScopedWordsCenter({
					element: measurementElement,
					measured,
					scope,
				}) ?? getRectCenter(measured.visualRect));
	const projectedCenter = projectLocalPoint({ point: localCenter, transform });

	return {
		center: {
			x: transform.position.x + projectedCenter.x,
			y: transform.position.y + projectedCenter.y,
		},
		localCenter,
		scope,
		transform,
	};
}

function buildPlacementPatch({
	element,
	placement,
	targetCenter,
}: {
	element: TextElement;
	placement: ScopedPlacement;
	targetCenter: Point;
}): Partial<TextElement> {
	if (placement.scope.type === "layer") {
		const projectedLocalCenter = projectLocalPoint({
			point: placement.localCenter,
			transform: placement.transform,
		});
		return {
			params: {
				"transform.positionX": targetCenter.x - projectedLocalCenter.x,
				"transform.positionY": targetCenter.y - projectedLocalCenter.y,
			},
		};
	}

	const localTarget = unprojectCanvasPoint({
		point: targetCenter,
		transform: placement.transform,
	});
	const delta = {
		x: localTarget.x - placement.localCenter.x,
		y: localTarget.y - placement.localCenter.y,
	};
	const settings = getScopedSettings({ element, scope: placement.scope });
	const ownStyle = settings.style ?? {};

	return buildScopedTextPatch({
		element,
		scope: placement.scope,
		patch: {
			style: {
				offsetX: (ownStyle.offsetX ?? 0) + delta.x,
				offsetY: (ownStyle.offsetY ?? 0) + delta.y,
			},
		},
	});
}

function getScopedWordsCenter({
	element,
	measured,
	scope,
}: {
	element: TextElement;
	measured: ReturnType<typeof measureTextElement>;
	scope: Exclude<TextOverrideScope, { type: "layer" }>;
}): Point | null {
	const wordLineIndexes = new Map(
		getWordRuns({ element }).map((word) => [word.id, word.lineIndex ?? 0]),
	);
	const words = (measured.wordLines ?? [])
		.flatMap((line) => line.words)
		.filter((word) =>
			scope.type === "word"
				? word.id === scope.wordId
				: wordLineIndexes.get(word.id) === scope.lineIndex,
		);

	if (words.length === 0) {
		return null;
	}

	return getWordsCenter({ words });
}

function getWordsCenter({ words }: { words: MeasuredWordGlyph[] }): Point {
	let left = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;

	for (const word of words) {
		const wordLeft = word.x + word.offsetX;
		const wordRight = wordLeft + word.layoutWidth;
		const wordTop = word.y + word.offsetY - word.scaledFontSize / 2;
		const wordBottom = word.y + word.offsetY + word.scaledFontSize / 2;
		left = Math.min(left, wordLeft);
		right = Math.max(right, wordRight);
		top = Math.min(top, wordTop);
		bottom = Math.max(bottom, wordBottom);
	}

	return {
		x: left + (right - left) / 2,
		y: top + (bottom - top) / 2,
	};
}

function getGridCellCenter({
	columnIndex,
	rowIndex,
	grid,
	canvasSize,
}: {
	columnIndex: number;
	rowIndex: number;
	grid: { columns: number; rows: number };
	canvasSize: { width: number; height: number };
}): Point {
	return {
		x:
			((columnIndex + 0.5) / grid.columns) * canvasSize.width -
			canvasSize.width / 2,
		y:
			((rowIndex + 0.5) / grid.rows) * canvasSize.height -
			canvasSize.height / 2,
	};
}

function getNearestGridCell({
	center,
	canvasSize,
	grid,
}: {
	center: Point;
	canvasSize: { width: number; height: number };
	grid: { columns: number; rows: number };
}) {
	return {
		columnIndex: clampInteger({
			value: Math.round(
				((center.x + canvasSize.width / 2) / canvasSize.width) * grid.columns -
					0.5,
			),
			min: 0,
			max: grid.columns - 1,
		}),
		rowIndex: clampInteger({
			value: Math.round(
				((center.y + canvasSize.height / 2) / canvasSize.height) * grid.rows -
					0.5,
			),
			min: 0,
			max: grid.rows - 1,
		}),
	};
}

function getRectCenter(rect: {
	left: number;
	top: number;
	width: number;
	height: number;
}): Point {
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2,
	};
}

function projectLocalPoint({
	point,
	transform,
}: {
	point: Point;
	transform: Transform;
}): Point {
	const scaled = {
		x: point.x * transform.scaleX,
		y: point.y * transform.scaleY,
	};
	const radians = (transform.rotate * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return {
		x: scaled.x * cos - scaled.y * sin,
		y: scaled.x * sin + scaled.y * cos,
	};
}

function unprojectCanvasPoint({
	point,
	transform,
}: {
	point: Point;
	transform: Transform;
}): Point {
	const translated = {
		x: point.x - transform.position.x,
		y: point.y - transform.position.y,
	};
	const radians = (-transform.rotate * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const unrotated = {
		x: translated.x * cos - translated.y * sin,
		y: translated.x * sin + translated.y * cos,
	};

	return {
		x: unrotated.x / (transform.scaleX || 1),
		y: unrotated.y / (transform.scaleY || 1),
	};
}

function clampInteger({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}) {
	return Math.min(max, Math.max(min, Math.round(value)));
}

function formatPlacementValue(value: number): string {
	if (!Number.isFinite(value)) return "0";
	return String(Math.round(value * 100) / 100);
}
