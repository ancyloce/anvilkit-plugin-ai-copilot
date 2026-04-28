/**
 * @file Look up Puck content items by id and convert them to
 * {@link PageIRNode}s so `regenerateSelection()` can hand the host's
 * `generateSection` callback "before" snapshots without forcing the
 * host to walk Puck's tree itself.
 *
 * Pure function — no React, no IR-package dependency. Mirrors
 * `apply-section-patch.ts`'s search semantics: root content, legacy
 * `data.zones`, and modern slot fields are all searched. Returns a
 * partial list (one entry per found id, omitting absent ids) so the
 * caller can decide whether to merge with whatever the host already
 * supplied.
 */

import type { PageIRNode } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

type PuckContentItem = PuckData["content"][number];

function isContentItem(value: unknown): value is PuckContentItem {
	return (
		typeof value === "object" &&
		value !== null &&
		"props" in (value as object) &&
		typeof (value as { props?: unknown }).props === "object"
	);
}

function getItemId(item: PuckContentItem): string | undefined {
	const props = (item as { props?: Record<string, unknown> }).props;
	const id = props?.id;
	return typeof id === "string" ? id : undefined;
}

function contentItemToIRNode(item: PuckContentItem): PageIRNode {
	const props = (item as { props?: Record<string, unknown> }).props ?? {};
	const id = (props.id as string | undefined) ?? "";
	const type = (item as { type?: string }).type ?? "Unknown";

	// Strip the id and any array-valued props that are nested slot
	// children — the IR shape carries them as `children`, not embedded
	// arrays. `regenerateSelection` only needs surface props for the
	// "before" snapshot the LLM prompt uses.
	const surfaceProps: Record<string, unknown> = {};
	const childCandidates: Array<{ slot: string; items: PuckContentItem[] }> = [];
	for (const [key, value] of Object.entries(props)) {
		if (key === "id") continue;
		if (Array.isArray(value) && value.every(isContentItem)) {
			childCandidates.push({ slot: key, items: value });
			continue;
		}
		surfaceProps[key] = value;
	}

	const children: PageIRNode[] = [];
	for (const { slot, items } of childCandidates) {
		for (const child of items) {
			const childNode = contentItemToIRNode(child);
			children.push({ ...childNode, slot });
		}
	}

	return {
		id,
		type,
		props: surfaceProps,
		...(children.length > 0 ? { children } : {}),
	};
}

function searchContent(
	content: readonly PuckContentItem[],
	idsRemaining: Set<string>,
	results: Map<string, PageIRNode>,
): void {
	for (const item of content) {
		if (idsRemaining.size === 0) return;

		const id = getItemId(item);
		if (id && idsRemaining.has(id)) {
			results.set(id, contentItemToIRNode(item));
			idsRemaining.delete(id);
		}

		const props = (item as { props?: Record<string, unknown> }).props;
		if (!props) continue;
		for (const value of Object.values(props)) {
			if (idsRemaining.size === 0) return;
			if (Array.isArray(value) && value.every(isContentItem)) {
				searchContent(value as PuckContentItem[], idsRemaining, results);
			}
		}
	}
}

/**
 * Walk Puck `Data` for the supplied node ids and return the matching
 * subtrees as `PageIRNode`s, in the same order as the input list.
 * Missing ids are silently dropped so the caller can fall back to a
 * partial snapshot.
 */
export function findCurrentNodes(
	currentData: PuckData,
	nodeIds: readonly string[],
): readonly PageIRNode[] {
	if (nodeIds.length === 0) return [];

	const idsRemaining = new Set(nodeIds);
	const results = new Map<string, PageIRNode>();

	const content = (currentData.content ?? []) as readonly PuckContentItem[];
	searchContent(content, idsRemaining, results);

	if (idsRemaining.size > 0 && currentData.zones) {
		for (const zone of Object.values(currentData.zones) as readonly (
			| readonly PuckContentItem[]
			| undefined
		)[]) {
			if (idsRemaining.size === 0) break;
			if (zone) searchContent(zone, idsRemaining, results);
		}
	}

	return nodeIds
		.map((id) => results.get(id))
		.filter((node): node is PageIRNode => node !== undefined);
}
