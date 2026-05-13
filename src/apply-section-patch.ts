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

import type { AiSectionPatch, PageIRNode } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

import {
	DEFAULT_SLOT_NAME,
	getItemId,
	isPuckContentItem,
	MAX_TREE_DEPTH,
	type PuckContentItem,
	type PuckProps,
} from "./internal/puck-spec.js";

type PuckZones = Record<string, PuckContentItem[]>;

const ROOT_ZONE_ALIASES = new Set(["root", "root-zone", ""]);
const ZONE_ID_PATTERN = /^[^:]+:[^:]+$/;

function isRootZone(zoneId: string): boolean {
	return ROOT_ZONE_ALIASES.has(zoneId);
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

/**
 * Collect the string ids actually present in a zone, in order. Used to
 * enrich the "nodeIds not found" error so a host UI can surface the
 * diff without reaching for the canvas itself (review M2, M4).
 */
function collectPresentIds(items: readonly PuckContentItem[]): string[] {
	const ids: string[] = [];
	for (const item of items) {
		const id = getItemId(item);
		if (id) ids.push(id);
	}
	return ids;
}

function nodeToPuckContent(
	node: PageIRNode,
	zoneAccumulator: PuckZones,
	depth = 0,
): PuckContentItem {
	if (depth > MAX_TREE_DEPTH) {
		throw new Error(
			`applySectionPatch: replacement tree depth exceeded ${MAX_TREE_DEPTH}`,
		);
	}

	const props: PuckProps = {
		id: node.id,
		...(node.props as PuckProps),
	};

	for (const child of node.children ?? []) {
		const childContent = nodeToPuckContent(child, zoneAccumulator, depth + 1);
		const slotName = child.slot ?? DEFAULT_SLOT_NAME;

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
): {
	items: readonly PuckContentItem[];
	setItems: (next: PuckContentItem[]) => PuckContentItem;
} | null {
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
 *
 * Depth-bounded (MAX_TREE_DEPTH) and cycle-protected (WeakSet) so a
 * pathological or accidentally-cyclic Puck tree throws a clear error
 * instead of stack-overflowing (review H2).
 */
function rewriteContentBySlot(
	content: readonly PuckContentItem[],
	parentId: string,
	slotName: string,
	mutator: (items: readonly PuckContentItem[]) => PuckContentItem[],
	visited: { found: boolean },
	depth: number,
	seen: WeakSet<PuckContentItem>,
): PuckContentItem[] {
	if (depth > MAX_TREE_DEPTH) {
		throw new Error(
			`applySectionPatch: Puck tree depth exceeded ${MAX_TREE_DEPTH} while resolving slot "${parentId}:${slotName}"`,
		);
	}

	return content.map((item) => {
		if (visited.found) return item;
		if (seen.has(item)) return item;
		seen.add(item);

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
				depth + 1,
				seen,
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

function formatNotFoundError(
	where: string,
	zoneId: string,
	expectedIds: readonly string[],
	presentIds: readonly string[],
): Error {
	return new Error(
		`applySectionPatch: nodeIds [${expectedIds.join(", ")}] not found as a contiguous run in ${where} (zoneId="${zoneId}"). Ids present: [${presentIds.join(", ")}].`,
	);
}

/**
 * Apply an {@link AiSectionPatch} to the current Puck `Data`, returning
 * a new snapshot. Throws on any structural mismatch (missing zone,
 * non-contiguous nodeIds, invalid zoneId format, cyclic tree, etc.).
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
			throw formatNotFoundError(
				"root content",
				patch.zoneId,
				patch.nodeIds,
				collectPresentIds(content),
			);
		}
		const newContent: PuckContentItem[] = [
			...content.slice(0, start),
			...replacementContent,
			...content.slice(start + patch.nodeIds.length),
		];
		const { zones: _existingZones, ...rest } = currentData;
		const next: PuckData = {
			...rest,
			content: newContent,
			...(Object.keys(newZones).length > 0 ? { zones: newZones } : {}),
		};
		return next;
	}

	// Legacy data.zones entry — `${parentId}:${slotName}`.
	if (currentData.zones && patch.zoneId in currentData.zones) {
		const items = currentData.zones[patch.zoneId] as PuckContentItem[];
		const start = findContiguousRun(items, patch.nodeIds);
		if (start === -1) {
			throw formatNotFoundError(
				`zone "${patch.zoneId}"`,
				patch.zoneId,
				patch.nodeIds,
				collectPresentIds(items),
			);
		}
		newZones[patch.zoneId] = [
			...items.slice(0, start),
			...replacementContent,
			...items.slice(start + patch.nodeIds.length),
		];
		const { zones: _existingZones, ...rest } = currentData;
		const next: PuckData = {
			...rest,
			zones: newZones,
		};
		return next;
	}

	// Modern slot zone — same `${parentId}:${slotName}` format, but the
	// data lives inside the parent component's own props. Reject empty
	// prefix / empty suffix / extra colons up front so we surface a
	// structural error instead of a vague "zone not found" (review M1).
	if (ZONE_ID_PATTERN.test(patch.zoneId)) {
		const colonIndex = patch.zoneId.indexOf(":");
		const parentId = patch.zoneId.slice(0, colonIndex);
		const slotName = patch.zoneId.slice(colonIndex + 1);
		const visited = { found: false };
		let notFound: Error | null = null;
		const newContent = rewriteContentBySlot(
			(currentData.content ?? []) as readonly PuckContentItem[],
			parentId,
			slotName,
			(items) => {
				const start = findContiguousRun(items, patch.nodeIds);
				if (start === -1) {
					notFound = formatNotFoundError(
						`slot "${patch.zoneId}"`,
						patch.zoneId,
						patch.nodeIds,
						collectPresentIds(items),
					);
					return items as PuckContentItem[];
				}
				return [
					...items.slice(0, start),
					...replacementContent,
					...items.slice(start + patch.nodeIds.length),
				];
			},
			visited,
			0,
			new WeakSet<PuckContentItem>(),
		);
		if (notFound) throw notFound;
		if (visited.found) {
			const { zones: _existingZones, ...rest } = currentData;
			const next: PuckData = {
				...rest,
				content: newContent,
				...(Object.keys(newZones).length > 0 ? { zones: newZones } : {}),
			};
			return next;
		}
		throw new Error(
			`applySectionPatch: zone "${patch.zoneId}" not found in current Puck data.`,
		);
	}

	throw new Error(
		`applySectionPatch: invalid zoneId format "${patch.zoneId}" — expected "root", "root-zone", or "<parentId>:<slotName>".`,
	);
}
