import type { PageIR } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

type PuckContentItem = PuckData["content"][number];
type SlotKind = "slot" | "zone";
type PageIRNodeWithSlots = PageIR["root"] & {
	readonly slot?: string;
	readonly slotKind?: SlotKind;
	readonly children?: readonly PageIRNodeWithSlots[];
};

const DEFAULT_NESTED_SLOT = "children";

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
			const slotName = child.slot ?? DEFAULT_NESTED_SLOT;

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
			const zoneKey = `root:${child.slot}`;
			zones[zoneKey] = [...(zones[zoneKey] ?? []), childContent];
			continue;
		}

		if (child.slot) {
			appendSlotContent(rootProps, child.slot, childContent);
			continue;
		}

		content.push(childContent);
	}

	const root: Record<string, unknown> = {};
	if (Object.keys(rootProps).length > 0) {
		root.props = rootProps;
	}

	return {
		root,
		content,
		...(Object.keys(zones).length > 0 ? { zones } : {}),
	} as PuckData;
}
