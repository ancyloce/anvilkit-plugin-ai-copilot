import type { PageIR } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

import { DEFAULT_SLOT_NAME, ROOT_ZONE_ID } from "./internal/puck-spec.js";

type PuckContentItem = PuckData["content"][number];
type SlotKind = "slot" | "zone";
type PageIRNodeWithSlots = PageIR["root"] & {
	readonly slot?: string;
	readonly slotKind?: SlotKind;
	readonly children?: readonly PageIRNodeWithSlots[];
};

function appendSlotContent(
	props: Record<string, unknown>,
	slotName: string,
	content: PuckContentItem,
): void {
	const existing = props[slotName];
	props[slotName] = [
		...(Array.isArray(existing) ? (existing as PuckContentItem[]) : []),
		content,
	];
}

/**
 * Convert a validated {@link PageIR} document back into the Puck `Data`
 * shape required by `dispatch({ type: "setData" })`.
 *
 * This is a local copy of the shared `irToPuckData()` logic on
 * purpose: phase3-012 keeps the heavier IR package out of the plugin's runtime
 * dependency graph so the AI copilot package stays smaller and its
 * trust boundary remains explicit.
 */
export function irToPuckPatch(ir: PageIR): PuckData {
	const zones: Record<string, PuckContentItem[]> = {};

	function nodeToContent(node: PageIRNodeWithSlots): PuckContentItem {
		const props: Record<string, unknown> = {
			id: node.id,
			...(node.props as Record<string, unknown>),
		};

		for (const child of node.children ?? []) {
			const childContent = nodeToContent(child);
			const slotName = child.slot ?? DEFAULT_SLOT_NAME;

			if (child.slotKind === "zone") {
				const zoneKey = `${node.id}:${slotName}`;
				zones[zoneKey] = [...(zones[zoneKey] ?? []), childContent];
				continue;
			}

			appendSlotContent(props, slotName, childContent);
		}

		return {
			type: node.type,
			props,
		} as PuckContentItem;
	}

	const content: PuckContentItem[] = [];
	const rootProps: Record<string, unknown> = {
		...(ir.root.props as Record<string, unknown>),
	};
	const rootNode = ir.root as PageIRNodeWithSlots;

	for (const child of rootNode.children ?? []) {
		const childContent = nodeToContent(child);

		if (child.slotKind === "zone" && child.slot) {
			const zoneKey = `${ROOT_ZONE_ID}:${child.slot}`;
			zones[zoneKey] = [...(zones[zoneKey] ?? []), childContent];
			continue;
		}

		if (child.slot) {
			appendSlotContent(rootProps, child.slot, childContent);
			continue;
		}

		content.push(childContent);
	}

	// Return a *complete* Puck `Data` snapshot. Puck's `setData` reducer
	// (both object and functional forms) shallow-merges the payload over
	// the existing `state.data` and `walkAppState` re-emits any
	// `state.data.zones` it finds. A page generation is a full replace
	// with no prior state to preserve, so `zones` must be materialized
	// (empty `{}` when none) to overwrite stale ghost zones from the
	// pre-generation page, and `root` must always carry its `props`
	// wrapper. Omitting either lets the collab outbound IR carry ghost
	// zones / a stale root, which is why AI-generated pages failed to
	// sync to other collaborators.
	return {
		root: { props: rootProps },
		content,
		zones,
	} as PuckData;
}
