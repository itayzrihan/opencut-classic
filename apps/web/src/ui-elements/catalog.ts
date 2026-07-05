import { UI_ELEMENT_GRAPHIC_ID } from "@/graphics/definitions/ui-element";
import type { ParamValues } from "@/params";

export interface UiElementPreset {
	id: string;
	name: string;
	description: string;
	params: ParamValues;
}

function preset({
	id,
	name,
	description,
	template,
	label,
	secondary = "Details",
	items,
	accent = "#00e5ff",
	background = "#111827",
	foreground = "#ffffff",
	progress = 64,
	checked = 2,
	count = 3,
	intensity = 60,
}: {
	id: string;
	name: string;
	description: string;
	template: string;
	label: string;
	secondary?: string;
	items?: string;
	accent?: string;
	background?: string;
	foreground?: string;
	progress?: number;
	checked?: number;
	count?: number;
	intensity?: number;
}): UiElementPreset {
	return {
		id,
		name,
		description,
		params: {
			template,
			label,
			secondary,
			items: items ?? "Research\nDesign\nEdit\nPublish",
			accent,
			background,
			foreground,
			progress,
			checked,
			count,
			intensity,
		},
	};
}

export const UI_ELEMENT_DEFINITION_ID = UI_ELEMENT_GRAPHIC_ID;

export const UI_ELEMENT_PRESETS: UiElementPreset[] = [
	preset({ id: "neon-cta", name: "Neon CTA", description: "Glowing editable call-to-action", template: "neon-button", label: "Start Now" }),
	preset({ id: "pulse-click", name: "Click Pulse", description: "Button with click ripple", template: "click-button", label: "Tap Here", accent: "#ff2bd6" }),
	preset({ id: "subscribe", name: "Subscribe Button", description: "Creator video subscribe button", template: "subscribe-button", label: "Subscribe", accent: "#ff0033" }),
	preset({ id: "rotating-bars", name: "Rotating Bars", description: "Looping radial motion bars", template: "rotating-bars", label: "Loading" }),
	preset({ id: "flipping-bars", name: "Flipping Bars", description: "Motion graphic equalizer bars", template: "flipping-bars", label: "Sync" }),
	preset({ id: "audio-waveform", name: "Waveform", description: "Animated waveform style bars", template: "waveform", label: "Audio", accent: "#22c55e" }),
	preset({ id: "anime-chat", name: "Anime Chat", description: "Chat bubble with subtitle line", template: "anime-chat-bubble", label: "That was close!", secondary: "Episode 04", accent: "#f472b6" }),
	preset({ id: "progress-upload", name: "Progress", description: "Editable progress bar", template: "progress-bar", label: "Uploading", progress: 72 }),
	preset({ id: "xp-progress", name: "XP Bar", description: "Game-like progress tracker", template: "progress-bar", label: "Level Progress", accent: "#a3e635", progress: 48 }),
	preset({ id: "bullet-stack", name: "Bullet Stack", description: "Piling bullet list", template: "bullet-list", label: "Plan", items: "Hook\nProblem\nProof\nOffer" }),
	preset({ id: "checklist", name: "Checklist", description: "Animated checklist", template: "checkbox-list", label: "Tasks", items: "Script\nRecord\nEdit\nPublish", checked: 3, accent: "#22c55e" }),
	preset({ id: "lower-third-clean", name: "Lower Third", description: "Name and role banner", template: "lower-third", label: "Alex Morgan", secondary: "Creative Director" }),
	preset({ id: "lower-third-news", name: "News Lower Third", description: "Broadcast-style lower third", template: "lower-third", label: "Breaking Update", secondary: "Live from studio", accent: "#ef4444" }),
	preset({ id: "counter-big", name: "Counter", description: "Large animated number", template: "counter", label: "Downloads", count: 128 }),
	preset({ id: "badge-new", name: "Badge", description: "Compact label badge", template: "badge", label: "NEW", accent: "#38bdf8" }),
	preset({ id: "callout-tip", name: "Callout", description: "Highlighted callout panel", template: "callout", label: "Pro Tip", secondary: "Keep it short", accent: "#f59e0b" }),
	preset({ id: "glass-panel", name: "Panel", description: "Editable info panel", template: "panel", label: "Key Detail", secondary: "Supports flexible text" }),
	preset({ id: "chart-bars", name: "Bar Chart", description: "Chart-style motion graphic", template: "chart-bars", label: "Growth", accent: "#22d3ee" }),
	preset({ id: "line-chart", name: "Line Chart", description: "Trend line motion graphic", template: "line-chart", label: "Trend", accent: "#84cc16" }),
	preset({ id: "loading-ring", name: "Loading Ring", description: "Circular progress spinner", template: "loading-ring", label: "Processing", progress: 75 }),
	preset({ id: "notification", name: "Notification", description: "App notification card", template: "notification", label: "New message", secondary: "Just now", accent: "#60a5fa" }),
	preset({ id: "price-tag", name: "Price Tag", description: "Sale and pricing label", template: "price-tag", label: "$19", secondary: "Limited offer", accent: "#f97316" }),
	preset({ id: "app-window", name: "App Window", description: "Software window overlay", template: "app-window", label: "Dashboard", secondary: "Live preview" }),
	preset({ id: "timeline-stepper", name: "Stepper", description: "Timeline step indicator", template: "timeline-stepper", label: "Step 3", secondary: "Review", progress: 60 }),
	preset({ id: "split-title", name: "Split Title", description: "Motion title block", template: "split-title", label: "Before", secondary: "After", accent: "#c084fc" }),
	preset({ id: "social-card", name: "Social Card", description: "Post-style information card", template: "social-card", label: "@opencut", secondary: "New edit is live" }),
	preset({ id: "stats-grid", name: "Stats Grid", description: "Grid of metric cards", template: "stats-grid", label: "Metrics", secondary: "+24% this week", count: 24 }),
	preset({ id: "countdown", name: "Countdown", description: "Circular countdown graphic", template: "countdown", label: "Starting", secondary: "00:10", progress: 88 }),
	preset({ id: "toggle-switch", name: "Toggle", description: "Animated toggle switch", template: "toggle-switch", label: "Enabled", secondary: "Auto mode", progress: 100 }),
	preset({ id: "rating-stars", name: "Rating", description: "Star rating graphic", template: "rating-stars", label: "Rating", secondary: "4 out of 5", count: 4, accent: "#facc15" }),
	preset({ id: "leaderboard", name: "Leaderboard", description: "Ranked list card", template: "leaderboard", label: "Leaderboard", secondary: "Top creators", items: "Ari\nNoa\nMika\nLee" }),
	preset({ id: "tooltip", name: "Tooltip", description: "Pointer tooltip label", template: "tooltip", label: "Drag to adjust", secondary: "Value: 64" }),
	preset({ id: "carousel-dots", name: "Carousel Dots", description: "Slide indicator dots", template: "carousel-dots", label: "Slide 3", secondary: "Gallery" }),
];
