/**
 * @file Section-level patch application for the AI copilot plugin.
 *
 * `applySectionPatch(currentData, patch)` is the runtime side of the
 * Phase 6 / M9 "Regenerate selection" flow. It locates the patch's
 * zone in the current Puck `Data`, replaces a contiguous run of
 * children matching `patch.nodeIds` with the converted
 * `patch.replacement` subtrees, and returns a new `Data` snapshot
 * suitable for `puckApi.dispatch({ type: "setData", data })`.
 *
 * Pure function — no React, no Puck-internal helpers. The conversion
 * from {@link PageIRNode} → Puck content shape mirrors the
 * page-level `irToPuckPatch` in `./ir-to-puck-patch.ts`, scoped to a
 * single subtree.
 *
 * **Phase 6 / M9 scope.** The patch must target one of:
 *
 * 1. The Puck root content (`zoneId === "root"` or `"root-zone"` —
 *    the special id Puck assigns to top-level children).
 * 2. A legacy `data.zones` entry, keyed `${parentId}:${slotName}`.
 * 3. A modern slot field on a component's props, addressed by the
 *    same `${parentId}:${slotName}` shape.
 *
 * Selected nodes must be contiguous siblings inside the resolved zone
 * — this matches the Phase 6 plan §12 Q1 default of "single subtree
 * per call". Out-of-order or non-contiguous selections throw, which
 * the caller should treat as a {@link AiErrorCode | APPLY_FAILED}.
 */

import type {
	AiSectionPatch,
	PageIRNode,
} from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

type PuckContentItem = PuckData["content"][number];
type PuckProps = Record<string, unknown>;
type PuckZones = Record<string, PuckContentItem[]>;

const ROOT_ZONE_ALIASES = new Set(["root", "root-zone", ""]);

function isRootZone(zoneId: string): boolean {
	return ROOT_ZONE_ALIASES.has(zoneId);
}

function isPuckContentItem(value: unknown): value is PuckContentItem {
	return (
		typeof value === "object" &&
		value !== null &&
		"props" in (value as object) &&
		typeof (value as { props: unknown }).props === "object" &&
		(value as { props: unknown }).props !== null
	);
}

function getItemId(item: PuckContentItem): string | undefined {
	const props = (item as { props?: PuckProps }).props;
	if (!props) return undefined;
	const id = props.id;
	return typeof id === "string" ? id : undefined;
}

/**
 * Find the start index of a contiguous run of items whose ids match
 * `expectedIds` in order. Returns `-1` when no such run exists.
 */
function findContiguousRun(
	items: readonly PuckContentItem[],
	expectedIds: readonly string[],
): number {
	if (expectedIds.length === 0) return -1;
	outer: for (let i = 0; i <= items.length - expectedIds.length; i++) {
		for (let j = 0; j < expectedIds.length; j++) {
			const item = items[i + j];
			if (!item || getItemId(item) !== expectedIds[j]) {
				continue outer;
			}
		}
		return i;
	}
	return -1;
}

function nodeToPuckContent(
	node: PageIRNode,
	zoneAccumulator: PuckZones,
): PuckContentItem {
	const props: PuckProps = {
		id: node.id,
		...(node.props as PuckProps),
	};

	for (const child of node.children ?? []) {
		const childContent = nodeToPuckContent(child, zoneAccumulator);
		const slotName = child.slot ?? "children";

		if (child.slotKind === "zone") {
			const zoneKey = `${node.id}:${slotName}`;
			zoneAccumulator[zoneKey] = [
				...(zoneAccumulator[zoneKey] ?? []),
				childContent,
			];
			continue;
		}

		const existing = props[slotName];
		props[slotName] = [
			...(Array.isArray(existing) ? (existing as PuckContentItem[]) : []),
			childContent,
		];
	}

	return { type: node.type, props } as PuckContentItem;
}

/**
 * Locate a slot zone (`${parentId}:${slotName}`) inside a component's
 * own props. Returns the slot array and a setter that produces an
 * updated parent props object.
 */
function findSlotInProps(
	parentItem: PuckContentItem,
	slotName: string,
): { items: readonly PuckContentItem[]; setItems: (next: PuckContentItem[]) => PuckContentItem } | null {
	const props = (parentItem as { props?: PuckProps }).props;
	if (!props) return null;
	const value = props[slotName];
	if (!Array.isArray(value)) return null;

	const items = value as PuckContentItem[];
	return {
		items,
		setItems(next) {
			const nextProps: PuckProps = { ...props, [slotName]: next };
			return { ...parentItem, props: nextProps } as PuckContentItem;
		},
	};
}

/**
 * Walk the Puck content tree and replace a slot zone in place, returning
 * the rewritten content array.
 *
 * `mutator` is called with the zone's current items and must return the
 * full replacement array. Returns the rewritten top-level content; the
 * caller is responsible for re-attaching it to `Data`.
 */
function rewriteContentBySlot(
	content: readonly PuckContentItem[],
	parentId: string,
	slotName: string,
	mutator: (items: readonly PuckContentItem[]) => PuckContentItem[],
	visited: { found: boolean },
): PuckContentItem[] {
	return content.map((item) => {
		if (visited.found) return item;
		const id = getItemId(item);
		if (id === parentId) {
			const slot = findSlotInProps(item, slotName);
			if (!slot) return item;
			visited.found = true;
			return slot.setItems(mutator(slot.items));
		}
		// Recurse into any array-valued props that carry slot children.
		const props = (item as { props?: PuckProps }).props;
		if (!props) return item;
		let nextProps: PuckProps | null = null;
		for (const [key, value] of Object.entries(props)) {
			if (visited.found) break;
			if (!Array.isArray(value)) continue;
			if (!value.every(isPuckContentItem)) continue;
			const rewritten = rewriteContentBySlot(
				value as PuckContentItem[],
				parentId,
				slotName,
				mutator,
				visited,
			);
			if (rewritten !== value) {
				if (!nextProps) nextProps = { ...props };
				nextProps[key] = rewritten;
			}
		}
		if (nextProps) {
			return { ...item, props: nextProps } as PuckContentItem;
		}
		return item;
	});
}

/**
 * Apply an {@link AiSectionPatch} to the current Puck `Data`, returning
 * a new snapshot. Throws on any structural mismatch (missing zone,
 * non-contiguous nodeIds, etc.).
 */
export function applySectionPatch(
	currentData: PuckData,
	patch: AiSectionPatch,
): PuckData {
	const newZones: PuckZones = currentData.zones
		? { ...(currentData.zones as PuckZones) }
		: {};

	const replacementContent = patch.replacement.map((node) =>
		nodeToPuckContent(node, newZones),
	);

	if (isRootZone(patch.zoneId)) {
		const content = (currentData.content ?? []) as readonly PuckContentItem[];
		const start = findContiguousRun(content, patch.nodeIds);
		if (start === -1) {
			throw new Error(
				`applySectionPatch: nodeIds not found as a contiguous run in root content (zoneId="${patch.zoneId}").`,
			);
		}
		const newContent: PuckContentItem[] = [
			...content.slice(0, start),
			...replacementContent,
			...content.slice(start + patch.nodeIds.length),
		];
		const next: Record<string, unknown> = {
			...(currentData as unknown as Record<string, unknown>),
			content: newContent,
		};
		if (Object.keys(newZones).length > 0) {
			next.zones = newZones;
		} else {
			delete next.zones;
		}
		return next as PuckData;
	}

	// Legacy data.zones entry — `${parentId}:${slotName}`.
	if (currentData.zones && patch.zoneId in currentData.zones) {
		const items = currentData.zones[patch.zoneId] as PuckContentItem[];
		const start = findContiguousRun(items, patch.nodeIds);
		if (start === -1) {
			throw new Error(
				`applySectionPatch: nodeIds not found as a contiguous run in zone "${patch.zoneId}".`,
			);
		}
		newZones[patch.zoneId] = [
			...items.slice(0, start),
			...replacementContent,
			...items.slice(start + patch.nodeIds.length),
		];
		const next: Record<string, unknown> = {
			...(currentData as unknown as Record<string, unknown>),
			zones: newZones,
		};
		return next as PuckData;
	}

	// Modern slot zone — same `${parentId}:${slotName}` format, but the
	// data lives inside the parent component's own props.
	const colonIndex = patch.zoneId.indexOf(":");
	if (colonIndex > 0) {
		const parentId = patch.zoneId.slice(0, colonIndex);
		const slotName = patch.zoneId.slice(colonIndex + 1);
		const visited = { found: false };
		const newContent = rewriteContentBySlot(
			(currentData.content ?? []) as readonly PuckContentItem[],
			parentId,
			slotName,
			(items) => {
				const start = findContiguousRun(items, patch.nodeIds);
				if (start === -1) {
					throw new Error(
						`applySectionPatch: nodeIds not found as a contiguous run in slot "${patch.zoneId}".`,
					);
				}
				return [
					...items.slice(0, start),
					...replacementContent,
					...items.slice(start + patch.nodeIds.length),
				];
			},
			visited,
		);
		if (visited.found) {
			const next: Record<string, unknown> = {
				...(currentData as unknown as Record<string, unknown>),
				content: newContent,
			};
			if (Object.keys(newZones).length > 0) {
				next.zones = newZones;
			} else {
				delete next.zones;
			}
			return next as PuckData;
		}
	}

	throw new Error(
		`applySectionPatch: zone "${patch.zoneId}" not found in current Puck data.`,
	);
}
