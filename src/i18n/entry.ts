/**
 * @file The `aiCopilot` registry entry (pure data — no React).
 *
 * The plugin is headless; its React UI ships via the `./react` subpath and is
 * host-mounted. In-chrome (the host registers a copilot panel) it resolves via
 * core's `EditorI18nProvider` once `register()` contributes this entry;
 * standalone mounts wrap in {@link AiCopilotI18nProvider}. Components still
 * accept label props (host override wins) — these are the localizable defaults.
 * Message content lives in `i18n/messages/<locale>.json`; English ships inline
 * and other locales lazy-load.
 */

import type { RegistryEntry } from "@anvilkit/core/i18n";

// Messages live at the plugin-root `i18n/messages/` (shipped via the package
// `files`). Imported from outside `src/` so the bundleless rslib build keeps
// them external `.json` — same pattern as `meta/config.json`.
import enMessages from "../../i18n/messages/en.json" with { type: "json" };

/** Static lazy-pack map (avoids a dynamic template `import()` under rslib). */
const LOCALE_PACKS: Readonly<
	Record<string, () => Promise<{ readonly default: Record<string, string> }>>
> = {
	zh: () => import("../../i18n/messages/zh.json", { with: { type: "json" } }),
	ja: () => import("../../i18n/messages/ja.json", { with: { type: "json" } }),
	ko: () => import("../../i18n/messages/ko.json", { with: { type: "json" } }),
};

/** The registry entry contributed to the catalog (core prepends `studio.*`). */
export const AI_COPILOT_ENTRY: RegistryEntry = {
	namespace: "aiCopilot",
	en: enMessages,
	loadMessages: async (locale) => {
		const pack = LOCALE_PACKS[locale];
		return pack === undefined ? {} : (await pack()).default;
	},
};

/** Exact key union for the `AnvilkitMessages` augmentation. */
export type AiCopilotMessageKey = keyof typeof enMessages;
