"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useEditor } from "@/editor/use-editor";
import type { MediaAsset } from "@/media/types";
import {
	runPodcastSync,
	type PodcastSyncChannel,
	type PodcastSyncSettings,
} from "@/podcast-sync/engine";
import { buildPodcastSyncScene } from "@/podcast-sync/scene";
import { cn } from "@/utils/ui";

interface ChannelDraft {
	id: string;
	name: string;
	videoAssetId: string;
	audioAssetId: string;
}

const NONE_VALUE = "none";

function baseName(name: string): string {
	const withoutExtension = name.replace(/\.[^.]+$/, "");
	return withoutExtension
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "");
}

function displayBaseName(name: string): string {
	return name.replace(/\.[^.]+$/, "");
}

function findMatchingAudio({
	video,
	audioAssets,
	usedAudioIds,
}: {
	video: MediaAsset;
	audioAssets: MediaAsset[];
	usedAudioIds: Set<string>;
}): MediaAsset | null {
	const videoBase = baseName(video.name);
	const exact = audioAssets.find(
		(asset) =>
			!usedAudioIds.has(asset.id) && baseName(asset.name) === videoBase,
	);
	if (exact) return exact;

	const partial = audioAssets.find((asset) => {
		if (usedAudioIds.has(asset.id)) return false;
		const audioBase = baseName(asset.name);
		return audioBase.includes(videoBase) || videoBase.includes(audioBase);
	});
	if (partial) return partial;

	return audioAssets.find((asset) => !usedAudioIds.has(asset.id)) ?? null;
}

function buildInitialDrafts({
	videoAssets,
	audioAssets,
	count,
}: {
	videoAssets: MediaAsset[];
	audioAssets: MediaAsset[];
	count: number;
}): ChannelDraft[] {
	const usedAudioIds = new Set<string>();
	return Array.from({ length: count }, (_, index) => {
		const video = videoAssets[index] ?? videoAssets[0];
		const audio = video
			? findMatchingAudio({ video, audioAssets, usedAudioIds })
			: null;
		if (audio) usedAudioIds.add(audio.id);
		return {
			id: `channel-${index + 1}`,
			name: video ? displayBaseName(video.name) : `Channel ${index + 1}`,
			videoAssetId: video?.id ?? NONE_VALUE,
			audioAssetId: audio?.id ?? NONE_VALUE,
		};
	});
}

function numericValue({
	value,
	fallback,
}: {
	value: number;
	fallback: number;
}): number {
	return Number.isFinite(value) ? value : fallback;
}

export function PodcastSyncDialog({
	open,
	onOpenChange,
	assets,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	assets: MediaAsset[];
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const videoAssets = useMemo(
		() => assets.filter((asset) => asset.type === "video"),
		[assets],
	);
	const audioAssets = useMemo(
		() =>
			assets.filter(
				(asset) =>
					asset.type === "audio" || (asset.type === "video" && asset.hasAudio),
			),
		[assets],
	);
	const [channels, setChannels] = useState<ChannelDraft[]>(() =>
		buildInitialDrafts({
			videoAssets,
			audioAssets,
			count: Math.max(1, videoAssets.length),
		}),
	);
	const [settings, setSettings] = useState<PodcastSyncSettings>(() => ({
		sequenceName:
			activeProject?.metadata.name != null
				? `${activeProject.metadata.name} Podcast Sync`
				: "Podcast Sync",
		minCutDuration: 1,
		maxCutDuration: 0,
		preRoll: 0.15,
		maxLagSeconds: 1200,
		antiBleed: true,
	}));
	const [isRunning, setIsRunning] = useState(false);
	const [progress, setProgress] = useState({ step: "", value: 0 });

	const assetById = useMemo(
		() => new Map(assets.map((asset) => [asset.id, asset])),
		[assets],
	);

	const setChannelCount = (nextCount: number) => {
		const count = Math.max(1, Math.min(12, Math.floor(nextCount)));
		setChannels((current) => {
			if (count === current.length) return current;
			if (count < current.length) return current.slice(0, count);
			const additions = buildInitialDrafts({
				videoAssets,
				audioAssets,
				count,
			}).slice(current.length);
			return [...current, ...additions];
		});
	};

	const updateChannel = ({
		channelId,
		patch,
	}: {
		channelId: string;
		patch: Partial<Omit<ChannelDraft, "id">>;
	}) => {
		setChannels((current) =>
			current.map((channel) =>
				channel.id === channelId ? { ...channel, ...patch } : channel,
			),
		);
	};

	const validateChannels = (): PodcastSyncChannel[] | null => {
		if (!activeProject) {
			toast.error("No active project");
			return null;
		}
		if (videoAssets.length === 0) {
			toast.error("Select at least one video");
			return null;
		}
		const resolved: PodcastSyncChannel[] = [];
		const usedVideoIds = new Set<string>();
		const usedAudioIds = new Set<string>();

		for (const draft of channels) {
			const video = assetById.get(draft.videoAssetId);
			const audio = assetById.get(draft.audioAssetId);
			if (!video || video.type !== "video") {
				toast.error(`${draft.name} needs a video`);
				return null;
			}
			if (!audio || (audio.type !== "audio" && audio.type !== "video")) {
				toast.error(`${draft.name} needs an audio source`);
				return null;
			}
			if (usedVideoIds.has(video.id)) {
				toast.error(`${video.name} is used by more than one channel`);
				return null;
			}
			if (usedAudioIds.has(audio.id)) {
				toast.error(`${audio.name} is used by more than one channel`);
				return null;
			}
			usedVideoIds.add(video.id);
			usedAudioIds.add(audio.id);
			resolved.push({
				id: draft.id,
				name: draft.name.trim() || displayBaseName(video.name),
				video,
				audio,
			});
		}

		return resolved;
	};

	const handleCreate = async () => {
		const resolvedChannels = validateChannels();
		if (!resolvedChannels || !activeProject) return;

		const safeSettings: PodcastSyncSettings = {
			sequenceName: settings.sequenceName.trim() || "Podcast Sync",
			minCutDuration: Math.max(
				0.1,
				numericValue({ value: settings.minCutDuration, fallback: 1 }),
			),
			maxCutDuration: Math.max(
				0,
				numericValue({ value: settings.maxCutDuration, fallback: 0 }),
			),
			preRoll: Math.max(
				0,
				numericValue({ value: settings.preRoll, fallback: 0.15 }),
			),
			maxLagSeconds: Math.max(
				1,
				numericValue({ value: settings.maxLagSeconds, fallback: 1200 }),
			),
			antiBleed: settings.antiBleed,
		};

		setIsRunning(true);
		setProgress({ step: "Starting", value: 0 });
		try {
			const result = await runPodcastSync({
				channels: resolvedChannels,
				settings: safeSettings,
				onProgress: ({ step, progress: value }) => setProgress({ step, value }),
			});
			const scene = buildPodcastSyncScene({
				name: safeSettings.sequenceName,
				channels: resolvedChannels,
				result,
			});
			editor.scenes.setScenes({
				scenes: [...editor.scenes.getScenes(), scene],
				activeSceneId: scene.id,
			});
			await editor.save.flush();
			toast.success("Podcast sync sequence created", {
				description: `${result.summary.totalCuts} cuts across ${resolvedChannels.length} channels`,
			});
			onOpenChange(false);
		} catch (error) {
			console.error("Podcast sync failed:", error);
			toast.error("Podcast sync failed", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => !isRunning && onOpenChange(next)}
		>
			<DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Podcast Sync</DialogTitle>
					<DialogDescription>
						Choose the video and audio source for each channel, then create an
						editable routed sequence.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-5">
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						<div className="space-y-1.5">
							<Label>Channels</Label>
							<Input
								type="number"
								min={1}
								max={12}
								value={channels.length}
								onChange={(event) =>
									setChannelCount(Number(event.target.value))
								}
								disabled={isRunning}
							/>
						</div>
						<div className="space-y-1.5 md:col-span-3">
							<Label>Sequence name</Label>
							<Input
								value={settings.sequenceName}
								onChange={(event) =>
									setSettings((current) => ({
										...current,
										sequenceName: event.target.value,
									}))
								}
								disabled={isRunning}
							/>
						</div>
					</div>

					<div className="space-y-2">
						<div className="grid grid-cols-[1fr_1.2fr_1.2fr] gap-2 text-xs text-muted-foreground">
							<span>Channel</span>
							<span>Video</span>
							<span>Audio</span>
						</div>
						{channels.map((channel) => (
							<div
								key={channel.id}
								className="grid grid-cols-[1fr_1.2fr_1.2fr] gap-2"
							>
								<Input
									value={channel.name}
									onChange={(event) =>
										updateChannel({
											channelId: channel.id,
											patch: { name: event.target.value },
										})
									}
									disabled={isRunning}
								/>
								<Select
									value={channel.videoAssetId}
									onValueChange={(value) =>
										updateChannel({
											channelId: channel.id,
											patch: { videoAssetId: value },
										})
									}
									disabled={isRunning}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Video" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NONE_VALUE}>No video</SelectItem>
										{videoAssets.map((asset) => (
											<SelectItem key={asset.id} value={asset.id}>
												{asset.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Select
									value={channel.audioAssetId}
									onValueChange={(value) =>
										updateChannel({
											channelId: channel.id,
											patch: { audioAssetId: value },
										})
									}
									disabled={isRunning}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Audio" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NONE_VALUE}>No audio</SelectItem>
										{audioAssets.map((asset) => (
											<SelectItem key={asset.id} value={asset.id}>
												{asset.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						))}
					</div>

					<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
						<NumberSetting
							label="Min cut"
							value={settings.minCutDuration}
							min={0.1}
							step={0.1}
							disabled={isRunning}
							onChange={(value) =>
								setSettings((current) => ({
									...current,
									minCutDuration: value,
								}))
							}
						/>
						<NumberSetting
							label="Max cut"
							value={settings.maxCutDuration}
							min={0}
							step={0.5}
							disabled={isRunning}
							onChange={(value) =>
								setSettings((current) => ({
									...current,
									maxCutDuration: value,
								}))
							}
						/>
						<NumberSetting
							label="Preroll"
							value={settings.preRoll}
							min={0}
							step={0.05}
							disabled={isRunning}
							onChange={(value) =>
								setSettings((current) => ({
									...current,
									preRoll: value,
								}))
							}
						/>
						<NumberSetting
							label="Max lag"
							value={settings.maxLagSeconds}
							min={1}
							step={1}
							disabled={isRunning}
							onChange={(value) =>
								setSettings((current) => ({
									...current,
									maxLagSeconds: value,
								}))
							}
						/>
						<div className="flex items-end justify-between rounded-md border px-3 py-2">
							<Label>Anti-bleed</Label>
							<Switch
								checked={settings.antiBleed}
								onCheckedChange={(antiBleed) =>
									setSettings((current) => ({ ...current, antiBleed }))
								}
								disabled={isRunning}
							/>
						</div>
					</div>

					<div className={cn("space-y-2", !isRunning && "hidden")}>
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>{progress.step}</span>
							<span>{Math.round(progress.value * 100)}%</span>
						</div>
						<Progress value={Math.round(progress.value * 100)} />
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isRunning}
					>
						Cancel
					</Button>
					<Button onClick={handleCreate} disabled={isRunning}>
						{isRunning ? "Syncing" : "Create sequence"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function NumberSetting({
	label,
	value,
	min,
	step,
	disabled,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	step: number;
	disabled: boolean;
	onChange: (value: number) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<Input
				type="number"
				min={min}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				disabled={disabled}
			/>
		</div>
	);
}
