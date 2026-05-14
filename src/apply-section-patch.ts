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
	getItemIdInfo,
	isPuckContentItem,
	MAX_TREE_DEPTH,
	type PuckContentItem,
	type PuckProps,
} from "./internal/puck-spec.js";
import { parseZoneId } from "./internal/zone-id.js";

type PuckZones = Record<string, PuckContentItem[]>;

/**
 * Find the start index of a contiguous run of items whose ids match
 * `expectedIds` in order, plus the diagnostic context the section-patch
 * error formatter needs when no such run exists: the ids/types actually
 * present and the index at which the longest partial match broke off.
 *
 * `start === -1` means "no contiguous run found"; in that case
 * `firstMismatch` is the index of the first expected id that failed to
 * match anywhere in the longest partial run (or `null` when none of the
 * expected ids appear at all).
 */
function findContiguousRun(
	items: readonly PuckContentItem[],
	expectedIds: readonly string[],
): {
	start: number;
	found: readonly string[];
	firstMismatch: number | null;
} {
	const found = collectFoundIds(items);
	if (expectedIds.length === 0) {
		return { start: -1, found, firstMismatch: null };
	}
	let longestPartial = 0;
	let mismatchAt: number | null = null;
	outer: for (let i = 0; i <= items.length - expectedIds.length; i++) {
		for (let j = 0; j < expectedIds.length; j++) {
			const item = items[i + j];
			if (!item || getItemId(item) !== expectedIds[j]) {
				if (j > longestPartial) {
					longestPartial = j;
					mismatchAt = j;
				} else if (mismatchAt === null && j === 0) {
					mismatchAt = 0;
				}
				continue outer;
			}
		}
		return { start: i, found, firstMismatch: null };
	}
	return { start: -1, found, firstMismatch: mismatchAt };
}

/**
 * Collect a human-readable label for each item in a zone, in order. An
 * item with a string `props.id` shows up as the id; one with a
 * non-string id shows up as `<wrong-type:number>` (etc.); one with no
 * id at all shows up as `<no-id>`. Used to enrich the "nodeIds not
 * found" error (review M2, M4).
 */
function collectFoundIds(items: readonly PuckContentItem[]): string[] {
	const labels: string[] = [];
	for (const item of items) {
		const info = getItemIdInfo(item);
		if (info.kind === "ok") {
			labels.push(info.id);
		} else if (info.kind === "wrong-type") {
			labels.push(`<wrong-type:${info.actual}>`);
		} else {
			labels.push("<no-id>");
		}
	}
	return labels;
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

/**
 * Build the section-patch "not found" error. The human-readable prefix
 * preserves the wording that existing tests and host log aggregators
 * key off; a single-line JSON suffix carries the structured context
 * (`expected`, `found`, `firstMismatch`) so a log pipeline can parse
 * the diagnostic without regexing the prose (review M4).
 */
function formatNotFoundError(
	where: string,
	zoneId: string,
	expectedIds: readonly string[],
	run: { found: readonly string[]; firstMismatch: number | null },
): Error {
	const suffix = JSON.stringify({
		expected: expectedIds,
		found: run.found,
		firstMismatch: run.firstMismatch,
	});
	return new Error(
		`applySectionPatch: nodeIds [${expectedIds.join(", ")}] not found as a contiguous run in ${where} (zoneId="${zoneId}"). ${suffix}`,
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
	const parsed = parseZoneId(patch.zoneId);
	if (parsed.kind === "invalid") {
		throw new Error(
			`applySectionPatch: invalid zoneId format "${patch.zoneId}" — ${parsed.reason}. Expected "root", "root-zone", or "<parentId>:<slotName>".`,
		);
	}

	const newZones: PuckZones = currentData.zones
		? { ...(currentData.zones as PuckZones) }
		: {};

	const replacementContent = patch.replacement.map((node) =>
		nodeToPuckContent(node, newZones),
	);

	if (parsed.kind === "root") {
		const content = (currentData.content ?? []) as readonly PuckContentItem[];
		const run = findContiguousRun(content, patch.nodeIds);
		if (run.start === -1) {
			throw formatNotFoundError(
				"root content",
				patch.zoneId,
				patch.nodeIds,
				run,
			);
		}
		const newContent: PuckContentItem[] = [
			...content.slice(0, run.start),
			...replacementContent,
			...content.slice(run.start + patch.nodeIds.length),
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
		const run = findContiguousRun(items, patch.nodeIds);
		if (run.start === -1) {
			throw formatNotFoundError(
				`zone "${patch.zoneId}"`,
				patch.zoneId,
				patch.nodeIds,
				run,
			);
		}
		newZones[patch.zoneId] = [
			...items.slice(0, run.start),
			...replacementContent,
			...items.slice(run.start + patch.nodeIds.length),
		];
		const { zones: _existingZones, ...rest } = currentData;
		const next: PuckData = {
			...rest,
			zones: newZones,
		};
		return next;
	}

	// Modern slot zone — same `${parentId}:${slotName}` format, but the
	// data lives inside the parent component's own props.
	const { parentId, slotName } = parsed;
	const visited = { found: false };
	let notFound: Error | null = null;
	const newContent = rewriteContentBySlot(
		(currentData.content ?? []) as readonly PuckContentItem[],
		parentId,
		slotName,
		(items) => {
			const run = findContiguousRun(items, patch.nodeIds);
			if (run.start === -1) {
				notFound = formatNotFoundError(
					`slot "${patch.zoneId}"`,
					patch.zoneId,
					patch.nodeIds,
					run,
				);
				return items as PuckContentItem[];
			}
			return [
				...items.slice(0, run.start),
				...replacementContent,
				...items.slice(run.start + patch.nodeIds.length),
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
