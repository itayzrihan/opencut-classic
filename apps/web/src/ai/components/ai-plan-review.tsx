"use client";

import { Button } from "@/components/ui/button";
import type { AiEditPlan } from "@/ai/types";

export function AiPlanReview({
	plan,
	errors = [],
	isApplying,
	onApply,
	onDiscard,
}: {
	plan: AiEditPlan | null;
	errors?: string[];
	isApplying?: boolean;
	onApply: () => void;
	onDiscard: () => void;
}) {
	if (!plan) {
		return null;
	}

	return (
		<div className="border-t pt-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-sm font-medium">{plan.title}</div>
					<div className="text-muted-foreground mt-1 text-xs leading-5">
						{plan.summary || "No summary returned."}
					</div>
				</div>
				<div className="text-muted-foreground shrink-0 text-xs">
					{plan.operations.length} ops
				</div>
			</div>

			{errors.length > 0 && (
				<div className="border-destructive/40 bg-destructive/10 text-destructive mt-3 rounded-sm border p-2 text-xs leading-5">
					{errors.map((error) => (
						<div key={error}>{error}</div>
					))}
				</div>
			)}

			<div className="mt-3 max-h-40 overflow-y-auto rounded-sm border">
				{plan.operations.length === 0 ? (
					<div className="text-muted-foreground p-3 text-xs">
						No timeline edits proposed.
					</div>
				) : (
					plan.operations.map((operation, index) => (
						<div
							key={`${operation.type}-${index}`}
							className="border-b px-3 py-2 last:border-b-0"
						>
							<div className="text-xs font-medium">{operation.type}</div>
							{"reason" in operation && operation.reason && (
								<div className="text-muted-foreground mt-1 text-xs">
									{operation.reason}
								</div>
							)}
						</div>
					))
				)}
			</div>

			<div className="mt-3 flex justify-end gap-2">
				<Button variant="outline" size="sm" onClick={onDiscard}>
					Discard
				</Button>
				<Button
					size="sm"
					onClick={onApply}
					disabled={errors.length > 0 || isApplying}
				>
					{isApplying ? "Applying..." : "Apply"}
				</Button>
			</div>
		</div>
	);
}
