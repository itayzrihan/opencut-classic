import type {
	TransitionPreset,
	TransitionProperty,
	TransitionRecipe,
	TransitionState,
} from "./types";

export const CONTROLLED_TRANSITION_PROPERTIES: TransitionProperty[] = [
	"opacity",
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
	"background.cornerRadius",
];

function preset({
	id,
	label,
	state,
	recipe,
	keywords = [],
}: {
	id: string;
	label: string;
	state: TransitionState;
	recipe?: TransitionRecipe;
	keywords?: string[];
}): TransitionPreset {
	return { id, label, state, recipe, keywords };
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
	preset({ id: "none", label: "None", state: {}, keywords: ["clear"] }),
	preset({ id: "fade", label: "Fade", state: { opacity: 0 }, keywords: ["opacity"] }),
	preset({ id: "slide-left", label: "Slide Left", state: { "transform.positionX": -120, opacity: 0 }, keywords: ["move"] }),
	preset({ id: "slide-right", label: "Slide Right", state: { "transform.positionX": 120, opacity: 0 }, keywords: ["move"] }),
	preset({ id: "slide-up", label: "Slide Up", state: { "transform.positionY": -120, opacity: 0 }, keywords: ["move"] }),
	preset({ id: "slide-down", label: "Slide Down", state: { "transform.positionY": 120, opacity: 0 }, keywords: ["move"] }),
	preset({ id: "push-left", label: "Push Left", state: { "transform.positionX": -240 }, keywords: ["push"] }),
	preset({ id: "push-right", label: "Push Right", state: { "transform.positionX": 240 }, keywords: ["push"] }),
	preset({ id: "push-up", label: "Push Up", state: { "transform.positionY": -240 }, keywords: ["push"] }),
	preset({ id: "push-down", label: "Push Down", state: { "transform.positionY": 240 }, keywords: ["push"] }),
	preset({ id: "zoom-in", label: "Zoom In", state: { "transform.scaleX": 0.25, "transform.scaleY": 0.25, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "zoom-out", label: "Zoom Out", state: { "transform.scaleX": 1.8, "transform.scaleY": 1.8, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "pop", label: "Pop", state: { "transform.scaleX": 0, "transform.scaleY": 0, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "shrink", label: "Shrink", state: { "transform.scaleX": 0.7, "transform.scaleY": 0.7, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "grow", label: "Grow", state: { "transform.scaleX": 1.35, "transform.scaleY": 1.35, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "flip-x", label: "Flip X", state: { "transform.scaleX": -1, opacity: 0 }, keywords: ["flip"] }),
	preset({ id: "flip-y", label: "Flip Y", state: { "transform.scaleY": -1, opacity: 0 }, keywords: ["flip"] }),
	preset({ id: "spin-left", label: "Spin Left", state: { "transform.rotate": -180, opacity: 0 }, keywords: ["rotate"] }),
	preset({ id: "spin-right", label: "Spin Right", state: { "transform.rotate": 180, opacity: 0 }, keywords: ["rotate"] }),
	preset({ id: "tilt-left", label: "Tilt Left", state: { "transform.rotate": -25, opacity: 0 }, keywords: ["rotate"] }),
	preset({ id: "tilt-right", label: "Tilt Right", state: { "transform.rotate": 25, opacity: 0 }, keywords: ["rotate"] }),
	preset({ id: "rise-soft", label: "Rise Soft", state: { "transform.positionY": 45, opacity: 0 }, keywords: ["soft"] }),
	preset({ id: "drop-soft", label: "Drop Soft", state: { "transform.positionY": -45, opacity: 0 }, keywords: ["soft"] }),
	preset({ id: "drift-left", label: "Drift Left", state: { "transform.positionX": 45, opacity: 0 }, keywords: ["soft"] }),
	preset({ id: "drift-right", label: "Drift Right", state: { "transform.positionX": -45, opacity: 0 }, keywords: ["soft"] }),
	preset({ id: "corner-tl", label: "Corner Top Left", state: { "transform.positionX": -160, "transform.positionY": -90, opacity: 0 }, keywords: ["corner"] }),
	preset({ id: "corner-tr", label: "Corner Top Right", state: { "transform.positionX": 160, "transform.positionY": -90, opacity: 0 }, keywords: ["corner"] }),
	preset({ id: "corner-bl", label: "Corner Bottom Left", state: { "transform.positionX": -160, "transform.positionY": 90, opacity: 0 }, keywords: ["corner"] }),
	preset({ id: "corner-br", label: "Corner Bottom Right", state: { "transform.positionX": 160, "transform.positionY": 90, opacity: 0 }, keywords: ["corner"] }),
	preset({ id: "squash", label: "Squash", state: { "transform.scaleX": 1.6, "transform.scaleY": 0.25, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "stretch", label: "Stretch", state: { "transform.scaleX": 0.35, "transform.scaleY": 1.6, opacity: 0 }, keywords: ["scale"] }),
	preset({ id: "wipe-left", label: "Wipe Left", state: { "transform.scaleX": 0.05, "transform.positionX": -80, opacity: 0 }, keywords: ["wipe"] }),
	preset({ id: "wipe-right", label: "Wipe Right", state: { "transform.scaleX": 0.05, "transform.positionX": 80, opacity: 0 }, keywords: ["wipe"] }),
	preset({ id: "wipe-up", label: "Wipe Up", state: { "transform.scaleY": 0.05, "transform.positionY": -60, opacity: 0 }, keywords: ["wipe"] }),
	preset({ id: "wipe-down", label: "Wipe Down", state: { "transform.scaleY": 0.05, "transform.positionY": 60, opacity: 0 }, keywords: ["wipe"] }),
	preset({ id: "float-spin", label: "Float Spin", state: { "transform.positionY": 80, "transform.rotate": -90, opacity: 0 }, keywords: ["rotate"] }),
	preset({ id: "snap-spin", label: "Snap Spin", state: { "transform.scaleX": 0.4, "transform.scaleY": 0.4, "transform.rotate": 90, opacity: 0 }, keywords: ["rotate"] }),
	preset({
		id: "glitch",
		label: "Glitch",
		state: {},
		keywords: ["glitch", "strobe"],
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.08, value: 1 }, { at: 0.16, value: 0.15 }, { at: 0.24, value: 1 }, { at: 0.36, value: 0.45 }, { at: 0.48, value: 1 }, { at: 1, value: 1 }],
			"transform.positionX": [{ at: 0, value: -70 }, { at: 0.12, value: 55 }, { at: 0.2, value: -35 }, { at: 0.34, value: 22 }, { at: 0.52, value: -8 }, { at: 1, value: 0 }],
			"transform.positionY": [{ at: 0, value: 14 }, { at: 0.18, value: -10 }, { at: 0.34, value: 8 }, { at: 1, value: 0 }],
		},
	}),
	preset({
		id: "elastic-drop",
		label: "Elastic Drop",
		state: {},
		keywords: ["bounce"],
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.18, value: 1 }, { at: 1, value: 1 }],
			"transform.positionY": [{ at: 0, value: -220 }, { at: 0.38, value: 28 }, { at: 0.58, value: -16 }, { at: 0.78, value: 7 }, { at: 1, value: 0 }],
			"transform.scaleY": [{ at: 0, value: 1.35 }, { at: 0.38, value: 0.82 }, { at: 0.58, value: 1.08 }, { at: 1, value: 1 }],
		},
	}),
	preset({
		id: "rubber-band",
		label: "Rubber Band",
		state: {},
		keywords: ["bounce"],
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.1, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.2 }, { at: 0.28, value: 1.35 }, { at: 0.45, value: 0.75 }, { at: 0.65, value: 1.12 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 1.8 }, { at: 0.28, value: 0.72 }, { at: 0.45, value: 1.25 }, { at: 0.65, value: 0.92 }, { at: 1, value: 1 }],
		},
	}),
	preset({
		id: "portal",
		label: "Portal",
		state: {},
		keywords: ["spin", "scale"],
		recipe: {
			opacity: [{ at: 0, value: 0 }, { at: 0.26, value: 1 }, { at: 1, value: 1 }],
			"transform.scaleX": [{ at: 0, value: 0.05 }, { at: 0.42, value: 1.22 }, { at: 1, value: 1 }],
			"transform.scaleY": [{ at: 0, value: 1.9 }, { at: 0.42, value: 0.82 }, { at: 1, value: 1 }],
			"transform.rotate": [{ at: 0, value: 360 }, { at: 1, value: 0 }],
		},
	}),
];

export function getTransitionPreset({ id }: { id: string }): TransitionPreset {
	return (
		TRANSITION_PRESETS.find((transition) => transition.id === id) ??
		TRANSITION_PRESETS[0]
	);
}
