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
 *
 * Tree walks are depth-bounded (MAX_TREE_DEPTH) and cycle-protected
 * (WeakSet) so a pathological or accidentally-cyclic Puck tree throws
 * a clear error rather than stack-overflowing (review H2).
 */

import type { PageIRNode } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

import {
	getItemId,
	isPuckContentItem,
	MAX_TREE_DEPTH,
	type PuckContentItem,
} from "./puck-spec.js";

function contentItemToIRNode(
	item: PuckContentItem,
	depth = 0,
	seen: WeakSet<PuckContentItem> = new WeakSet(),
): PageIRNode {
	if (depth > MAX_TREE_DEPTH) {
		throw new Error(
			`findCurrentNodes: Puck tree depth exceeded ${MAX_TREE_DEPTH}`,
		);
	}
	if (seen.has(item)) {
		throw new Error("findCurrentNodes: cycle detected in Puck content tree");
	}
	seen.add(item);

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
		if (Array.isArray(value) && value.every(isPuckContentItem)) {
			childCandidates.push({ slot: key, items: value });
			continue;
		}
		surfaceProps[key] = value;
	}

	const children: PageIRNode[] = [];
	for (const { slot, items } of childCandidates) {
		for (const child of items) {
			const childNode = contentItemToIRNode(child, depth + 1, seen);
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
	depth: number,
	seen: WeakSet<PuckContentItem>,
): void {
	if (depth > MAX_TREE_DEPTH) {
		throw new Error(
			`findCurrentNodes: Puck tree depth exceeded ${MAX_TREE_DEPTH}`,
		);
	}
	for (const item of content) {
		if (idsRemaining.size === 0) return;
		if (seen.has(item)) continue;
		seen.add(item);

		const id = getItemId(item);
		if (id && idsRemaining.has(id)) {
			// Match found — convert with a fresh visited set scoped to the
			// matched subtree so the IR build has independent cycle-tracking.
			results.set(id, contentItemToIRNode(item));
			idsRemaining.delete(id);
		}

		const props = (item as { props?: Record<string, unknown> }).props;
		if (!props) continue;
		for (const value of Object.values(props)) {
			if (idsRemaining.size === 0) return;
			if (Array.isArray(value) && value.every(isPuckContentItem)) {
				searchContent(
					value as PuckContentItem[],
					idsRemaining,
					results,
					depth + 1,
					seen,
				);
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
	const seen = new WeakSet<PuckContentItem>();

	const content = (currentData.content ?? []) as readonly PuckContentItem[];
	searchContent(content, idsRemaining, results, 0, seen);

	if (idsRemaining.size > 0 && currentData.zones) {
		for (const zone of Object.values(currentData.zones) as readonly (
			| readonly PuckContentItem[]
			| undefined
		)[]) {
			if (idsRemaining.size === 0) break;
			if (zone) searchContent(zone, idsRemaining, results, 0, seen);
		}
	}

	return nodeIds
		.map((id) => results.get(id))
		.filter((node): node is PageIRNode => node !== undefined);
}
