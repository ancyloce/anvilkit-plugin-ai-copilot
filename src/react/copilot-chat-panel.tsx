"use client";

import type {
	AiPromptPanelIssue,
	AiPromptPanelSelection,
} from "@anvilkit/ui";
import { Card, CardContent, CardHeader, ScrollArea } from "@anvilkit/ui";
import { GradientText } from "@anvilkit/ui/components/animate-ui/primitives/texts/gradient";
import { ShimmeringText } from "@anvilkit/ui/components/animate-ui/primitives/texts/shimmering";
import { cn } from "@anvilkit/ui/lib/utils";
import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";

import {
	type CopilotMessage,
	CopilotMessageBubble,
} from "./copilot-message-bubble.js";
import type { CopilotModel } from "./copilot-model-menu.js";
import { CopilotComposer } from "./copilot-composer.js";
import {
	type CopilotToolCall,
	CopilotToolCallRow,
} from "./copilot-tool-call-row.js";

export type { CopilotMessage } from "./copilot-message-bubble.js";
export type { CopilotModel } from "./copilot-model-menu.js";
export type { CopilotToolCall } from "./copilot-tool-call-row.js";

const BRAND_GRADIENT =
	"linear-gradient(90deg, var(--primary) 0%, hsl(280 90% 65%) 50%, var(--primary) 100%)";
const BRAND_SWEEP = {
	duration: 14,
	repeat: Number.POSITIVE_INFINITY,
	ease: "linear",
} as const;

export interface CopilotChatPanelProps {
	readonly prompt: string;
	readonly onPromptChange: (next: string) => void;
	readonly onGenerate: (prompt: string) => void;
	readonly onRegenerate?: (
		prompt: string,
		selection: AiPromptPanelSelection,
	) => void;
	readonly selection?: AiPromptPanelSelection | null;
	readonly status?: "idle" | "pending";
	readonly issues?: readonly AiPromptPanelIssue[];
	readonly messages: readonly CopilotMessage[];
	/** Empty by default — the trace row is hidden when there is no data. */
	readonly toolCalls?: readonly CopilotToolCall[];
	/** Omit to hide the model selector entirely. */
	readonly models?: readonly CopilotModel[];
	readonly selectedModelId?: string;
	readonly onModelChange?: (id: string) => void;
	readonly onAttach?: () => void;
	readonly brandName?: string;
	readonly placeholder?: string;
	readonly emptyDescription?: string;
	readonly className?: string;
}

export function CopilotChatPanel(
	props: CopilotChatPanelProps,
): ReactElement {
	const {
		prompt,
		onPromptChange,
		onGenerate,
		onRegenerate,
		selection,
		status = "idle",
		issues,
		messages,
		toolCalls = [],
		models,
		selectedModelId,
		onModelChange,
		onAttach,
		brandName = "Claude Cowork",
		placeholder = "Reply...",
		emptyDescription = "Describe the page you want — the AI copilot will generate a full canvas.",
		className,
	} = props;

	const isSectionMode = !!selection && selection.nodeIds.length > 0;
	const sectionHandlerMissing = isSectionMode && !onRegenerate;
	const isPending = status === "pending";

	const errorIssues =
		issues?.filter((issue) => issue.severity === "error") ?? [];
	const warnIssues =
		issues?.filter((issue) => issue.severity === "warn") ?? [];
	const hasDiagnostics =
		errorIssues.length > 0 ||
		warnIssues.length > 0 ||
		sectionHandlerMissing;

	const endRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const end = endRef.current;
		if (!end) return;
		// Scroll only the chat thread's own viewport. `scrollIntoView`
		// would scroll every scrollable ancestor up to the window,
		// dragging the whole editor page along with it.
		const viewport = end.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [messages, toolCalls]);

	function handleSubmit(): void {
		const trimmed = prompt.trim();
		if (trimmed.length === 0 || sectionHandlerMissing) return;
		if (isSectionMode && selection && onRegenerate) {
			onRegenerate(trimmed, selection);
		} else if (!isSectionMode) {
			onGenerate(trimmed);
		}
		onPromptChange("");
	}

	const isEmpty = messages.length === 0 && toolCalls.length === 0;

	return (
		<Card
			data-slot="copilot-chat-panel"
			data-mode={isSectionMode ? "section" : "page"}
			className={cn(
				"min-h-0 flex-1 gap-2 rounded-none bg-transparent shadow-none ring-0",
				className,
			)}
		>
			<CardHeader className="items-center px-2">
				<div
					data-testid="copilot-brand"
					className="flex items-center justify-center gap-2"
				>
					<Sparkles
						aria-hidden
						className="size-4 text-primary"
					/>
					<span className="font-heading text-base font-medium">
						{isPending ? (
							<ShimmeringText
								text={brandName}
								duration={1.4}
								color="var(--muted-foreground)"
								shimmeringColor="var(--foreground)"
							/>
						) : (
							<GradientText
								text={brandName}
								gradient={BRAND_GRADIENT}
								transition={BRAND_SWEEP}
							/>
						)}
					</span>
				</div>
			</CardHeader>
			<CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-0">
				<ScrollArea
					data-testid="copilot-thread"
					className="min-h-0 flex-1"
				>
					<div className="flex min-h-full flex-col gap-2 px-2">
						{isEmpty ? (
							<motion.p
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								transition={{ duration: 0.2 }}
								className="m-auto max-w-[80%] text-center text-sm text-muted-foreground"
							>
								{emptyDescription}
							</motion.p>
						) : null}
						<AnimatePresence initial={false} mode="popLayout">
							{messages.map((message) => (
								<CopilotMessageBubble
									key={message.id}
									message={message}
								/>
							))}
						</AnimatePresence>
						{toolCalls.length > 0 ? (
							<div
								data-testid="copilot-tool-calls"
								className="flex flex-col"
							>
								<AnimatePresence initial={false}>
									{toolCalls.map((toolCall) => (
										<CopilotToolCallRow
											key={toolCall.id}
											toolCall={toolCall}
										/>
									))}
								</AnimatePresence>
							</div>
						) : null}
						<div ref={endRef} aria-hidden />
					</div>
				</ScrollArea>

				<AnimatePresence initial={false}>
					{hasDiagnostics ? (
						<motion.div
							key="diagnostics"
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.22, ease: "easeOut" }}
							style={{ overflow: "hidden" }}
						>
							<div
								role="status"
								data-testid="copilot-diagnostics"
								className="flex flex-col gap-2 text-sm"
							>
								{sectionHandlerMissing ? (
									<p className="text-destructive">
										This host has not wired a section regenerator.
										Configure{" "}
										<code className="font-mono text-xs">
											generateSection
										</code>{" "}
										on{" "}
										<code className="font-mono text-xs">
											createAiCopilotPlugin
										</code>{" "}
										to enable section regeneration.
									</p>
								) : null}
								{errorIssues.length > 0 ? (
									<ul
										data-testid="copilot-error-issues"
										className="flex list-disc flex-col gap-1 pl-5 text-destructive"
									>
										{errorIssues.map((issue, index) => (
											<li
												key={`${issue.path}:${index}`}
												className="break-words"
											>
												<span className="font-mono text-xs">
													{issue.path || "(root)"}
												</span>{" "}
												— {issue.message}
											</li>
										))}
									</ul>
								) : null}
								{warnIssues.length > 0 ? (
									<ul
										data-testid="copilot-warn-issues"
										className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground"
									>
										{warnIssues.map((issue, index) => (
											<li
												key={`${issue.path}:${index}`}
												className="break-words"
											>
												<span className="font-mono text-xs">
													{issue.path || "(root)"}
												</span>{" "}
												— {issue.message}
											</li>
										))}
									</ul>
								) : null}
							</div>
						</motion.div>
					) : null}
				</AnimatePresence>

				<CopilotComposer
					prompt={prompt}
					onPromptChange={onPromptChange}
					onSubmit={handleSubmit}
					pending={isPending}
					disabled={sectionHandlerMissing}
					placeholder={placeholder}
					onAttach={onAttach}
					models={models}
					selectedModelId={selectedModelId}
					onModelChange={onModelChange}
				/>
			</CardContent>
		</Card>
	);
}
