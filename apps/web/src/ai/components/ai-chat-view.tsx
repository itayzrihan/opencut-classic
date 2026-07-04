"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, LogOut, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { getSelectedTimelineRange } from "@/timeline/range-selection";
import { useTimelineStore } from "@/timeline/timeline-store";
import { applyAiEditPlan, validateAiEditPlan } from "@/ai/edit-plan";
import { runAiAgent } from "@/ai/client-agent";
import type { AiEditPlan } from "@/ai/types";
import {
	buildAiSystemPrompt,
	buildTimelineContextPrompt,
	createTimelineToolRuntime,
} from "@/ai/timeline-tools";
import { AiPlanReview } from "./ai-plan-review";
import { useAiOAuthStatus } from "./use-ai-oauth-status";

type ContextOption =
	| "playhead"
	| "selected"
	| "range"
	| "preview"
	| "bookmarks"
	| "captions"
	| "media"
	| "layers";

const contextOptions: Array<{ key: ContextOption; label: string }> = [
	{ key: "playhead", label: "Current time" },
	{ key: "selected", label: "Selected elements" },
	{ key: "range", label: "Active range" },
	{ key: "preview", label: "Preview frame" },
	{ key: "bookmarks", label: "Bookmarks" },
	{ key: "captions", label: "Captions" },
	{ key: "media", label: "Media summary" },
	{ key: "layers", label: "Layer tools" },
];

export function AiChatView() {
	const editor = useEditor();
	const { selectedElements } = useElementSelection();
	const rangeSelection = useTimelineStore((state) => state.aiRangeSelection);
	const activeRange = getSelectedTimelineRange(rangeSelection);
	const { status, isLoading, login, logout } = useAiOAuthStatus();
	const [message, setMessage] = useState("");
	const [enabled, setEnabled] = useState<Set<ContextOption>>(
		() => new Set(["playhead", "selected", "range", "layers"]),
	);
	const [isRunning, setIsRunning] = useState(false);
	const [agentStatus, setAgentStatus] = useState("");
	const [responseText, setResponseText] = useState("");
	const [pendingPlan, setPendingPlan] = useState<AiEditPlan | null>(null);
	const [planErrors, setPlanErrors] = useState<string[]>([]);
	const [isApplying, setIsApplying] = useState(false);

	const identityLabel = useMemo(
		() =>
			status.identity?.email ??
			status.identity?.profileName ??
			status.identity?.accountId ??
			null,
		[status.identity],
	);

	const toggleContext = (key: ContextOption) => {
		setEnabled((previous) => {
			const next = new Set(previous);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	const handleSend = async () => {
		const prompt = message.trim();
		if (!prompt || isRunning) return;
		if (!status.authenticated) {
			login();
			return;
		}

		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) {
			toast.error("No active scene");
			return;
		}

		setIsRunning(true);
		setResponseText("");
		setPendingPlan(null);
		setPlanErrors([]);
		const controller = new AbortController();
		try {
			const toolRuntime = createTimelineToolRuntime({
				editor,
				options: {
					range: activeRange,
					selectedElements,
					includePreviewImage: enabled.has("preview"),
				},
			});
			const context = buildTimelineContextPrompt({
				editor,
				range: activeRange,
				selectedElements,
				includePlayheadTime: enabled.has("playhead"),
				includeSelectedElements: enabled.has("selected"),
				includeActiveRange: enabled.has("range"),
				includeBookmarks: enabled.has("bookmarks"),
				includeCaptions: enabled.has("captions"),
				includeMediaSummary: enabled.has("media"),
			});
			const result = await runAiAgent({
				messages: [
					{ role: "system", content: buildAiSystemPrompt() },
					{
						role: "user",
						content: [
							context,
							enabled.has("layers")
								? "Layer access is enabled through tools. Browse layers with timeline.search_layers and timeline.search_elements."
								: "Layer access is disabled unless layer ids were explicitly provided.",
							enabled.has("preview")
								? "Preview image context is enabled. Use preview.capture_frame if visual state matters."
								: "Preview image context is disabled.",
							`User request: ${prompt}`,
						].join("\n\n"),
					},
				],
				tools:
					enabled.has("layers") || enabled.has("preview")
						? toolRuntime.tools
						: [],
				executeTool: toolRuntime.executeTool,
				signal: controller.signal,
				onStep: setAgentStatus,
			});
			setResponseText(result.text);
			const validation = validateAiEditPlan({
				value: result.editPlan,
				tracks: scene.tracks,
				range: activeRange,
			});
			setPendingPlan(validation.plan);
			setPlanErrors(validation.errors);
			if (!validation.plan) {
				toast.error(result.error ?? "The AI did not return a valid edit plan");
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "AI request failed");
		} finally {
			setIsRunning(false);
			setAgentStatus("");
		}
	};

	const handleApply = () => {
		if (!pendingPlan || planErrors.length > 0) return;
		setIsApplying(true);
		try {
			applyAiEditPlan({ editor, plan: pendingPlan });
			setPendingPlan(null);
			setMessage("");
			toast.success("AI edit plan applied");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to apply edits",
			);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<div className="flex size-full flex-col overflow-hidden">
			<div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
				<div className="min-w-0">
					<div className="text-sm font-medium">AI</div>
					<div className="text-muted-foreground truncate text-xs">
						{isLoading
							? "Checking login..."
							: identityLabel
								? identityLabel
								: "OpenAI login required"}
					</div>
				</div>
				{status.authenticated ? (
					<Button
						variant="text"
						size="icon"
						onClick={logout}
						aria-label="Log out"
					>
						<LogOut className="size-4" />
					</Button>
				) : (
					<Button size="sm" onClick={login}>
						Log in
					</Button>
				)}
			</div>
			{status.error && !status.authenticated && (
				<div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{status.error}
				</div>
			)}

			<div className="flex-1 overflow-y-auto p-3">
				<div className="grid grid-cols-2 gap-2">
					{contextOptions.map((option) => (
						<label
							key={option.key}
							className="flex cursor-pointer items-center gap-2 text-xs"
						>
							<Checkbox
								checked={enabled.has(option.key)}
								onCheckedChange={() => toggleContext(option.key)}
							/>
							<span>{option.label}</span>
						</label>
					))}
				</div>

				<div className="mt-3">
					<Textarea
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						placeholder="Ask for an edit"
						className="min-h-32"
					/>
				</div>

				{agentStatus && (
					<div className="text-muted-foreground mt-2 text-xs">
						{agentStatus}
					</div>
				)}

				{responseText && !pendingPlan && (
					<div className="text-muted-foreground mt-3 rounded-sm border p-3 text-xs leading-5">
						{responseText}
					</div>
				)}

				<AiPlanReview
					plan={pendingPlan}
					errors={planErrors}
					isApplying={isApplying}
					onApply={handleApply}
					onDiscard={() => setPendingPlan(null)}
				/>
			</div>

			<div className="border-t p-3">
				<Button
					className="w-full"
					disabled={!message.trim() || isRunning}
					onClick={handleSend}
				>
					{isRunning ? (
						<Check className="size-4" />
					) : (
						<Send className="size-4" />
					)}
					{isRunning ? "Working" : "Send"}
				</Button>
			</div>
		</div>
	);
}
