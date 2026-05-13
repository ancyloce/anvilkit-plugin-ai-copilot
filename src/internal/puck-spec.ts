/**
 * @file Shared Puck-spec helpers used by both the section-patch
 * application path and the section "before" snapshot walker.
 *
 * Centralizes the `PuckContentItem` type guard, the `props.id` reader,
 * the default slot name, and the recursion depth ceiling so the two
 * walkers cannot drift apart structurally (see review M3, L3, H2).
 */

import type { Data as PuckData } from "@puckeditor/core";

export type PuckContentItem = PuckData["content"][number];
export type PuckProps = Record<string, unknown>;

/**
 * Default Puck slot name when an IR `child.slot` is unset. Must match
 * Puck's own convention — both `irToPuckPatch` and the section patch
 * builder fall back here.
 */
export const DEFAULT_SLOT_NAME = "children";

/**
 * Hard depth ceiling for recursive Puck-tree walks. Bounds both
 * pathological deep trees and cycles (combined with a `visited`
 * `WeakSet`, this is the runtime guard preventing the stack overflow
 * called out in review H2).
 */
export const MAX_TREE_DEPTH = 64;

/**
 * Structural type guard for a Puck content item. An item must be a
 * plain object with a non-null `props` object. We use the stricter
 * `props !== null` form as the canonical check — historically
 * `find-current-nodes.ts` allowed null props, which is a latent bug
 * since the rest of the code reads `props.id`.
 */
export function isPuckContentItem(value: unknown): value is PuckContentItem {
	return (
		typeof value === "object" &&
		value !== null &&
		"props" in (value as object) &&
		typeof (value as { props: unknown }).props === "object" &&
		(value as { props: unknown }).props !== null
	);
}

/**
 * Read a Puck item's string `props.id`, or `undefined` if absent or
 * non-string. Non-string ids are silently treated as missing — error
 * reporters at the call site are responsible for surfacing what *was*
 * present when a lookup fails (see review M2, M4).
 */
export function getItemId(item: PuckContentItem): string | undefined {
	const props = (item as { props?: PuckProps }).props;
	if (!props) return undefined;
	const id = props.id;
	return typeof id === "string" ? id : undefined;
}
