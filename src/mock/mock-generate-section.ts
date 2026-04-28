/**
 * @file Mock {@link GenerateSectionFn} — demo / Playwright fixture for
 * the Phase 6 / M9 section flow.
 *
 * Returns an {@link AiSectionPatch} that replaces every selected node
 * with a fresh-id clone of the same component type, optionally
 * overriding a "headline" / "title" / "label" prop with text derived
 * from the user's prompt. The result always passes
 * `validateAiSectionPatch` against any context that includes the same
 * component types in its allow-list, which is the contract the demo
 * and Playwright spec rely on.
 *
 * Pure function — no network, no host APIs. The optional `delayMs`
 * mirrors `createMockGeneratePage` so test code that awaits a
 * realistic latency profile works the same in both flows.
 */

import type {
	AiSectionContext,
	AiSectionPatch,
	PageIRNode,
} from "@anvilkit/core/types";

import type { GenerateSectionFn } from "../types.js";

export interface CreateMockGenerateSectionOptions {
	/**
	 * Artificial delay before the patch resolves, in milliseconds.
	 * Defaults to `0` (synchronous resolution).
	 */
	readonly delayMs?: number;
}

const PROMPT_PROP_KEYS = ["headline", "title", "label", "heading"] as const;

function pickPromptProp(
	props: Readonly<Record<string, unknown>>,
): (typeof PROMPT_PROP_KEYS)[number] | null {
	for (const key of PROMPT_PROP_KEYS) {
		if (key in props) return key;
	}
	return null;
}

function regenerateNode(
	original: PageIRNode | undefined,
	fallbackType: string,
	prompt: string,
	indexHint: number,
): PageIRNode {
	const baseType = original?.type ?? fallbackType;
	const baseProps = (original?.props ?? {}) as Record<string, unknown>;
	const promptText = prompt.trim().slice(0, 120);

	const promptKey = pickPromptProp(baseProps);
	const nextProps: Record<string, unknown> = { ...baseProps };
	if (promptKey) {
		nextProps[promptKey] = promptText;
	}

	const baseId = original?.id ?? `mock-${baseType}-${indexHint}`;
	return {
		id: `${baseId}-regen`,
		type: baseType,
		props: nextProps,
		...(original?.children ? { children: original.children } : {}),
		...(original?.slot !== undefined ? { slot: original.slot } : {}),
		...(original?.slotKind !== undefined
			? { slotKind: original.slotKind }
			: {}),
	};
}

export function createMockGenerateSection(
	opts: CreateMockGenerateSectionOptions = {},
): GenerateSectionFn {
	const delayMs = Math.max(0, opts.delayMs ?? 0);

	return async (prompt: string, ctx: AiSectionContext): Promise<AiSectionPatch> => {
		if (delayMs > 0) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, delayMs);
			});
		}

		const fallbackType =
			ctx.availableComponents[0]?.componentName ?? "Unknown";
		const currentNodes = ctx.currentNodes ?? [];

		const replacement: PageIRNode[] = ctx.nodeIds.map((_id, index) =>
			regenerateNode(currentNodes[index], fallbackType, prompt, index),
		);

		return {
			zoneId: ctx.zoneId,
			nodeIds: [...ctx.nodeIds],
			replacement,
		};
	};
}
