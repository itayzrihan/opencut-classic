import type { ParamDefinition } from "@/params";
import type { GraphicDefinition } from "../types";

export const UI_ELEMENT_GRAPHIC_ID = "ui-element";

const TEMPLATE_OPTIONS = [
	{ value: "neon-button", label: "Neon Button" },
	{ value: "click-button", label: "Click Button" },
	{ value: "rotating-bars", label: "Rotating Bars" },
	{ value: "flipping-bars", label: "Flipping Bars" },
	{ value: "anime-chat-bubble", label: "Anime Chat Bubble" },
	{ value: "progress-bar", label: "Progress Bar" },
	{ value: "bullet-list", label: "Piling Bullet List" },
	{ value: "checkbox-list", label: "Checkbox List" },
	{ value: "lower-third", label: "Lower Third" },
	{ value: "counter", label: "Counter" },
	{ value: "badge", label: "Badge" },
	{ value: "panel", label: "Panel" },
	{ value: "callout", label: "Callout" },
	{ value: "chart-bars", label: "Chart Bars" },
	{ value: "line-chart", label: "Line Chart" },
	{ value: "loading-ring", label: "Loading Ring" },
	{ value: "notification", label: "Notification" },
	{ value: "subscribe-button", label: "Subscribe Button" },
	{ value: "price-tag", label: "Price Tag" },
	{ value: "app-window", label: "App Window" },
	{ value: "timeline-stepper", label: "Timeline Stepper" },
	{ value: "split-title", label: "Split Title" },
	{ value: "waveform", label: "Waveform" },
	{ value: "social-card", label: "Social Card" },
	{ value: "stats-grid", label: "Stats Grid" },
	{ value: "countdown", label: "Countdown" },
	{ value: "toggle-switch", label: "Toggle Switch" },
	{ value: "rating-stars", label: "Rating Stars" },
	{ value: "leaderboard", label: "Leaderboard" },
	{ value: "tooltip", label: "Tooltip" },
	{ value: "carousel-dots", label: "Carousel Dots" },
] as const;

interface UiElementParams {
	template: string;
	label: string;
	secondary: string;
	items: string;
	accent: string;
	background: string;
	foreground: string;
	progress: number;
	checked: number;
	count: number;
	intensity: number;
}

const UI_ELEMENT_PARAMS: ParamDefinition<keyof UiElementParams & string>[] = [
	{
		key: "template",
		label: "Template",
		type: "select",
		default: "neon-button",
		options: [...TEMPLATE_OPTIONS],
	},
	{ key: "label", label: "Text", type: "text", default: "Continue" },
	{ key: "secondary", label: "Secondary", type: "text", default: "Details" },
	{
		key: "items",
		label: "Items",
		type: "text",
		default: "Research\nDesign\nEdit\nPublish",
	},
	{ key: "accent", label: "Accent", type: "color", default: "#00e5ff" },
	{ key: "background", label: "Background", type: "color", default: "#111827" },
	{ key: "foreground", label: "Text Color", type: "color", default: "#ffffff" },
	{
		key: "progress",
		label: "Progress",
		type: "number",
		default: 64,
		min: 0,
		max: 100,
		step: 1,
		unit: "percent",
	},
	{
		key: "checked",
		label: "Checked",
		type: "number",
		default: 2,
		min: 0,
		max: 10,
		step: 1,
	},
	{
		key: "count",
		label: "Count",
		type: "number",
		default: 3,
		min: 0,
		max: 9999,
		step: 1,
	},
	{
		key: "intensity",
		label: "Intensity",
		type: "number",
		default: 60,
		min: 0,
		max: 100,
		step: 1,
	},
];

function clampValue({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}): number {
	return Math.min(max, Math.max(min, value));
}

function splitItems(value: string): string[] {
	return value
		.split(/\n|,/)
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 8);
}

function roundRect({
	x,
	y,
	width,
	height,
	radius,
}: {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}): Path2D {
	const path = new Path2D();
	path.roundRect(x, y, width, height, radius);
	return path;
}

function fitText({
	ctx,
	text,
	maxWidth,
	startSize,
	minSize = 18,
	weight = 800,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	text: string;
	maxWidth: number;
	startSize: number;
	minSize?: number;
	weight?: number;
}): number {
	let size = startSize;
	while (size > minSize) {
		ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`;
		if (ctx.measureText(text).width <= maxWidth) {
			return size;
		}
		size -= 2;
	}
	return minSize;
}

function drawCenteredText({
	ctx,
	text,
	x,
	y,
	maxWidth,
	size,
	color,
	weight = 800,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	text: string;
	x: number;
	y: number;
	maxWidth: number;
	size: number;
	color: string;
	weight?: number;
}) {
	const fontSize = fitText({ ctx, text, maxWidth, startSize: size, weight });
	ctx.font = `${weight} ${fontSize}px Inter, Arial, sans-serif`;
	ctx.fillStyle = color;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, x, y, maxWidth);
}

function drawButton({
	ctx,
	width,
	height,
	label,
	accent,
	background,
	foreground,
	localTime,
	click = false,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	label: string;
	accent: string;
	background: string;
	foreground: string;
	localTime: number;
	click?: boolean;
}) {
	const pulse = 0.5 + Math.sin(localTime * Math.PI * 2) * 0.5;
	const buttonWidth = width * 0.58;
	const buttonHeight = height * 0.22;
	const x = (width - buttonWidth) / 2;
	const y = (height - buttonHeight) / 2;
	const radius = buttonHeight / 2;
	const path = roundRect({ x, y, width: buttonWidth, height: buttonHeight, radius });
	ctx.shadowColor = accent;
	ctx.shadowBlur = 28 + pulse * 20;
	ctx.fillStyle = background;
	ctx.fill(path);
	ctx.shadowBlur = 0;
	ctx.lineWidth = 5;
	ctx.strokeStyle = accent;
	ctx.stroke(path);
	if (click) {
		ctx.globalAlpha = 0.28 * pulse;
		ctx.lineWidth = 10;
		ctx.stroke(
			roundRect({
				x: x - 22 * pulse,
				y: y - 22 * pulse,
				width: buttonWidth + 44 * pulse,
				height: buttonHeight + 44 * pulse,
				radius: radius + 22 * pulse,
			}),
		);
		ctx.globalAlpha = 1;
	}
	drawCenteredText({
		ctx,
		text: label,
		x: width / 2,
		y: height / 2,
		maxWidth: buttonWidth * 0.78,
		size: 54,
		color: foreground,
	});
}

function drawList({
	ctx,
	width,
	height,
	items,
	accent,
	background,
	foreground,
	checked,
	checkbox,
	localTime,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	items: string[];
	accent: string;
	background: string;
	foreground: string;
	checked: number;
	checkbox: boolean;
	localTime: number;
}) {
	const rowHeight = height * 0.105;
	const startY = height * 0.2;
	const x = width * 0.23;
	const listWidth = width * 0.54;
	items.slice(0, 6).forEach((item, index) => {
		const enter = clampValue({
			value: localTime * 2 - index * 0.16,
			min: 0,
			max: 1,
		});
		const y = startY + index * rowHeight + (1 - enter) * 36;
		ctx.globalAlpha = 0.35 + enter * 0.65;
		ctx.fillStyle = background;
		ctx.fill(
			roundRect({
				x,
				y,
				width: listWidth,
				height: rowHeight * 0.72,
				radius: 14,
			}),
		);
		ctx.globalAlpha = 1;
		ctx.font = "600 28px Inter, Arial, sans-serif";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		if (checkbox) {
			ctx.strokeStyle = index < checked ? accent : foreground;
			ctx.lineWidth = 4;
			ctx.strokeRect(x + 22, y + rowHeight * 0.2, 28, 28);
			if (index < checked) {
				ctx.beginPath();
				ctx.moveTo(x + 27, y + rowHeight * 0.37);
				ctx.lineTo(x + 35, y + rowHeight * 0.5);
				ctx.lineTo(x + 50, y + rowHeight * 0.24);
				ctx.stroke();
			}
			ctx.fillStyle = foreground;
			ctx.fillText(item, x + 70, y + rowHeight * 0.37, listWidth - 90);
			return;
		}
		ctx.fillStyle = accent;
		ctx.beginPath();
		ctx.arc(x + 36, y + rowHeight * 0.37, 8, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = foreground;
		ctx.fillText(item, x + 62, y + rowHeight * 0.37, listWidth - 80);
	});
}

function drawProgress({
	ctx,
	width,
	height,
	label,
	progress,
	accent,
	background,
	foreground,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	label: string;
	progress: number;
	accent: string;
	background: string;
	foreground: string;
}) {
	const x = width * 0.18;
	const y = height * 0.45;
	const barWidth = width * 0.64;
	const barHeight = height * 0.11;
	ctx.fillStyle = background;
	ctx.fill(roundRect({ x, y, width: barWidth, height: barHeight, radius: barHeight / 2 }));
	ctx.fillStyle = accent;
	ctx.fill(
		roundRect({
			x,
			y,
			width: Math.max(
				barHeight,
				(barWidth * clampValue({ value: progress, min: 0, max: 100 })) / 100,
			),
			height: barHeight,
			radius: barHeight / 2,
		}),
	);
	drawCenteredText({
		ctx,
		text: label,
		x: width / 2,
		y: y - 60,
		maxWidth: barWidth,
		size: 40,
		color: foreground,
	});
	drawCenteredText({
		ctx,
		text: `${Math.round(progress)}%`,
		x: width / 2,
		y: y + barHeight / 2,
		maxWidth: barWidth,
		size: 32,
		color: foreground,
	});
}

function drawBars({
	ctx,
	width,
	height,
	accent,
	foreground,
	localTime,
	flip = false,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	accent: string;
	foreground: string;
	localTime: number;
	flip?: boolean;
}) {
	const count = 8;
	ctx.save();
	ctx.translate(width / 2, height / 2);
	if (!flip) {
		ctx.rotate(localTime * Math.PI * 2);
	}
	for (let index = 0; index < count; index++) {
		const phase = localTime * 4 + index * 0.55;
		const barHeight = height * (0.16 + Math.abs(Math.sin(phase)) * 0.22);
		const x = (index - count / 2) * width * 0.055;
		ctx.fillStyle = index % 2 ? foreground : accent;
		ctx.globalAlpha = 0.45 + Math.abs(Math.sin(phase)) * 0.55;
		ctx.fill(
			roundRect({
				x,
				y: -barHeight / 2,
				width: width * 0.028,
				height: barHeight,
				radius: width * 0.014,
			}),
		);
	}
	ctx.restore();
	ctx.globalAlpha = 1;
}

function drawChart({
	ctx,
	width,
	height,
	accent,
	foreground,
	line,
	localTime,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	accent: string;
	foreground: string;
	line: boolean;
	localTime: number;
}) {
	const values = [0.32, 0.58, 0.44, 0.76, 0.62, 0.88, 0.72];
	const x = width * 0.2;
	const y = height * 0.24;
	const chartWidth = width * 0.6;
	const chartHeight = height * 0.48;
	ctx.strokeStyle = `${foreground}55`;
	ctx.lineWidth = 2;
	for (let i = 0; i < 4; i++) {
		const gridY = y + (chartHeight / 3) * i;
		ctx.beginPath();
		ctx.moveTo(x, gridY);
		ctx.lineTo(x + chartWidth, gridY);
		ctx.stroke();
	}
	if (line) {
		ctx.strokeStyle = accent;
		ctx.lineWidth = 8;
		ctx.lineJoin = "round";
		ctx.beginPath();
		values.forEach((value, index) => {
			const pointX = x + (chartWidth / (values.length - 1)) * index;
			const pointY =
				y +
				chartHeight -
				chartHeight *
					value *
					clampValue({ value: localTime * 1.4, min: 0.2, max: 1 });
			if (index === 0) ctx.moveTo(pointX, pointY);
			else ctx.lineTo(pointX, pointY);
		});
		ctx.stroke();
		return;
	}
	values.forEach((value, index) => {
		const barWidth = (chartWidth / values.length) * 0.62;
		const pointX = x + (chartWidth / values.length) * index + barWidth * 0.3;
		const barHeight =
			chartHeight *
			value *
			clampValue({
				value: localTime * 1.5 - index * 0.08,
				min: 0.12,
				max: 1,
			});
		ctx.fillStyle = index % 2 ? foreground : accent;
		ctx.fill(
			roundRect({
				x: pointX,
				y: y + chartHeight - barHeight,
				width: barWidth,
				height: barHeight,
				radius: 12,
			}),
		);
	});
}

function drawSimpleCard({
	ctx,
	width,
	height,
	label,
	secondary,
	accent,
	background,
	foreground,
	template,
	progress,
	count,
	localTime,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	label: string;
	secondary: string;
	accent: string;
	background: string;
	foreground: string;
	template: string;
	progress: number;
	count: number;
	localTime: number;
}) {
	const x = width * 0.19;
	const y = height * 0.2;
	const cardWidth = width * 0.62;
	const cardHeight = height * 0.48;
	const cardPath = roundRect({
		x,
		y,
		width: cardWidth,
		height: cardHeight,
		radius: 28,
	});
	ctx.fillStyle = background;
	ctx.shadowColor = "#00000088";
	ctx.shadowBlur = 20;
	ctx.fill(cardPath);
	ctx.shadowBlur = 0;
	ctx.strokeStyle = accent;
	ctx.lineWidth = 4;
	ctx.stroke(cardPath);
	if (template === "loading-ring" || template === "countdown") {
		ctx.strokeStyle = accent;
		ctx.lineWidth = 16;
		ctx.beginPath();
		ctx.arc(
			width / 2,
			y + cardHeight * 0.42,
			cardHeight * 0.18,
			-Math.PI / 2,
			-Math.PI / 2 +
				Math.PI * 2 * (progress / 100 + localTime * 0.2),
		);
		ctx.stroke();
	}
	if (template === "toggle-switch") {
		const switchWidth = cardWidth * 0.42;
		const switchHeight = cardHeight * 0.2;
		const switchX = width / 2 - switchWidth / 2;
		const switchY = y + cardHeight * 0.42;
		ctx.fillStyle = progress >= 50 ? accent : `${foreground}33`;
		ctx.fill(
			roundRect({
				x: switchX,
				y: switchY,
				width: switchWidth,
				height: switchHeight,
				radius: switchHeight / 2,
			}),
		);
		ctx.fillStyle = foreground;
		ctx.beginPath();
		ctx.arc(
			switchX + (progress >= 50 ? switchWidth - switchHeight / 2 : switchHeight / 2),
			switchY + switchHeight / 2,
			switchHeight * 0.36,
			0,
			Math.PI * 2,
		);
		ctx.fill();
	}
	if (template === "rating-stars") {
		ctx.fillStyle = accent;
		ctx.font = "700 46px Inter, Arial, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(
			"*****".slice(0, Math.max(1, Math.min(5, Math.round(count)))),
			width / 2,
			y + cardHeight * 0.42,
		);
	}
	drawCenteredText({
		ctx,
		text: label,
		x: width / 2,
		y: y + cardHeight * 0.72,
		maxWidth: cardWidth * 0.78,
		size: 38,
		color: foreground,
	});
	drawCenteredText({
		ctx,
		text: secondary,
		x: width / 2,
		y: y + cardHeight * 0.86,
		maxWidth: cardWidth * 0.72,
		size: 22,
		color: `${foreground}cc`,
		weight: 600,
	});
}

export const uiElementGraphicDefinition: GraphicDefinition = {
	id: UI_ELEMENT_GRAPHIC_ID,
	name: "UI Element",
	keywords: ["ui", "button", "motion", "graphic", "overlay", "hud"],
	params: UI_ELEMENT_PARAMS,
	sourceSize: () => ({ width: 1200, height: 675 }),
	render({ ctx, params, width, height, localTime = 0 }) {
		const template = String(params.template ?? "neon-button");
		const label = String(params.label ?? "Continue");
		const secondary = String(params.secondary ?? "Details");
		const items = splitItems(String(params.items ?? ""));
		const accent = String(params.accent ?? "#00e5ff");
		const background = String(params.background ?? "#111827");
		const foreground = String(params.foreground ?? "#ffffff");
		const progress = clampValue({
			value: Number(params.progress ?? 64),
			min: 0,
			max: 100,
		});
		const checked = Math.round(
			clampValue({ value: Number(params.checked ?? 2), min: 0, max: 10 }),
		);
		const count = Math.round(
			clampValue({ value: Number(params.count ?? 3), min: 0, max: 9999 }),
		);
		const intensity =
			clampValue({ value: Number(params.intensity ?? 60), min: 0, max: 100 }) /
			100;

		ctx.clearRect(0, 0, width, height);
		ctx.globalAlpha = 1;

		switch (template) {
			case "click-button":
			case "subscribe-button":
				drawButton({
					ctx,
					width,
					height,
					label,
					accent,
					background,
					foreground,
					localTime,
					click: true,
				});
				break;
			case "rotating-bars":
				drawBars({ ctx, width, height, accent, foreground, localTime });
				break;
			case "flipping-bars":
			case "waveform":
				drawBars({
					ctx,
					width,
					height,
					accent,
					foreground,
					localTime: localTime * (1 + intensity),
					flip: true,
				});
				break;
			case "anime-chat-bubble": {
				const x = width * 0.18;
				const y = height * 0.22;
				const bubbleWidth = width * 0.64;
				const bubbleHeight = height * 0.35;
				ctx.fillStyle = background;
				ctx.fill(
					roundRect({
						x,
						y,
						width: bubbleWidth,
						height: bubbleHeight,
						radius: 34,
					}),
				);
				ctx.beginPath();
				ctx.moveTo(x + bubbleWidth * 0.18, y + bubbleHeight);
				ctx.lineTo(x + bubbleWidth * 0.25, y + bubbleHeight + height * 0.1);
				ctx.lineTo(x + bubbleWidth * 0.36, y + bubbleHeight);
				ctx.closePath();
				ctx.fill();
				ctx.strokeStyle = accent;
				ctx.lineWidth = 5;
				ctx.stroke(
					roundRect({
						x,
						y,
						width: bubbleWidth,
						height: bubbleHeight,
						radius: 34,
					}),
				);
				drawCenteredText({
					ctx,
					text: label,
					x: width / 2,
					y: y + bubbleHeight * 0.45,
					maxWidth: bubbleWidth * 0.78,
					size: 42,
					color: foreground,
				});
				drawCenteredText({
					ctx,
					text: secondary,
					x: width / 2,
					y: y + bubbleHeight * 0.68,
					maxWidth: bubbleWidth * 0.78,
					size: 24,
					color: accent,
					weight: 700,
				});
				break;
			}
			case "progress-bar":
				drawProgress({
					ctx,
					width,
					height,
					label,
					progress,
					accent,
					background,
					foreground,
				});
				break;
			case "bullet-list":
				drawList({
					ctx,
					width,
					height,
					items,
					accent,
					background,
					foreground,
					checked,
					checkbox: false,
					localTime,
				});
				break;
			case "checkbox-list":
				drawList({
					ctx,
					width,
					height,
					items,
					accent,
					background,
					foreground,
					checked,
					checkbox: true,
					localTime,
				});
				break;
			case "lower-third": {
				const y = height * 0.58;
				ctx.fillStyle = background;
				ctx.fillRect(width * 0.12, y, width * 0.58, height * 0.16);
				ctx.fillStyle = accent;
				ctx.fillRect(width * 0.12, y, width * 0.025, height * 0.16);
				ctx.textAlign = "left";
				ctx.textBaseline = "middle";
				ctx.fillStyle = foreground;
				ctx.font = "800 38px Inter, Arial, sans-serif";
				ctx.fillText(label, width * 0.17, y + height * 0.055, width * 0.48);
				ctx.font = "600 22px Inter, Arial, sans-serif";
				ctx.fillStyle = accent;
				ctx.fillText(secondary, width * 0.17, y + height * 0.115, width * 0.48);
				break;
			}
			case "counter":
				drawCenteredText({
					ctx,
					text: String(count),
					x: width / 2,
					y: height * 0.42,
					maxWidth: width * 0.5,
					size: 104,
					color: accent,
				});
				drawCenteredText({
					ctx,
					text: label,
					x: width / 2,
					y: height * 0.59,
					maxWidth: width * 0.5,
					size: 38,
					color: foreground,
				});
				break;
			case "chart-bars":
				drawChart({ ctx, width, height, accent, foreground, line: false, localTime });
				break;
			case "line-chart":
				drawChart({ ctx, width, height, accent, foreground, line: true, localTime });
				break;
			case "badge":
			case "callout":
			case "panel":
			case "notification":
			case "price-tag":
			case "app-window":
			case "timeline-stepper":
			case "split-title":
			case "social-card":
			case "stats-grid":
			case "loading-ring":
			case "countdown":
			case "toggle-switch":
			case "rating-stars":
			case "leaderboard":
			case "tooltip":
			case "carousel-dots":
				drawSimpleCard({
					ctx,
					width,
					height,
					label,
					secondary,
					accent,
					background,
					foreground,
					template,
					progress,
					count,
					localTime,
				});
				break;
			case "neon-button":
			default:
				drawButton({
					ctx,
					width,
					height,
					label,
					accent,
					background,
					foreground,
					localTime,
				});
		}
	},
};
