"use client";

import { AiPromptPanel, type AiPromptPanelSelection } from "@anvilkit/ui";
import type { ReactElement } from "react";

import type { AiCopilotPluginInstance } from "../types.js";
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
	readonly className?: string;
}

/**
 * Stateful React surface for {@link AiCopilotPluginInstance}.
 *
 * Bundles the panel UI from `@anvilkit/ui` with the imperative call
 * glue that every host previously had to reimplement (prompt state,
 * pending flag, error surface). The headless `.` entry of this package
 * is unchanged — consumers who bring their own UI never touch this
 * subpath.
 */
export function AiCopilotPanel({
	plugin,
	selection,
	className,
}: AiCopilotPanelProps): ReactElement {
	const copilot = useAiCopilot(plugin);
	return (
		<AiPromptPanel
			{...copilot}
			selection={selection ?? null}
			className={className}
		/>
	);
}
