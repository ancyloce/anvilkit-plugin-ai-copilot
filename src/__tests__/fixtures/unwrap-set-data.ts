/**
 * @file Test helper mirroring Puck's `setData` reducer branch.
 *
 * The plugin dispatches `{ type: "setData", data: () => next }` (the
 * functional form) so Puck takes its non-warning code path. Puck's
 * reducer resolves the thunk against the previous data; these mocks
 * must do the same to stay faithful.
 */

import type { Data as PuckData } from "@puckeditor/core";

type SetDataPayload = PuckData | ((previous: PuckData) => PuckData);

export function unwrapSetData(
	data: SetDataPayload,
	previous: PuckData,
): PuckData {
	return typeof data === "function" ? data(previous) : data;
}
