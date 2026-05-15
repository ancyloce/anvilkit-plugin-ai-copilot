"use client";

import { useCallback, useState } from "react";

import type { AiSectionSelection } from "@anvilkit/core/types";
import type { AiPromptPanelIssue, AiPromptPanelSelection } from "@anvilkit/ui";

import type { AiCopilotPluginInstance } from "../types.js";

export interface UseAiCopilotResult {
	readonly prompt: string;
	readonly onPromptChange: (next: string) => void;
	readonly status: "idle" | "pending";
	readonly error: string | null;
	readonly issues: readonly AiPromptPanelIssue[];
	readonly onGenerate: (trimmed: string) => void;
	readonly onRegenerate: (
		trimmed: string,
		selection: AiPromptPanelSelection,
	) => void;
}

/**
 * Headless state container for {@link AiCopilotPanel} consumers.
 *
 * Owns the prompt, pending status, and free-form `error` for a single
 * copilot instance, and translates the panel's submit handlers into
 * imperative `plugin.runGeneration` / `plugin.regenerateSelection`
 * calls. Errors thrown by those calls are surfaced via `error`; the
 * structured `issues` list is left empty here — hosts that want to
 * surface validator issues subscribe to the plugin's
 * `ai-copilot:error` event bus themselves and lift the issues into
 * state alongside this hook.
 */
export function useAiCopilot(
	plugin: AiCopilotPluginInstance,
): UseAiCopilotResult {
	const [prompt, setPrompt] = useState("");
	const [status, setStatus] = useState<"idle" | "pending">("idle");
	const [error, setError] = useState<string | null>(null);
	const [issues] = useState<readonly AiPromptPanelIssue[]>([]);

	const onGenerate = useCallback(
		(trimmed: string): void => {
			setError(null);
			setStatus("pending");
			plugin
				.runGeneration(trimmed)
				.catch((err: unknown) => {
					setError(err instanceof Error ? err.message : String(err));
				})
				.finally(() => {
					setStatus("idle");
				});
		},
		[plugin],
	);

	const onRegenerate = useCallback(
		(trimmed: string, selection: AiPromptPanelSelection): void => {
			setError(null);
			setStatus("pending");
			const irSelection: AiSectionSelection = {
				zoneId: selection.zoneId,
				nodeIds: selection.nodeIds,
			};
			plugin
				.regenerateSelection(trimmed, irSelection)
				.catch((err: unknown) => {
					setError(err instanceof Error ? err.message : String(err));
				})
				.finally(() => {
					setStatus("idle");
				});
		},
		[plugin],
	);

	return {
		prompt,
		onPromptChange: setPrompt,
		status,
		error,
		issues,
		onGenerate,
		onRegenerate,
	};
}
