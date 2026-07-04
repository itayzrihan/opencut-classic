/**
 * In-app AI skills, distilled from the HyperFrames skill set
 * (https://github.com/heygen-com/hyperframes) and adapted to OpenCut's
 * hyperframe HTML elements. The agent lists them cheaply and loads full
 * instructions on demand through the skills.list / skills.load tools.
 */

export interface AiSkill {
	name: string;
	description: string;
	content: string;
}

export const AI_SKILLS: AiSkill[] = [
	{
		name: "hyperframe-authoring",
		description:
			"REQUIRED reading before any insert_html_element operation. The OpenCut hyperframe contract: deterministic, self-contained HTML+CSS rendered as video frames with seekable CSS animations.",
		content: [
			"# Hyperframe authoring contract",
			"",
			"A hyperframe is a self-contained HTML+CSS fragment rendered deterministically as video frames inside OpenCut. It follows the HyperFrames CSS-adapter model: every CSS animation is paused and seeked to the frame time, so the same timeline time always produces the same pixels.",
			"",
			"## Hard rules (violations render wrong or blank)",
			"- Self-contained only: inline `<style>` plus markup. No `<script>` (never executes), no external URLs (fonts, images, CSS are not loaded during rasterization). Use system fonts (Arial, Georgia, 'Segoe UI', monospace) and inline SVG or CSS gradients for imagery.",
			"- Motion must be CSS `@keyframes` animations. CSS transitions, hover states, and JS-driven motion never play.",
			"- Never author `animation-delay` directly - the renderer overrides it to seek. Express stagger/offsets with the custom property `--hf-delay` instead, e.g. `style=\"--hf-delay: 0.4s\"` or `animation-delay: calc(...)` replaced by `--hf-delay: calc(var(--i) * 120ms)`.",
			"- `animation-fill-mode` is forced to `both`; design keyframes so the 0% state is the correct pre-entrance state and 100% the correct resting state.",
			"- Use finite `animation-iteration-count` that covers the element duration (e.g. a 1.2s pulse on a 6s clip needs 5 iterations). `infinite` is acceptable but prefer finite counts.",
			"- The fragment is rendered into a fixed box of `sourceWidth` x `sourceHeight` pixels (default 1920x1080) then contain-fitted to the canvas. Give the outermost element `width:100%;height:100%` (or absolute inset 0) and design at that resolution.",
			"- Keep the background transparent unless the frame is meant to be a full-screen card; transparent regions composite over the video underneath, which is how overlays, lower-thirds, and titles work.",
			"",
			"## Time variables available on the root",
			"- `--hf-t`: current local time in seconds (number).",
			"- `--hf-progress`: 0..1 progress through the element.",
			"- `--hf-duration`: element duration in seconds.",
			"These are plain numbers usable in `calc()` for advanced effects; most compositions only need keyframes plus `--hf-delay`.",
			"",
			"## Canonical skeleton",
			"```html",
			'<style>',
			"  .hf-root { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif; }",
			"  .title { font-size: 96px; font-weight: 800; color: #fff; text-shadow: 0 4px 32px rgba(0,0,0,.45); animation: rise 900ms cubic-bezier(.2,.7,.2,1); }",
			"  @keyframes rise { from { opacity: 0; transform: translateY(60px) scale(.96); } to { opacity: 1; transform: none; } }",
			"</style>",
			'<div class="hf-root">',
			'  <div class="title">Launch day.</div>',
			"</div>",
			"```",
			"",
			"## Stagger pattern (the only sanctioned delay mechanism)",
			"```html",
			"<style>",
			"  .word { display: inline-block; animation: pop 600ms cubic-bezier(.2,.7,.2,1); }",
			"  @keyframes pop { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }",
			"</style>",
			'<div class="hf-root">',
			'  <span class="word">Ship</span>',
			'  <span class="word" style="--hf-delay:.15s">it</span>',
			'  <span class="word" style="--hf-delay:.3s">today</span>',
			"</div>",
			"```",
			"",
			"## Exit animations",
			"Time exits from the end using the known clip duration: an element on a 5s clip exits with `--hf-delay: 4.4s` on a 600ms exit animation. When an element needs both entrance and exit, use one keyframes block with intermediate percentages (e.g. enter by 15%, hold, leave from 85%) and `animation-duration` equal to the clip duration.",
			"",
			"## Sizing guidance",
			"- Full-screen card / scene: sourceWidth 1920, sourceHeight 1080 (or match project canvas).",
			"- Lower-third / caption bar: still author at 1920x1080 with transparent background and position content in the lower area; this keeps the element full-frame so positioning is predictable.",
			"- Square badge / sticker: sourceWidth = sourceHeight (e.g. 800x800), then scale/position with the element's transform params.",
		].join("\n"),
	},
	{
		name: "motion-graphics",
		description:
			"HyperFrames motion-graphics recipes adapted to hyperframe elements: kinetic typography, stat hits, logo stings, lower-thirds, chart bars, badges.",
		content: [
			"# Motion graphics recipes (hyperframe)",
			"",
			"All recipes obey the hyperframe-authoring contract (read it first). Typical duration 2-8s; motion is the message.",
			"",
			"## Kinetic type hit",
			"Big word slams in, small supporting line follows. Scale from 1.6 -> 1 with opacity, overshoot ease `cubic-bezier(.16,1.1,.3,1)`. Support line uses `--hf-delay:.25s` translateY rise.",
			"",
			"## Stat / number hit",
			"Chromium supports animating registered custom properties:",
			"```html",
			"<style>",
			"  @property --n { syntax: '<integer>'; initial-value: 0; inherits: false; }",
			"  .stat { font-size: 160px; font-weight: 900; color: #fff; animation: count 1.6s ease-out; counter-reset: n var(--n); }",
			"  .stat::after { content: counter(n) '%'; }",
			"  @keyframes count { from { --n: 0; } to { --n: 87; } }",
			"</style>",
			'<div class="hf-root"><div class="stat"></div></div>',
			"```",
			"Pair with a caption line staggered by `--hf-delay`.",
			"",
			"## Lower-third",
			"Transparent full-frame; bar anchored bottom-left. Bar wipes in with `transform: scaleX` from 0 (transform-origin left), name/title text rises with staggered `--hf-delay`. Keep within the lower 25% of frame, inset 64px.",
			"",
			"## Logo sting (text-based)",
			"Letters of the wordmark pop in with per-letter `--hf-delay` (60-90ms steps), then a ring or underline draws via `stroke-dashoffset` keyframes on inline SVG.",
			"",
			"## Bar chart hit",
			"3-5 bars as flex children, each `transform: scaleY` from 0 (transform-origin bottom) with 120ms stagger; value labels fade in after with `--hf-delay`.",
			"",
			"## Pulse / attention ring",
			"Finite pulse: `@keyframes pulse { from { opacity:.9; transform:scale(.8);} to { opacity:0; transform:scale(1.25);} }` with `animation-iteration-count: 3` and 1.2s duration.",
			"",
			"## Scene transitions between hyperframes",
			"For scene-to-scene motion prefer OpenCut's built-in `apply_transition` operation on the clips; use in-frame exit keyframes only when the design demands a custom wipe.",
		].join("\n"),
	},
	{
		name: "text-effects",
		description:
			"Special text treatments: gradient fills, outlines, glow, typewriter, per-word and per-letter reveals - both as hyperframe HTML and as native OpenCut text operations.",
		content: [
			"# Special text effects",
			"",
			"## Prefer native text when possible",
			"Plain styled text (font, size, color, background box, position) should be `insert_text_element` / `update_element` so the user can edit it later. Reach for a hyperframe when the request needs treatments native text cannot do.",
			"",
			"## Hyperframe text treatments (obey hyperframe-authoring)",
			"- Gradient text: `background: linear-gradient(...); -webkit-background-clip: text; background-clip: text; color: transparent;`",
			"- Outline text: `-webkit-text-stroke: 3px #fff; color: transparent;` (or layered text-shadow ring for softer stroke).",
			"- Neon glow: layered `text-shadow: 0 0 8px c, 0 0 24px c, 0 0 64px c;` and animate opacity 0.85->1 for a finite flicker (steps easing, 4-6 iterations).",
			"- Typewriter: fixed-width font, `overflow:hidden; white-space:nowrap;` animate `width` 0 -> 100% wait - width is layout; instead animate `clip-path: inset(0 100% 0 0)` to `inset(0 0 0 0)` with `steps(<chars>)`.",
			"- Per-word / per-letter reveal: wrap each unit in a span with incremental `--hf-delay` (words 120-180ms, letters 40-70ms).",
			"- Highlight sweep: a skewed gradient bar behind text animated with `transform: translateX(-120%) -> 120%`.",
			"",
			"## Native OpenCut text params (update_element patch.params)",
			"content, fontSize, fontFamily, color, textAlign, fontWeight, fontStyle, textDecoration, letterSpacing, lineHeight, background.enabled/color/cornerRadius/paddingX/paddingY, transform.positionX/Y, transform.scaleX/Y, transform.rotate, opacity.",
			"Keyframable paths (upsert_keyframe): opacity, transform.*, color, background.color - use these for simple fades/slides on native text.",
		].join("\n"),
	},
	{
		name: "video-workflows",
		description:
			"HyperFrames workflow playbooks adapted to OpenCut edit plans: explainers, promos, montages, talking-head packaging, caption passes, music-paced cuts.",
		content: [
			"# Video workflow playbooks",
			"",
			"Adapted from the HyperFrames creation workflows (product-launch-video, faceless-explainer, talking-head-recut, motion-graphics, music-to-video). Express each beat with timeline operations; use hyperframe elements for designed visuals.",
			"",
			"## Faceless explainer / promo structure",
			"1. Hook card (hyperframe kinetic type, 2-3s).",
			"2. 3-5 content beats: media clips trimmed to 3-6s each, each with a supporting overlay (native text or hyperframe lower-third).",
			"3. Stat or proof beat (hyperframe stat hit).",
			"4. CTA card (hyperframe, 3s).",
			"Apply `apply_transition` (fade / slide / zoom presets) on beat boundaries; keep one visual idea per beat.",
			"",
			"## Talking-head packaging",
			"Keep footage untouched on the main track. Add overlay beats synced to the speech: title card at start, lower-third at first appearance, pull-quote or data callout at key moments, end card. Use transparent hyperframes on an overlay track above the footage.",
			"",
			"## Montage / recut",
			"Use split_element at beat times, delete_element for rejected segments, move_element to reorder, then trim_element to tighten. Confirm gaps are intentional; elements on the same track must not overlap.",
			"",
			"## Caption pass",
			"For spoken-word captions prefer the app's caption tracks (visible in context as caption tracks). For stylized burned-in captions on short clips, per-phrase hyperframe elements timed to the transcript work well.",
			"",
			"## Pacing rules of thumb",
			"- Cut every 2-6s for promo energy; 6-12s for explanatory calm.",
			"- Entrances 300-900ms; exits slightly faster than entrances.",
			"- Reserve the last 10-15% of the piece for the CTA/outro.",
		].join("\n"),
	},
];

export function listAiSkills(): Array<Pick<AiSkill, "name" | "description">> {
	return AI_SKILLS.map(({ name, description }) => ({ name, description }));
}

export function loadAiSkill({ name }: { name: string }): AiSkill | null {
	const normalized = name.trim().toLowerCase().replace(/^\//, "");
	return AI_SKILLS.find((skill) => skill.name === normalized) ?? null;
}
