"use client";

/**
 * @file Standalone `aiCopilot` i18n provider + the `AnvilkitMessages` type
 * augmentation.
 *
 * {@link AiCopilotI18nProvider} wraps the host-mounted `./react` copilot UI
 * when it renders OUTSIDE `<Studio>` so its `useMsg("aiCopilot.*")` calls
 * resolve. In-chrome usage needs no wrapper — the plugin's `register()`
 * contributes {@link AI_COPILOT_ENTRY} to core's catalog.
 */

import { EditorI18nProvider } from "@anvilkit/core/i18n";
import type { ReactNode } from "react";

import { AI_COPILOT_ENTRY, type AiCopilotMessageKey } from "./entry.js";

export function AiCopilotI18nProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <EditorI18nProvider entries={[AI_COPILOT_ENTRY]}>
      {children}
    </EditorI18nProvider>
  );
}

// Augment the public key registry so `useT("aiCopilot.*")` autocompletes.
declare module "@anvilkit/core/i18n" {
  interface AnvilkitMessages extends Record<AiCopilotMessageKey, string> {}
}
