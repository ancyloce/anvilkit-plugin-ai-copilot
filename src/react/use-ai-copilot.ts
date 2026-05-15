"use client";

import type { AiSectionSelection } from "@anvilkit/core/types";
import type { AiPromptPanelIssue, AiPromptPanelSelection } from "@anvilkit/ui";
import { useCallback, useRef, useState } from "react";

import type { AiCopilotPluginInstance, AiCopilotTraceEvent } from "../types.js";
import type { CopilotMessage } from "./copilot-message-bubble.js";
import type { CopilotToolCall } from "./copilot-tool-call-row.js";

export interface UseAiCopilotOptions {
	/** Pre-selects an entry in the model menu. */
	readonly defaultModelId?: string;
	/**
	 * Optional pass-through observer. Every {@link AiCopilotTraceEvent}
	 * forwarded into {@link UseAiCopilotResult.pushTrace} is also handed
	 * to this callback, so a host can keep its own Sentry/OTel wiring
	 * while the panel renders the same events as tool-call rows.
	 */
	readonly onTrace?: (event: AiCopilotTraceEvent) => void;
}

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
	readonly messages: readonly CopilotMessage[];
	readonly toolCalls: readonly CopilotToolCall[];
	readonly selectedModelId: string | undefined;
	readonly onModelChange: (id: string) => void;
	/**
	 * Stable sink for the plugin's `onTrace` channel. Wire it from the
	 * host via an indirection so the plugin (created before this hook
	 * runs) can reach it:
	 *
	 * ```ts
	 * const sink = useRef<(e: AiCopilotTraceEvent) => void>();
	 * const plugin = useMemo(
	 *   () => createAiCopilotPlugin({ …, onTrace: (e) => sink.current?.(e) }),
	 *   [],
	 * );
	 * const copilot = useAiCopilot(plugin);
	 * useEffect(() => { sink.current = copilot.pushTrace; }, [copilot.pushTrace]);
	 * ```
	 */
	readonly pushTrace: (event: AiCopilotTraceEvent) => void;
}

function traceToToolCall(
	event: AiCopilotTraceEvent,
	previous: CopilotToolCall | undefined,
): CopilotToolCall {
	const id = `${event.flow}-${event.generationId}`;
	const label =
		event.flow === "page" ? "Generate page" : "Regenerate selection";
	const base: CopilotToolCall = previous ?? {
		id,
		eyebrow: "GENERATION TRACE",
		label,
		status: "running",
	};

	switch (event.type) {
		case "generation-start":
		case "generation-validated":
			return { ...base, status: "running" };
		case "generation-dispatched":
			return { ...base, status: "success" };
		case "generation-stale-drop":
			return { ...base, status: "stale", detail: event.stage };
		case "generation-failed":
			return { ...base, status: "error", detail: event.code };
		default:
			return base;
	}
}

/**
 * Headless state container for {@link CopilotChatPanel} consumers.
 *
 * Owns the conversation thread, the pending status, the structured
 * tool-call timeline (populated from the plugin's trace events), the
 * selected model id, and a free-form `error` for a single copilot
 * instance. Translates the panel's submit handlers into imperative
 * `plugin.runGeneration` / `plugin.regenerateSelection` calls.
 *
 * The returned shape is a superset of the legacy result so the existing
 * `AiCopilotPanel` keeps working without changes.
 */
export function useAiCopilot(
	plugin: AiCopilotPluginInstance,
	options?: UseAiCopilotOptions,
): UseAiCopilotResult {
	const [prompt, setPrompt] = useState("");
	const [status, setStatus] = useState<"idle" | "pending">("idle");
	const [error, setError] = useState<string | null>(null);
	const [issues] = useState<readonly AiPromptPanelIssue[]>([]);
	const [messages, setMessages] = useState<readonly CopilotMessage[]>([]);
	const [toolCalls, setToolCalls] = useState<readonly CopilotToolCall[]>([]);
	const [selectedModelId, setSelectedModelId] = useState<string | undefined>(
		options?.defaultModelId,
	);

	const idCounter = useRef(0);
	const nextId = useCallback((kind: string): string => {
		idCounter.current += 1;
		return `${kind}-${idCounter.current}`;
	}, []);

	const onTraceRef = useRef(options?.onTrace);
	onTraceRef.current = options?.onTrace;

	const pushTrace = useCallback((event: AiCopilotTraceEvent): void => {
		onTraceRef.current?.(event);
		setToolCalls((prev) => {
			const id = `${event.flow}-${event.generationId}`;
			const existing = prev.find((call) => call.id === id);
			const next = traceToToolCall(event, existing);
			if (existing) {
				return prev.map((call) => (call.id === id ? next : call));
			}
			return [...prev, next];
		});
	}, []);

	const pushMessage = useCallback(
		(message: Omit<CopilotMessage, "id">): void => {
			setMessages((prev) => [
				...prev,
				{ ...message, id: nextId(message.role) },
			]);
		},
		[nextId],
	);

	const onGenerate = useCallback(
		(trimmed: string): void => {
			setError(null);
			setToolCalls([]);
			pushMessage({ role: "user", text: trimmed });
			setStatus("pending");
			plugin
				.runGeneration(trimmed)
				.then(() => {
					pushMessage({
						role: "assistant",
						text: "Generated the page on the canvas.",
					});
				})
				.catch((err: unknown) => {
					const text = err instanceof Error ? err.message : String(err);
					setError(text);
					pushMessage({ role: "assistant", text, variant: "error" });
				})
				.finally(() => {
					setStatus("idle");
				});
		},
		[plugin, pushMessage],
	);

	const onRegenerate = useCallback(
		(trimmed: string, selection: AiPromptPanelSelection): void => {
			setError(null);
			setToolCalls([]);
			pushMessage({ role: "user", text: trimmed });
			setStatus("pending");
			const irSelection: AiSectionSelection = {
				zoneId: selection.zoneId,
				nodeIds: selection.nodeIds,
			};
			plugin
				.regenerateSelection(trimmed, irSelection)
				.then(() => {
					pushMessage({
						role: "assistant",
						text: "Regenerated the selected section.",
					});
				})
				.catch((err: unknown) => {
					const text = err instanceof Error ? err.message : String(err);
					setError(text);
					pushMessage({ role: "assistant", text, variant: "error" });
				})
				.finally(() => {
					setStatus("idle");
				});
		},
		[plugin, pushMessage],
	);

	const onModelChange = useCallback((id: string): void => {
		setSelectedModelId(id);
	}, []);

	return {
		prompt,
		onPromptChange: setPrompt,
		status,
		error,
		issues,
		onGenerate,
		onRegenerate,
		messages,
		toolCalls,
		selectedModelId,
		onModelChange,
		pushTrace,
	};
}
