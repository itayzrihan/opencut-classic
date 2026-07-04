import { CORNER_RADIUS_MIN } from "@/text/background";
import { DEFAULTS } from "@/timeline/defaults";
import type { TextElement } from "@/timeline";
import type { TextWordRun, TextWordStyle } from "@/timeline";
import type { TextCaptionRevealMode, TextWordTransitionIn } from "@/timeline";
import type { TextBackground } from "@/text/background";
import { resolveNumberAtTime } from "@/animation/values";
import { getTextVisualRect, type TextLayoutMeasurementContext } from "./layout";
import {
	buildTextFontString,
	measureTextLayout,
	type MeasuredTextLayout,
	type MeasuredWordGlyph,
	type MeasuredWordLine,
	type TextAlign,
	type TextDecoration,
	type TextFontStyle,
	type TextFontWeight,
	type TextLayoutParams,
} from "./primitives";
import { getCaptionWordAnimation } from "./caption-presets";
import { FONT_SIZE_SCALE_REFERENCE } from "./typography";

export interface ResolvedTextBackground extends TextBackground {
	paddingX: number;
	paddingY: number;
	offsetX: number;
	offsetY: number;
	cornerRadius: number;
}

export interface MeasuredTextElement extends MeasuredTextLayout {
	resolvedBackground: ResolvedTextBackground;
	visualRect: { left: number; top: number; width: number; height: number };
}

let textMeasurementContext: TextLayoutMeasurementContext | null = null;

class FallbackTextMetrics implements TextMetrics {
	width: number;
	actualBoundingBoxLeft = 0;
	actualBoundingBoxRight: number;
	fontBoundingBoxAscent: number;
	fontBoundingBoxDescent: number;
	actualBoundingBoxAscent: number;
	actualBoundingBoxDescent: number;
	emHeightAscent: number;
	emHeightDescent: number;
	hangingBaseline = 0;
	alphabeticBaseline = 0;
	ideographicBaseline = 0;

	constructor({ text, fontSize }: { text: string; fontSize: number }) {
		this.width = text.length * fontSize * 0.6;
		this.actualBoundingBoxRight = this.width;
		this.fontBoundingBoxAscent = fontSize * 0.8;
		this.fontBoundingBoxDescent = fontSize * 0.2;
		this.actualBoundingBoxAscent = fontSize * 0.8;
		this.actualBoundingBoxDescent = fontSize * 0.2;
		this.emHeightAscent = fontSize * 0.8;
		this.emHeightDescent = fontSize * 0.2;
	}
}

function createFallbackTextMeasurementContext(): TextLayoutMeasurementContext {
	const context: TextLayoutMeasurementContext = {
		font: "15px sans-serif",
		textBaseline: "middle",
		save() {},
		restore() {},
		measureText(text: string): TextMetrics {
			const fontSize = Number.parseFloat(
				this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "15",
			);
			return new FallbackTextMetrics({ text, fontSize });
		},
	};

	return context;
}

export function getTextMeasurementContext(): TextLayoutMeasurementContext {
	if (textMeasurementContext) {
		return textMeasurementContext;
	}

	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(1, 1);
		const context = canvas.getContext("2d");
		if (context) {
			textMeasurementContext = context;
			return context;
		}
	}

	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (context) {
			textMeasurementContext = context;
			return context;
		}
	}

	textMeasurementContext = createFallbackTextMeasurementContext();
	return textMeasurementContext;
}

export function measureTextElement({
	element,
	canvasHeight,
	localTime,
	ctx,
}: {
	element: TextElement;
	canvasHeight: number;
	localTime: number;
	ctx: TextLayoutMeasurementContext;
}): MeasuredTextElement {
	const text = buildTextLayoutParamsFromElement({ element });
	const measuredLayout = measureTextLayout({
		text,
		canvasHeight,
		ctx,
	});
	const measuredTextWithWords = measureWordRunsLayout({
		element,
		text,
		measuredLayout,
		canvasHeight,
		localTime,
		ctx,
	});

	const bg = buildTextBackgroundFromElement({ element });
	const resolvedBackground: ResolvedTextBackground = {
		...bg,
		paddingX: resolveNumberAtTime({
			baseValue: bg.paddingX ?? DEFAULTS.text.background.paddingX,
			animations: element.animations,
			propertyPath: "background.paddingX",
			localTime,
		}),
		paddingY: resolveNumberAtTime({
			baseValue: bg.paddingY ?? DEFAULTS.text.background.paddingY,
			animations: element.animations,
			propertyPath: "background.paddingY",
			localTime,
		}),
		offsetX: resolveNumberAtTime({
			baseValue: bg.offsetX ?? DEFAULTS.text.background.offsetX,
			animations: element.animations,
			propertyPath: "background.offsetX",
			localTime,
		}),
		offsetY: resolveNumberAtTime({
			baseValue: bg.offsetY ?? DEFAULTS.text.background.offsetY,
			animations: element.animations,
			propertyPath: "background.offsetY",
			localTime,
		}),
		cornerRadius: resolveNumberAtTime({
			baseValue: bg.cornerRadius ?? CORNER_RADIUS_MIN,
			animations: element.animations,
			propertyPath: "background.cornerRadius",
			localTime,
		}),
	};

	const visualRect = getTextVisualRect({
		textAlign: text.textAlign,
		block: measuredTextWithWords.block,
		background: resolvedBackground,
		fontSizeRatio: measuredTextWithWords.fontSizeRatio,
	});

	return {
		...measuredTextWithWords,
		resolvedBackground,
		visualRect,
	};
}

function measureWordRunsLayout({
	element,
	text,
	measuredLayout,
	canvasHeight,
	localTime,
	ctx,
}: {
	element: TextElement;
	text: TextLayoutParams;
	measuredLayout: MeasuredTextLayout;
	canvasHeight: number;
	localTime: number;
	ctx: TextLayoutMeasurementContext;
}): MeasuredTextLayout {
	if (!element.wordRuns?.length) {
		return measuredLayout;
	}

	const legacyElement = element as TextElement & { captionPresetId?: string };
	const preset = getCaptionWordAnimation({
		wordAnimationId:
			element.captionWordAnimationId ?? legacyElement.captionPresetId,
	});
	const revealMode = resolveRevealMode({
		elementMode: element.captionRevealMode,
		presetMode: preset.revealMode,
	});
	const direction = resolveWordDirection({ element });
	const lineGroups = new Map<number, TextWordRun[]>();
	for (const run of element.wordRuns) {
		const line = run.lineIndex ?? 0;
		lineGroups.set(line, [...(lineGroups.get(line) ?? []), run]);
	}

	const lineIndexes = [...lineGroups.keys()].sort((a, b) => a - b);
	const spaceWidth = measureStyledWord({
		ctx,
		text: " ",
		style: text,
		canvasHeight,
	}).metrics.width;
	const wordLines: MeasuredWordLine[] = [];
	const lineMetrics: TextMetrics[] = [];
	const lineHeightPx = measuredLayout.lineHeightPx;
	let maxWidth = 0;

	for (let visualLineIndex = 0; visualLineIndex < lineIndexes.length; visualLineIndex++) {
		const lineIndex = lineIndexes[visualLineIndex];
		const sourceWords = direction === "rtl"
			? [...(lineGroups.get(lineIndex) ?? [])].reverse()
			: (lineGroups.get(lineIndex) ?? []);
		const measuredWords = sourceWords.map((run) => {
			const style = resolveWordStyle({
				base: text,
				run,
				localTime,
				revealMode,
				transitionIn: element.captionTransitionIn ?? "blur-zoom",
				preset,
				accentColor: element.captionAccentColor,
				baseColor: typeof element.params.color === "string" ? element.params.color : undefined,
			});
			return {
				run,
				style,
				drawText: resolveDrawText({
					run,
					style,
					localTime,
					direction,
				}),
				...measureStyledWord({
					ctx,
					text: run.text,
					style,
					canvasHeight,
				}),
			};
		});
		const width = measuredWords.reduce(
			(total, word, index) =>
				total + word.metrics.width + (index > 0 ? spaceWidth : 0),
			0,
		);
		maxWidth = Math.max(maxWidth, width);

		let x = 0;
		if (text.textAlign === "center") x = -width / 2;
		if (text.textAlign === "right") x = -width;

		const y = visualLineIndex * lineHeightPx;
		const words: MeasuredWordGlyph[] = measuredWords.map((word, index) => {
			if (index > 0) x += spaceWidth;
			const glyphX = x;
			x += word.metrics.width;
			return {
				id: word.run.id,
				text: word.run.text,
				drawText: word.drawText,
				x: glyphX,
				y,
				width: word.metrics.width,
				metrics: word.metrics,
				fontString: word.fontString,
				scaledFontSize: word.scaledFontSize,
				letterSpacing: word.style.letterSpacing ?? text.letterSpacing ?? DEFAULTS.text.letterSpacing,
				color: word.style.color ?? "#ffffff",
				opacity: word.style.opacity ?? 1,
				scale: word.style.scale ?? 1,
				rotate: word.style.rotate ?? 0,
				blur: word.style.blur ?? 0,
				shadowBlur: word.style.shadowBlur ?? 0,
				shadowColor: word.style.shadowColor ?? word.style.color ?? "#ffffff",
				offsetX: word.style.offsetX ?? 0,
				offsetY: word.style.offsetY ?? 0,
				direction,
				textDecoration: word.style.textDecoration ?? text.textDecoration ?? "none",
			};
		});
		wordLines.push({ y, width, words });
		lineMetrics.push({ width } as TextMetrics);
	}

	const block = {
		maxWidth,
		height: Math.max(1, wordLines.length) * lineHeightPx,
		visualCenterOffset: ((Math.max(1, wordLines.length) - 1) * lineHeightPx) / 2,
	};

	return {
		...measuredLayout,
		lines: wordLines.map((line) => line.words.map((word) => word.text).join(" ")),
		lineMetrics,
		block,
		wordLines: wordLines.map((line) => ({
			...line,
			y: line.y - block.visualCenterOffset,
			words: line.words.map((word) => ({
				...word,
				y: word.y - block.visualCenterOffset,
			})),
		})),
	};
}

function resolveWordStyle({
	base,
	run,
	localTime,
	revealMode,
	transitionIn,
	preset,
	accentColor,
	baseColor,
}: {
	base: TextLayoutParams;
	run: TextWordRun;
	localTime: number;
	revealMode: TextCaptionRevealMode;
	transitionIn: TextWordTransitionIn;
	preset: ReturnType<typeof getCaptionWordAnimation>;
	accentColor: string | undefined;
	baseColor: string | undefined;
}): TextWordStyle & TextLayoutParams {
	const start = run.startTime ?? 0;
	const end = run.endTime ?? start;
	const isActive = localTime >= start && localTime < end;
	const isSpoken = localTime >= end;
	const progress = Math.max(
		0,
		Math.min(1, (localTime - start) / Math.max(0.001, end - start)),
	);
	const isPresetDriven = revealMode === "determined-by-preset";
	const effectiveRevealMode = isPresetDriven ? preset.revealMode : revealMode;
	const isVisible =
		effectiveRevealMode === "row" ||
		isActive ||
		((effectiveRevealMode === "growing-row" ||
			effectiveRevealMode === "spoken-word-keep" ||
			effectiveRevealMode === "emphasize-spoken-keep") &&
			(isSpoken || isActive)) ||
		(effectiveRevealMode === "emphasize-spoken" && !isActive);

	const presetStyle = isActive
		? preset.activeStyle
		: isSpoken && preset.spokenStyle
			? preset.spokenStyle
			: preset.idleStyle;
	const revealStyle = isPresetDriven
		? {}
		: resolveRevealStyle({
				revealMode: effectiveRevealMode,
				transitionIn,
				isActive,
				isSpoken,
				isVisible,
				progress,
			});
	const color =
		isActive && preset.useAccentOnActive
			? (accentColor ?? presetStyle.color ?? baseColor)
			: isSpoken && preset.useAccentOnSpoken
				? (accentColor ?? presetStyle.color ?? baseColor)
				: presetStyle.color;

	return {
		...base,
		...presetStyle,
		...revealStyle,
		...run.style,
		color: run.style?.color ?? color ?? baseColor ?? "#ffffff",
		shadowColor:
			run.style?.shadowColor ??
			((presetStyle.shadowBlur ?? 0) > 0
				? (accentColor ?? color ?? baseColor ?? "#ffffff")
				: presetStyle.shadowColor),
		opacity:
			run.style?.opacity ??
			revealStyle.opacity ??
			(isPresetDriven ? presetStyle.opacity : undefined) ??
			1,
	};
}

function resolveRevealMode({
	elementMode,
	presetMode,
}: {
	elementMode: TextElement["captionRevealMode"];
	presetMode: TextCaptionRevealMode;
}): TextCaptionRevealMode {
	return elementMode ?? presetMode;
}

function resolveRevealStyle({
	revealMode,
	transitionIn,
	isActive,
	isSpoken,
	isVisible,
	progress,
}: {
	revealMode: TextCaptionRevealMode;
	transitionIn: TextWordTransitionIn;
	isActive: boolean;
	isSpoken: boolean;
	isVisible: boolean;
	progress: number;
}): TextWordStyle {
	if (!isVisible) {
		return { opacity: 0 };
	}

	const activeEntrance = isActive
		? resolveTransitionInStyle({ transitionIn, progress })
		: {};

	if (revealMode === "row") {
		return { opacity: 1 };
	}

	if (revealMode === "spoken-word" || revealMode === "spoken-word-keep") {
		return isActive
			? { opacity: 1, ...activeEntrance }
			: { opacity: isSpoken ? 1 : 0 };
	}

	if (revealMode === "growing-row") {
		return isActive
			? { opacity: 1, ...activeEntrance }
			: { opacity: isSpoken ? 1 : 0 };
	}

	if (revealMode === "emphasize-spoken" || revealMode === "emphasize-spoken-keep") {
		if (isActive) {
			return { opacity: 1, scale: 1.18, fontWeight: "bold", ...activeEntrance };
		}
		return {
			opacity: revealMode === "emphasize-spoken-keep" && isSpoken ? 1 : 0.58,
			scale: revealMode === "emphasize-spoken-keep" && isSpoken ? 1.06 : 1,
		};
	}

	return {};
}

function resolveTransitionInStyle({
	transitionIn,
	progress,
}: {
	transitionIn: TextWordTransitionIn;
	progress: number;
}): TextWordStyle {
	const eased = 1 - Math.pow(1 - progress, 3);
	switch (transitionIn) {
		case "none":
			return {};
		case "fade":
			return { opacity: eased };
		case "blur":
			return { opacity: eased, blur: (1 - eased) * 12 };
		case "zoom":
			return { opacity: eased, scale: 0.72 + eased * 0.28 };
		case "blur-zoom":
			return { opacity: eased, blur: (1 - eased) * 14, scale: 0.72 + eased * 0.28 };
		case "rise":
			return { opacity: eased, offsetY: (1 - eased) * 20 };
		case "slide":
			return { opacity: eased, offsetX: (1 - eased) * -28, blur: (1 - eased) * 6 };
		case "typewriter":
			return { opacity: 1, characterReveal: true };
		case "glow-dissolve":
			return {
				opacity: eased,
				blur: (1 - eased) * 18,
				scale: 1.28 - eased * 0.28,
				shadowBlur: 28 * eased,
			};
	}
}

function resolveDrawText({
	run,
	style,
	localTime,
	direction,
}: {
	run: TextWordRun;
	style: TextWordStyle & TextLayoutParams;
	localTime: number;
	direction: CanvasDirection;
}) {
	if (!style.characterReveal) {
		return run.text;
	}
	const start = run.startTime ?? 0;
	const end = run.endTime ?? start;
	if (localTime <= start) {
		return "";
	}
	if (localTime >= end) {
		return run.text;
	}
	const progress = Math.max(0, Math.min(1, (localTime - start) / Math.max(0.001, end - start)));
	const characters = Array.from(run.text);
	const visibleCount = Math.max(1, Math.ceil(characters.length * progress));
	if (direction === "rtl") {
		return characters.slice(0, visibleCount).join("");
	}
	return characters.slice(0, visibleCount).join("");
}

function resolveWordDirection({
	element,
}: {
	element: TextElement;
}): CanvasDirection {
	if (element.captionWordDirection === "ltr" || element.captionWordDirection === "rtl") {
		return element.captionWordDirection;
	}
	const text = element.wordRuns?.map((word) => word.text).join(" ") ??
		(typeof element.params.content === "string" ? element.params.content : "");
	return /[\u0590-\u05ff\u0600-\u06ff]/.test(text) ? "rtl" : "ltr";
}

function measureStyledWord({
	ctx,
	text,
	style,
	canvasHeight,
}: {
	ctx: TextLayoutMeasurementContext;
	text: string;
	style: TextWordStyle & TextLayoutParams;
	canvasHeight: number;
}): {
	metrics: TextMetrics;
	fontString: string;
	scaledFontSize: number;
} {
	const scaledFontSize =
		(style.fontSize ?? 15) * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
	const fontString = buildTextFontString({
		fontFamily: style.fontFamily ?? "Arial",
		fontWeight: style.fontWeight === "bold" ? "bold" : "normal",
		fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
		scaledFontSize,
	});
	ctx.save();
	ctx.font = fontString;
	ctx.textBaseline = "middle";
	if ("letterSpacing" in ctx) {
		ctx.letterSpacing = `${style.letterSpacing ?? DEFAULTS.text.letterSpacing}px`;
	}
	const metrics = ctx.measureText(text);
	ctx.restore();
	return { metrics, fontString, scaledFontSize };
}

export function buildTextLayoutParamsFromElement({
	element,
}: {
	element: TextElement;
}): TextLayoutParams {
	return {
		content: readStringParam({
			params: element.params,
			key: "content",
			fallback: "Default text",
		}),
		fontSize: readNumberParam({
			params: element.params,
			key: "fontSize",
			fallback: 15,
		}),
		fontFamily: readStringParam({
			params: element.params,
			key: "fontFamily",
			fallback: "Arial",
		}),
		fontWeight: readFontWeight({
			value: element.params.fontWeight,
			fallback: "normal",
		}),
		fontStyle: readFontStyle({
			value: element.params.fontStyle,
			fallback: "normal",
		}),
		textAlign: readTextAlign({
			value: element.params.textAlign,
			fallback: "center",
		}),
		textDecoration: readTextDecoration({
			value: element.params.textDecoration,
			fallback: "none",
		}),
		letterSpacing: readNumberParam({
			params: element.params,
			key: "letterSpacing",
			fallback: DEFAULTS.text.letterSpacing,
		}),
		lineHeight: readNumberParam({
			params: element.params,
			key: "lineHeight",
			fallback: DEFAULTS.text.lineHeight,
		}),
	};
}

export function buildTextBackgroundFromElement({
	element,
}: {
	element: TextElement;
}): TextBackground {
	return {
		enabled: readBooleanParam({
			params: element.params,
			key: "background.enabled",
			fallback: DEFAULTS.text.background.enabled,
		}),
		color: readStringParam({
			params: element.params,
			key: "background.color",
			fallback: DEFAULTS.text.background.color,
		}),
		cornerRadius: readNumberParam({
			params: element.params,
			key: "background.cornerRadius",
			fallback: DEFAULTS.text.background.cornerRadius,
		}),
		paddingX: readNumberParam({
			params: element.params,
			key: "background.paddingX",
			fallback: DEFAULTS.text.background.paddingX,
		}),
		paddingY: readNumberParam({
			params: element.params,
			key: "background.paddingY",
			fallback: DEFAULTS.text.background.paddingY,
		}),
		offsetX: readNumberParam({
			params: element.params,
			key: "background.offsetX",
			fallback: DEFAULTS.text.background.offsetX,
		}),
		offsetY: readNumberParam({
			params: element.params,
			key: "background.offsetY",
			fallback: DEFAULTS.text.background.offsetY,
		}),
	};
}

function readStringParam({
	params,
	key,
	fallback,
}: {
	params: TextElement["params"];
	key: string;
	fallback: string;
}): string {
	const value = params[key];
	return typeof value === "string" ? value : fallback;
}

function readNumberParam({
	params,
	key,
	fallback,
}: {
	params: TextElement["params"];
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" ? value : fallback;
}

function readBooleanParam({
	params,
	key,
	fallback,
}: {
	params: TextElement["params"];
	key: string;
	fallback: boolean;
}): boolean {
	const value = params[key];
	return typeof value === "boolean" ? value : fallback;
}

function readTextAlign({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextAlign;
}): TextAlign {
	return value === "left" || value === "center" || value === "right"
		? value
		: fallback;
}

function readFontWeight({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextFontWeight;
}): TextFontWeight {
	return value === "bold" || value === "normal" ? value : fallback;
}

function readFontStyle({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextFontStyle;
}): TextFontStyle {
	return value === "italic" || value === "normal" ? value : fallback;
}

function readTextDecoration({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextDecoration;
}): TextDecoration {
	return value === "none" || value === "underline" || value === "line-through"
		? value
		: fallback;
}
