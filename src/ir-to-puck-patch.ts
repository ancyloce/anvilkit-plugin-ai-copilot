import type { PageIR } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";

/**
 * Convert a validated {@link PageIR} document back into the minimal
 * Puck `Data` shape required by `dispatch({ type: "setData" })`.
 *
 * This is a local copy of the shared `irToPuckData()` logic on
 * purpose: phase3-012 keeps the heavier IR package out of the plugin's runtime
 * dependency graph so the AI copilot package stays smaller and its
 * trust boundary remains explicit.
 */
export function irToPuckPatch(ir: PageIR): PuckData {
	const content = (ir.root.children ?? []).map((child) => ({
		type: child.type,
		props: {
			id: child.id,
			...(child.props as Record<string, unknown>),
		},
	}));

	const rootProps = ir.root.props as Record<string, unknown>;
	const hasRootProps = Object.keys(rootProps).length > 0;

	const root: Record<string, unknown> = {};
	if (hasRootProps) {
		root.props = { ...rootProps };
	}

	return {
		root,
		content,
	} as PuckData;
}
