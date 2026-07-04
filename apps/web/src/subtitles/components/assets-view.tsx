import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useEffect, useReducer, useRef, useState } from "react";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionResult,
} from "@/transcription/types";
import {
	DEFAULT_CAPTION_LAYOUT,
	buildCaptionChunksFromSegments,
	buildCaptionChunksFromWords,
	buildSubtitleCuesFromWords,
	normalizeCaptionLayoutSettings,
	splitCaptionCuesByLayer,
	type CaptionLayoutSettings,
} from "@/subtitles/caption-layout";
import {
	buildCaptionTextTracks,
	insertCaptionChunksAsTextTrack,
} from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { AlertCircleIcon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { DiagnosticSeverity } from "@/diagnostics/types";
import { TracksSnapshotCommand } from "@/commands";
import type { SceneTracks, TextElement, TextTrack } from "@/timeline";
import type { TextCaptionRevealMode, TextWordTransitionIn } from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement";
import { generateUUID } from "@/utils/id";
import { mediaTimeToSeconds } from "@/wasm";
import { z } from "zod";
import {
	CAPTION_ACCENT_COLORS,
	CAPTION_WORD_ANIMATIONS,
} from "@/text/caption-presets";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

const CAPTION_LAYER_COUNT = 2;
const TIMING_EPSILON_SECONDS = 0.002;
const CAPTION_LAST_SETTINGS_STORAGE_KEY = "opencut.caption.lastSettings";
const CAPTION_SAVED_PRESETS_STORAGE_KEY = "opencut.caption.savedPresets";

interface SavedCaptionPreset {
	id: string;
	name: string;
	settings: CaptionLayoutSettings;
}
const CAPTION_REVEAL_MODES: Array<{
	value: TextCaptionRevealMode;
	label: string;
}> = [
	{ value: "determined-by-preset", label: "Determined by preset" },
	{ value: "row", label: "Whole row together" },
	{ value: "spoken-word", label: "Show word when spoken" },
	{ value: "spoken-word-keep", label: "Show word and keep previous" },
	{ value: "emphasize-spoken", label: "Emphasize spoken word" },
	{ value: "emphasize-spoken-keep", label: "Keep words emphasized" },
	{ value: "growing-row", label: "Growing row" },
];
const CAPTION_TRANSITION_IN_OPTIONS: Array<{
	value: TextWordTransitionIn;
	label: string;
}> = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "blur", label: "Blur build" },
	{ value: "zoom", label: "Zoom" },
	{ value: "blur-zoom", label: "Blur zoom" },
	{ value: "rise", label: "Rise" },
	{ value: "slide", label: "Slide" },
	{ value: "typewriter", label: "Type letter by letter" },
	{ value: "glow-dissolve", label: "Glow blur dissolve" },
];

function usesTransitionIn(revealMode: TextCaptionRevealMode): boolean {
	return revealMode === "spoken-word" || revealMode === "spoken-word-keep";
}

function hasSameCaptionSource({
	track,
	source,
}: {
	track: TextTrack;
	source: NonNullable<TextTrack["captionSource"]>;
}) {
	const candidate = track.captionSource;
	if (!candidate) return false;
	if (candidate.words.length !== source.words.length) return false;
	const firstCandidate = candidate.words[0];
	const firstSource = source.words[0];
	const lastCandidate = candidate.words[candidate.words.length - 1];
	const lastSource = source.words[source.words.length - 1];
	return (
		firstCandidate?.text === firstSource?.text &&
		firstCandidate?.start === firstSource?.start &&
		lastCandidate?.text === lastSource?.text &&
		lastCandidate?.end === lastSource?.end
	);
}

function textElementContent(element: TextElement) {
	return typeof element.params.content === "string" ? element.params.content : "";
}

function isPristineGeneratedCaption({
	element,
	expected,
}: {
	element: TextElement;
	expected: { text: string; startTime: number; duration: number } | undefined;
}) {
	if (!expected) return false;
	return (
		textElementContent(element) === expected.text &&
		Math.abs(mediaTimeToSeconds({ time: element.startTime }) - expected.startTime) <=
			TIMING_EPSILON_SECONDS &&
		Math.abs(mediaTimeToSeconds({ time: element.duration }) - expected.duration) <=
			TIMING_EPSILON_SECONDS &&
		mediaTimeToSeconds({ time: element.trimStart }) === 0 &&
		mediaTimeToSeconds({ time: element.trimEnd }) === 0
	);
}

function buildEditedCaptionTracks({
	sourceTracks,
}: {
	sourceTracks: TextTrack[];
}) {
	return sourceTracks.flatMap((track) => {
		const source = track.captionSource;
		if (!source) return [];

		const previousCaptions = buildSubtitleCuesFromWords({
			words: source.words,
			settings: source.settings,
		});
		const previousLayers = splitCaptionCuesByLayer({
			captions: previousCaptions,
			layerCount: source.layerCount ?? 1,
		});
		const expectedLayer = previousLayers[source.layerIndex ?? 0] ?? [];
		const editedElements = track.elements.filter(
			(element, index) =>
				!isPristineGeneratedCaption({
					element,
					expected: expectedLayer[index],
				}),
		);

		if (editedElements.length === 0) return [];

		return [{
			...buildEmptyTrack({
				id: generateUUID(),
				type: "text",
				name: `Edited ${track.name}`,
			}),
			hidden: track.hidden,
			elements: editedElements,
		}];
	});
}

function rebuildCaptionTracksWithSettings({
	tracks,
	settings,
	canvasSize,
}: {
	tracks: SceneTracks;
	settings: CaptionLayoutSettings;
	canvasSize: { width: number; height: number };
}) {
	const firstSourceTrack = tracks.overlay.find(
		(track): track is TextTrack => track.type === "text" && !!track.captionSource,
	);
	const source = firstSourceTrack?.captionSource;
	if (!source) return null;

	const sourceTracks = tracks.overlay.filter(
		(track): track is TextTrack =>
			track.type === "text" && hasSameCaptionSource({ track, source }),
	);
	const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
	const editedTracks = buildEditedCaptionTracks({ sourceTracks });
	const captions = buildSubtitleCuesFromWords({
		words: source.words,
		settings,
	});
	const regeneratedTracks = buildCaptionTextTracks({
		captions,
		captionSource: {
			...source,
			settings,
		},
		layerCount: CAPTION_LAYER_COUNT,
		canvasSize,
	});
	const replacementTracks = regeneratedTracks.map((track, index) => {
		const previousTrack = sourceTracks[index];
		if (!previousTrack) return track;
		return {
			...track,
			id: previousTrack.id,
			name: previousTrack.name,
			hidden: previousTrack.hidden,
			captionSource: track.captionSource
				? {
						...track.captionSource,
						layerIndex: previousTrack.captionSource?.layerIndex ?? index,
						layerCount:
							previousTrack.captionSource?.layerCount ??
							track.captionSource.layerCount,
					}
				: undefined,
		};
	});
	let replacementIndex = 0;
	let insertedExtraTracks = false;

	return {
		...tracks,
		overlay: tracks.overlay.flatMap((track) => {
			if (!sourceTrackIds.has(track.id)) {
				return [track];
			}
			const replacement = replacementTracks[replacementIndex++];
			const extras =
				!insertedExtraTracks && replacementIndex === sourceTracks.length
					? [
							...replacementTracks.slice(sourceTracks.length),
							...editedTracks,
						]
					: [];
			insertedExtraTracks = insertedExtraTracks || extras.length > 0;
			return replacement ? [replacement, ...extras] : extras;
		}),
	};
}

const transcriptionResultSchema = z.object({
	text: z.string(),
	segments: z.array(
		z.object({
			text: z.string(),
			start: z.number(),
			end: z.number(),
		}),
	),
	words: z
		.array(
			z.object({
				text: z.string(),
				start: z.number(),
				end: z.number(),
			}),
		)
		.optional(),
	language: z.string(),
});

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

function loadLastCaptionSettings(): CaptionLayoutSettings {
	if (typeof window === "undefined") {
		return { ...DEFAULT_CAPTION_LAYOUT };
	}
	try {
		const raw = window.localStorage.getItem(CAPTION_LAST_SETTINGS_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_CAPTION_LAYOUT };
		return normalizeCaptionLayoutSettings({ settings: JSON.parse(raw) });
	} catch {
		return { ...DEFAULT_CAPTION_LAYOUT };
	}
}

function saveLastCaptionSettings({
	settings,
}: {
	settings: CaptionLayoutSettings;
}) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		CAPTION_LAST_SETTINGS_STORAGE_KEY,
		JSON.stringify(settings),
	);
}

function loadSavedCaptionPresets(): SavedCaptionPreset[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(CAPTION_SAVED_PRESETS_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((item) => (
				item &&
				typeof item.id === "string" &&
				typeof item.name === "string" &&
				item.settings
			))
			.map((item) => ({
				id: item.id,
				name: item.name,
				settings: normalizeCaptionLayoutSettings({ settings: item.settings }),
			}));
	} catch {
		return [];
	}
}

function saveSavedCaptionPresets({
	presets,
}: {
	presets: SavedCaptionPreset[];
}) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		CAPTION_SAVED_PRESETS_STORAGE_KEY,
		JSON.stringify(presets),
	);
}

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("he");
	const [captionSettings, setCaptionSettings] = useState<CaptionLayoutSettings>(() =>
		loadLastCaptionSettings(),
	);
	const [savedPresets, setSavedPresets] = useState<SavedCaptionPreset[]>(() =>
		loadSavedCaptionPresets(),
	);
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);
	const hasGeneratedCaptions = useEditor((e) =>
		e.scenes
			.getActiveSceneOrNull()
			?.tracks.overlay.some(
				(track) => track.type === "text" && !!track.captionSource,
			) ?? false,
	);

	useEffect(() => {
		saveLastCaptionSettings({ settings: captionSettings });
	}, [captionSettings]);

	const insertCaptions = ({
		captions,
		captionSource,
	}: {
		captions: CaptionChunk[];
		captionSource?: Parameters<
			typeof insertCaptionChunksAsTextTrack
		>[0]["captionSource"];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({
			editor,
			captions,
			captionSource,
			layerCount: captionSource ? CAPTION_LAYER_COUNT : 1,
		});
		return trackId.length > 0;
	};

	const updateCaptionSetting = ({
		key,
		value,
	}: {
		key: keyof CaptionLayoutSettings;
		value: string;
	}) => {
		setCaptionSettings((current) =>
			normalizeCaptionLayoutSettings({
				settings: {
					...current,
					[key]:
						key === "revealMode" ||
						key === "transitionIn" ||
						key === "wordAnimationId" ||
						key === "accentColor" ||
						key === "wordDirection"
							? value
							: Number(value),
				},
			}),
		);
	};

	const saveCurrentPreset = () => {
		const name = window.prompt("Preset name");
		const trimmedName = name?.trim();
		if (!trimmedName) return;
		const nextPreset: SavedCaptionPreset = {
			id: generateUUID(),
			name: trimmedName,
			settings: normalizeCaptionLayoutSettings({ settings: captionSettings }),
		};
		setSavedPresets((current) => {
			const next = [...current, nextPreset];
			saveSavedCaptionPresets({ presets: next });
			return next;
		});
	};

	const loadPreset = ({ presetId }: { presetId: string }) => {
		const preset = savedPresets.find((item) => item.id === presetId);
		if (!preset) return;
		setCaptionSettings(normalizeCaptionLayoutSettings({ settings: preset.settings }));
	};

	const renamePreset = ({ presetId }: { presetId: string }) => {
		const preset = savedPresets.find((item) => item.id === presetId);
		if (!preset) return;
		const nextName = window.prompt("Preset name", preset.name);
		const trimmedName = nextName?.trim();
		if (!trimmedName) return;
		setSavedPresets((current) => {
			const next = current.map((item) =>
				item.id === presetId ? { ...item, name: trimmedName } : item,
			);
			saveSavedCaptionPresets({ presets: next });
			return next;
		});
	};

	const applyCaptionSettings = () => {
		const activeScene = editor.scenes.getActiveSceneOrNull();
		if (!activeScene) return;
		const settings = normalizeCaptionLayoutSettings({
			settings: captionSettings,
		});
		const after = rebuildCaptionTracksWithSettings({
			tracks: activeScene.tracks,
			settings,
			canvasSize: editor.project.getActive().settings.canvasSize,
		});
		if (!after) return;
		editor.command.execute({
			command: new TracksSnapshotCommand({
				before: activeScene.tracks,
				after,
			}),
		});
		setCaptionSettings(settings);
	};

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: "Extracting audio..." });
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			dispatch({ type: "update_step", step: "Transcribing locally..." });
			const formData = new FormData();
			formData.append("audio", audioBlob, "timeline.webm");
			formData.append(
				"language",
				selectedLanguage === "auto" ? "he" : selectedLanguage,
			);

			const response = await fetch("/api/transcription/whisper-cpp", {
				method: "POST",
				body: formData,
			});
			if (!response.ok) {
				const error = await response.json().catch(() => null);
				throw new Error(error?.error || `Transcription failed: ${response.status}`);
			}
			const result: TranscriptionResult = transcriptionResultSchema.parse(
				await response.json(),
			);

			dispatch({ type: "update_step", step: "Generating captions..." });
			const captionChunks = result.words?.length
				? buildCaptionChunksFromWords({
						words: result.words,
						settings: captionSettings,
					})
				: buildCaptionChunksFromSegments({
						segments: result.segments,
						settings: captionSettings,
					});

			if (
				!insertCaptions({
					captions: captionChunks,
					captionSource: result.words?.length
						? { words: result.words, settings: captionSettings }
						: undefined,
				})
			) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			dispatch({ type: "succeed", warnings: [] });
		} catch (error) {
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: "Reading subtitle file..." });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatch({ type: "update_step", step: "Importing subtitles..." });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title="Captions"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="Language">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a language" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto detect</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label="Words per row">
							<Input
								type="number"
								min={1}
								max={12}
								size="sm"
								value={captionSettings.wordsPerRow}
								onChange={(event) =>
									updateCaptionSetting({
										key: "wordsPerRow",
										value: event.target.value,
									})
								}
							/>
						</SectionField>
						<SectionField label="Rows">
							<Input
								type="number"
								min={1}
								max={4}
								size="sm"
								value={captionSettings.rows}
								onChange={(event) =>
									updateCaptionSetting({
										key: "rows",
										value: event.target.value,
									})
								}
							/>
						</SectionField>
						<SectionField label="In padding %">
							<Input
								type="number"
								min={0}
								max={100}
								step={1}
								size="sm"
								value={captionSettings.inPaddingPercent}
								onChange={(event) =>
									updateCaptionSetting({
										key: "inPaddingPercent",
										value: event.target.value,
									})
								}
							/>
						</SectionField>
						<SectionField label="Out padding %">
							<Input
								type="number"
								min={0}
								max={100}
								step={1}
								size="sm"
								value={captionSettings.outPaddingPercent}
								onChange={(event) =>
									updateCaptionSetting({
										key: "outPaddingPercent",
										value: event.target.value,
									})
								}
							/>
						</SectionField>
						<SectionField label="Timing">
							<Select
								value={captionSettings.revealMode}
								onValueChange={(value) =>
									updateCaptionSetting({
										key: "revealMode",
										value,
									})
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_REVEAL_MODES.map((mode) => (
										<SelectItem key={mode.value} value={mode.value}>
											{mode.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						{usesTransitionIn(captionSettings.revealMode) && (
							<SectionField label="Transition in">
								<Select
									value={captionSettings.transitionIn}
									onValueChange={(value) =>
										updateCaptionSetting({
											key: "transitionIn",
											value,
										})
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{CAPTION_TRANSITION_IN_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</SectionField>
						)}
						{savedPresets.length > 0 && (
							<SectionField label="Saved presets">
								<div className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto pb-1">
									{savedPresets.map((preset) => (
										<ContextMenu key={preset.id}>
											<ContextMenuTrigger asChild>
												<button
													type="button"
													className="bg-accent hover:bg-accent/80 focus-visible:ring-ring flex size-16 shrink-0 items-center justify-center rounded-md border px-1 text-center text-[0.68rem] leading-tight outline-none focus-visible:ring-2"
													title={preset.name}
													onClick={() => loadPreset({ presetId: preset.id })}
												>
													<span className="line-clamp-3 break-words">
														{preset.name}
													</span>
												</button>
											</ContextMenuTrigger>
											<ContextMenuContent>
												<ContextMenuItem
													onSelect={() => renamePreset({ presetId: preset.id })}
												>
													Rename
												</ContextMenuItem>
											</ContextMenuContent>
										</ContextMenu>
									))}
								</div>
							</SectionField>
						)}
						<SectionField label="Word animation">
							<Select
								value={captionSettings.wordAnimationId}
								onValueChange={(value) =>
									updateCaptionSetting({
										key: "wordAnimationId",
										value,
									})
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_ANIMATIONS.map((animation) => (
										<SelectItem key={animation.id} value={animation.id}>
											{animation.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label="Accent">
							<Select
								value={captionSettings.accentColor}
								onValueChange={(value) =>
									updateCaptionSetting({
										key: "accentColor",
										value,
									})
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_ACCENT_COLORS.map((color) => (
										<SelectItem key={color.value} value={color.value}>
											{color.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label="Direction">
							<Select
								value={captionSettings.wordDirection}
								onValueChange={(value) =>
									updateCaptionSetting({
										key: "wordDirection",
										value,
									})
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto</SelectItem>
									<SelectItem value="rtl">Right to left</SelectItem>
									<SelectItem value="ltr">Left to right</SelectItem>
								</SelectContent>
							</Select>
						</SectionField>
					</SectionFields>

					<Button
						type="button"
						variant="outline"
						className="w-full"
						onClick={saveCurrentPreset}
						disabled={isProcessing}
					>
						Save preset
					</Button>
					<Button
						type="button"
						variant="outline"
						className="w-full"
						onClick={applyCaptionSettings}
						disabled={isProcessing || !hasGeneratedCaptions}
					>
						Apply caption layout
					</Button>
					<Button
						type="button"
						className="mt-auto w-full"
						onClick={handleGenerateTranscript}
						disabled={isProcessing || activeDiagnostics.length > 0}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{isProcessing ? processing.step : "Generate transcript"}
					</Button>
					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
