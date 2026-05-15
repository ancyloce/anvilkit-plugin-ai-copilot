"use client";

import type { AiPromptPanelSelection } from "@anvilkit/ui";
import type { ReactElement } from "react";

import type { AiCopilotPluginInstance } from "../types.js";
import { CopilotChatPanel } from "./copilot-chat-panel.js";
import type { CopilotModel } from "./copilot-model-menu.js";
import { useAiCopilot } from "./use-ai-copilot.js";

export interface AiCopilotPanelProps {
	/**
	 * Live plugin instance produced by `createAiCopilotPlugin`. The panel
	 * calls `plugin.runGeneration` / `plugin.regenerateSelection`
	 * imperatively from its submit handlers.
	 */
	readonly plugin: AiCopilotPluginInstance;
	/**
	 * Active Puck selection, or `null` for whole-page generation mode.
	 *
	 * The host owns the selection — typically derived from Puck's
	 * `appState.ui.itemSelector` and zone metadata. The panel itself
	 * does not subscribe to Puck.
	 */
	readonly selection?: AiPromptPanelSelection | null;
	/** Branded product name shown in the chat header. */
	readonly brandName?: string;
	/** Composer placeholder. */
	readonly placeholder?: string;
	/** Empty-thread copy. */
	readonly emptyDescription?: string;
	/**
	 * Optional model menu entries. Omit to hide the selector. The plugin
	 * does not consume the chosen id today — it is surfaced through the
	 * hook so a host can read it from its own `generatePage` closure.
	 */
	readonly models?: readonly CopilotModel[];
	/** Pre-selects a model entry. */
	readonly defaultModelId?: string;
	/** Optional attach affordance. Omit to hide the "+" button. */
	readonly onAttach?: () => void;
	readonly className?: string;
}

/**
 * Stateful React surface for {@link AiCopilotPluginInstance}.
 *
 * Bundles the chat panel UI with the imperative call glue that every
 * host previously had to reimplement (prompt state, pending flag,
 * conversation thread, error surface). The headless `.` entry of this
 * package is unchanged — consumers who bring their own UI never touch
 * this subpath.
 */
export function AiCopilotPanel({
	plugin,
	selection,
	brandName,
	placeholder,
	emptyDescription,
	models,
	defaultModelId,
	onAttach,
	className,
}: AiCopilotPanelProps): ReactElement {
	const copilot = useAiCopilot(plugin, { defaultModelId });
	return (
		<CopilotChatPanel
			prompt={copilot.prompt}
			onPromptChange={copilot.onPromptChange}
			onGenerate={copilot.onGenerate}
			onRegenerate={copilot.onRegenerate}
			status={copilot.status}
			issues={copilot.issues}
			messages={copilot.messages}
			toolCalls={copilot.toolCalls}
			selectedModelId={copilot.selectedModelId}
			onModelChange={copilot.onModelChange}
			selection={selection ?? null}
			models={models}
			brandName={brandName}
			placeholder={placeholder}
			emptyDescription={emptyDescription}
			onAttach={onAttach}
			className={className}
		/>
	);
}
