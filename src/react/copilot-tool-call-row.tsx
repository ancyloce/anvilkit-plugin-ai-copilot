"use client";

import { cn } from "@anvilkit/ui/lib/utils";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { motion } from "motion/react";
import type { ReactElement } from "react";

export type CopilotToolCallStatus =
	| "running"
	| "success"
	| "error"
	| "stale";

export interface CopilotToolCall {
	/** Stable key — derived from the plugin's monotonic generationId. */
	readonly id: string;
	/** Uppercase eyebrow shown above the row, e.g. "GENERATION TRACE". */
	readonly eyebrow: string;
	/** Human label for the step, e.g. "Generate page". */
	readonly label: string;
	readonly status: CopilotToolCallStatus;
	/** Optional trailing detail — error code, stale stage, etc. */
	readonly detail?: string;
}

const STATUS_ICON: Record<CopilotToolCallStatus, typeof Check> = {
	running: Loader2,
	success: Check,
	error: X,
	stale: TriangleAlert,
};

const STATUS_TONE: Record<CopilotToolCallStatus, string> = {
	running: "text-muted-foreground",
	success: "text-foreground",
	error: "text-destructive",
	stale: "text-muted-foreground",
};

export interface CopilotToolCallRowProps {
	readonly toolCall: CopilotToolCall;
}

export function CopilotToolCallRow({
	toolCall,
}: CopilotToolCallRowProps): ReactElement {
	const Icon = STATUS_ICON[toolCall.status];
	const isRunning = toolCall.status === "running";

	return (
		<motion.div
			layout
			initial={{ opacity: 0, height: 0 }}
			animate={{ opacity: 1, height: "auto" }}
			exit={{ opacity: 0, height: 0 }}
			transition={{ duration: 0.22, ease: "easeOut" }}
			style={{ overflow: "hidden" }}
			data-slot="copilot-tool-call"
			data-status={toolCall.status}
		>
			<div className="flex flex-col gap-1 py-1.5">
				<span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
					{toolCall.eyebrow}
				</span>
				<div
					className={cn(
						"flex items-center gap-2 text-sm",
						STATUS_TONE[toolCall.status],
					)}
				>
					<Icon
						aria-hidden
						className={cn("size-3.5", isRunning && "animate-spin")}
					/>
					<span>{toolCall.label}</span>
					{toolCall.detail ? (
						<span className="font-mono text-xs text-muted-foreground">
							{toolCall.detail}
						</span>
					) : null}
				</div>
			</div>
		</motion.div>
	);
}
