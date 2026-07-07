import type {
	TextBlockMeasurement,
	TextCanvasContext,
	TextLayoutMeasurementContext,
} from "@/text/layout";
import type { BlendMode } from "@/rendering";
import { DEFAULTS } from "@/timeline/defaults";
import { clamp } from "@/utils/math";
import { CORNER_RADIUS_MAX, CORNER_RADIUS_MIN } from "./background";
import {
	drawTextDecoration,
	getTextBackgroundRect,
	measureTextBlock,
	setCanvasLetterSpacing,
} from "./layout";
import { FONT_SIZE_SCALE_REFERENCE } from "./typography";

export type TextAlign = "left" | "center" | "right";
export type NumericTextFontWeight =
	| "100"
	| "200"
	| "300"
	| "400"
	| "500"
	| "600"
	| "700"
	| "800"
	| "900";
export type TextFontWeight = "normal" | "bold" | NumericTextFontWeight;
export type TextFontStyle = "normal" | "italic";
export type TextDecoration = "none" | "underline" | "line-through";

const NUMERIC_TEXT_FONT_WEIGHTS = new Set<string>([
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
]);

export interface TextLayoutParams {
	content: string;
	fontSize: number;
	fontFamily: string;
	fontWeight: TextFontWeight;
	fontStyle: TextFontStyle;
	textAlign: TextAlign;
	textDecoration?: TextDecoration;
	letterSpacing?: number;
	lineHeight?: number;
	strokeWidth?: number;
	strokeColor?: string;
	shadowBlur?: number;
	shadowColor?: string;
	shadowOffsetX?: number;
	shadowOffsetY?: number;
}

export interface ResolvedTextStroke {
	color: string;
	width: number;
}

export interface ResolvedTextShadow {
	color: string;
	blur: number;
	offsetX: number;
	offsetY: number;
}

export interface ResolvedTextLayout {
	scaledFontSize: number;
	fontString: string;
	letterSpacing: number;
	lineHeightPx: number;
	fontSizeRatio: number;
	textAlign: TextAlign;
	textDecoration: TextDecoration;
}

export interface MeasuredTextLayout extends ResolvedTextLayout {
	lines: string[];
	lineMetrics: TextMetrics[];
	block: TextBlockMeasurement;
	wordLines?: MeasuredWordLine[];
	stroke?: ResolvedTextStroke | null;
	shadow?: ResolvedTextShadow | null;
}

export interface MeasuredWordGlyph {
	id: string;
	text: string;
	drawText: string;
	x: number;
	y: number;
	width: number;
	layoutWidth: number;
	metrics: TextMetrics;
	fontString: string;
	scaledFontSize: number;
	letterSpacing: number;
	color: string;
	opacity: number;
	scale: number;
	scaleX: number;
	scaleY: number;
	rotate: number;
	blur: number;
	shadowBlur: number;
	shadowColor: string;
	shadowOffsetX: number;
	shadowOffsetY: number;
	strokeWidth: number;
	strokeColor: string;
	offsetX: number;
	offsetY: number;
	blendMode: BlendMode;
	background?: {
		enabled: boolean;
		color: string;
		paddingX: number;
		paddingY: number;
		offsetX: number;
		offsetY: number;
		cornerRadius: number;
	};
	direction: CanvasDirection;
	textDecoration: TextDecoration;
}

export interface MeasuredWordLine {
	y: number;
	width: number;
	words: MeasuredWordGlyph[];
}

export interface ResolvedTextBackgroundLike {
	enabled: boolean;
	color: string;
	paddingX: number;
	paddingY: number;
	offsetX: number;
	offsetY: number;
	cornerRadius: number;
}

export function quoteFontFamily({
	fontFamily,
}: {
	fontFamily: string;
}): string {
	return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

export function buildTextFontString({
	fontFamily,
	fontWeight,
	fontStyle,
	scaledFontSize,
}: {
	fontFamily: string;
	fontWeight: TextFontWeight;
	fontStyle: TextFontStyle;
	scaledFontSize: number;
}): string {
	return `${fontStyle} ${fontWeight} ${scaledFontSize}px ${quoteFontFamily({ fontFamily })}, sans-serif`;
}

export function normalizeTextFontWeight({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextFontWeight;
}): TextFontWeight {
	if (typeof value !== "string") return fallback;

	const normalized = value.trim().toLowerCase();
	if (normalized === "normal" || normalized === "bold") return normalized;
	if (NUMERIC_TEXT_FONT_WEIGHTS.has(normalized)) {
		return normalized as NumericTextFontWeight;
	}
	return fallback;
}

export function resolveTextLayout({
	text,
	canvasHeight,
}: {
	text: TextLayoutParams;
	canvasHeight: number;
}): ResolvedTextLayout {
	const scaledFontSize =
		text.fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
	const fontWeight = normalizeTextFontWeight({
		value: text.fontWeight,
		fallback: "normal",
	});
	const fontStyle = text.fontStyle === "italic" ? "italic" : "normal";
	const letterSpacing = text.letterSpacing ?? DEFAULTS.text.letterSpacing;
	const lineHeightPx =
		scaledFontSize * (text.lineHeight ?? DEFAULTS.text.lineHeight);
	const fontSizeRatio = text.fontSize / 15;

	return {
		scaledFontSize,
		fontString: buildTextFontString({
			fontFamily: text.fontFamily,
			fontWeight,
			fontStyle,
			scaledFontSize,
		}),
		letterSpacing,
		lineHeightPx,
		fontSizeRatio,
		textAlign: text.textAlign,
		textDecoration: text.textDecoration ?? "none",
	};
}

export function measureTextLayout({
	text,
	canvasHeight,
	ctx,
}: {
	text: TextLayoutParams;
	canvasHeight: number;
	ctx: TextLayoutMeasurementContext;
}): MeasuredTextLayout {
	const resolvedLayout = resolveTextLayout({ text, canvasHeight });
	const lines = text.content.split("\n");

	ctx.save();
	ctx.font = resolvedLayout.fontString;
	ctx.textBaseline = "middle";
	setCanvasLetterSpacing({
		ctx,
		letterSpacingPx: resolvedLayout.letterSpacing,
	});
	const lineMetrics = lines.map((line) => ctx.measureText(line));
	ctx.restore();

	const block = measureTextBlock({
		lineMetrics,
		lineHeightPx: resolvedLayout.lineHeightPx,
	});

	return {
		...resolvedLayout,
		lines,
		lineMetrics,
		block,
	};
}

export function drawMeasuredTextLayout({
	ctx,
	layout,
	textColor,
	background,
	backgroundColor,
	textBaseline = "middle",
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	textColor: string;
	background?: ResolvedTextBackgroundLike | null;
	backgroundColor?: string;
	textBaseline?: CanvasTextBaseline;
}): void {
	ctx.font = layout.fontString;
	ctx.textAlign = layout.textAlign;
	ctx.textBaseline = textBaseline;
	ctx.fillStyle = textColor;
	setCanvasLetterSpacing({ ctx, letterSpacingPx: layout.letterSpacing });

	if (
		background?.enabled &&
		backgroundColor &&
		backgroundColor !== "transparent" &&
		layout.lines.length > 0
	) {
		const backgroundRect = getTextBackgroundRect({
			textAlign: layout.textAlign,
			block: layout.block,
			background: {
				...background,
				color: backgroundColor,
			},
			fontSizeRatio: layout.fontSizeRatio,
		});
		if (backgroundRect) {
			const p =
				clamp({
					value: background.cornerRadius,
					min: CORNER_RADIUS_MIN,
					max: CORNER_RADIUS_MAX,
				}) / 100;
			const radius =
				(Math.min(backgroundRect.width, backgroundRect.height) / 2) * p;
			ctx.fillStyle = backgroundColor;
			ctx.beginPath();
			ctx.roundRect(
				backgroundRect.left,
				backgroundRect.top,
				backgroundRect.width,
				backgroundRect.height,
				radius,
			);
			ctx.fill();
			ctx.fillStyle = textColor;
		}
	}

	if (layout.wordLines) {
		for (const line of layout.wordLines) {
			for (const word of line.words) {
				if (word.opacity <= 0) continue;
				const drawTextAlign: CanvasTextAlign =
					word.direction === "rtl" ? "right" : "left";
				const drawTextX = word.direction === "rtl" ? word.width : 0;
				ctx.save();
				ctx.font = word.fontString;
				ctx.textAlign = drawTextAlign;
				ctx.textBaseline = textBaseline;
				ctx.direction = word.direction;
				ctx.fillStyle = word.color;
				ctx.globalCompositeOperation = toCanvasCompositeOperation(
					word.blendMode,
				);
				ctx.globalAlpha *= word.opacity;
				if (word.blur > 0) {
					ctx.filter = `blur(${word.blur}px)`;
				}
				setCanvasLetterSpacing({ ctx, letterSpacingPx: word.letterSpacing });
				const x = word.x + word.offsetX + word.layoutWidth / 2;
				const y = word.y + word.offsetY;
				ctx.translate(x, y);
				if (word.rotate) {
					ctx.rotate((word.rotate * Math.PI) / 180);
				}
				ctx.scale(word.scaleX, word.scaleY);
				ctx.translate(-word.width / 2, 0);
				drawWordBackground({ ctx, word });
				ctx.save();
				ctx.translate(drawTextX, 0);
				applyTextShadow({
					ctx,
					shadow: {
						color: word.shadowColor,
						blur: word.shadowBlur,
						offsetX: word.shadowOffsetX,
						offsetY: word.shadowOffsetY,
					},
				});
				if (word.strokeWidth > 0) {
					ctx.strokeStyle = word.strokeColor;
					ctx.lineWidth = word.strokeWidth;
					ctx.lineJoin = "round";
					ctx.lineCap = "round";
					ctx.strokeText(word.drawText, 0, 0);
				}
				ctx.fillText(word.drawText, 0, 0);
				drawTextDecoration({
					ctx,
					textDecoration: word.textDecoration,
					lineWidth: word.width,
					lineY: 0,
					metrics: word.metrics,
					scaledFontSize: word.scaledFontSize,
					textAlign: drawTextAlign,
				});
				ctx.restore();
				ctx.restore();
			}
		}
		return;
	}

	applyTextShadow({ ctx, shadow: layout.shadow });
	if (layout.stroke && layout.stroke.width > 0) {
		ctx.strokeStyle = layout.stroke.color;
		ctx.lineWidth = layout.stroke.width;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		for (let index = 0; index < layout.lines.length; index++) {
			const lineY =
				index * layout.lineHeightPx - layout.block.visualCenterOffset;
			ctx.strokeText(layout.lines[index], 0, lineY);
		}
	}

	for (let index = 0; index < layout.lines.length; index++) {
		const lineY = index * layout.lineHeightPx - layout.block.visualCenterOffset;
		ctx.fillText(layout.lines[index], 0, lineY);
		drawTextDecoration({
			ctx,
			textDecoration: layout.textDecoration,
			lineWidth: layout.lineMetrics[index].width,
			lineY,
			metrics: layout.lineMetrics[index],
			scaledFontSize: layout.scaledFontSize,
			textAlign: layout.textAlign,
		});
	}
}

function applyTextShadow({
	ctx,
	shadow,
}: {
	ctx: TextCanvasContext;
	shadow?: ResolvedTextShadow | null;
}): void {
	if (
		!shadow ||
		(shadow.blur <= 0 && shadow.offsetX === 0 && shadow.offsetY === 0)
	) {
		return;
	}

	ctx.shadowBlur = Math.max(0, shadow.blur);
	ctx.shadowColor = shadow.color;
	ctx.shadowOffsetX = shadow.offsetX;
	ctx.shadowOffsetY = shadow.offsetY;
}

function drawWordBackground({
	ctx,
	word,
}: {
	ctx: TextCanvasContext;
	word: MeasuredWordGlyph;
}): void {
	const background = word.background;
	if (
		!background?.enabled ||
		!background.color ||
		background.color === "transparent"
	) {
		return;
	}

	const ascent =
		word.metrics.actualBoundingBoxAscent || word.scaledFontSize * 0.8;
	const descent =
		word.metrics.actualBoundingBoxDescent || word.scaledFontSize * 0.2;
	const left = background.offsetX - background.paddingX;
	const top = background.offsetY - ascent - background.paddingY;
	const width = word.width + background.paddingX * 2;
	const height = ascent + descent + background.paddingY * 2;
	if (width <= 0 || height <= 0) return;

	const radiusPercent =
		clamp({
			value: background.cornerRadius,
			min: CORNER_RADIUS_MIN,
			max: CORNER_RADIUS_MAX,
		}) / 100;
	const radius = (Math.min(width, height) / 2) * radiusPercent;
	ctx.save();
	ctx.fillStyle = background.color;
	ctx.beginPath();
	ctx.roundRect(left, top, width, height, radius);
	ctx.fill();
	ctx.restore();
}

function toCanvasCompositeOperation(
	blendMode: BlendMode | undefined,
): GlobalCompositeOperation {
	if (!blendMode || blendMode === "normal") {
		return "source-over";
	}
	if (blendMode === "plus-lighter") {
		return "lighter";
	}
	return blendMode as GlobalCompositeOperation;
}

export function strokeMeasuredTextLayout({
	ctx,
	layout,
	strokeColor,
	strokeWidth,
	textBaseline = "middle",
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	strokeColor: string;
	strokeWidth: number;
	textBaseline?: CanvasTextBaseline;
}): void {
	ctx.font = layout.fontString;
	ctx.textAlign = layout.textAlign;
	ctx.textBaseline = textBaseline;
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = strokeWidth;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	setCanvasLetterSpacing({ ctx, letterSpacingPx: layout.letterSpacing });

	for (let index = 0; index < layout.lines.length; index++) {
		const lineY = index * layout.lineHeightPx - layout.block.visualCenterOffset;
		ctx.strokeText(layout.lines[index], 0, lineY);
	}
}
