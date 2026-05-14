/**
 * @file Structural parser for the AI section-patch `zoneId` string.
 *
 * `zoneId` is the only piece of `AiSectionPatch` that isn't a type-checked
 * union — it travels as a free string and is parsed at apply time. This
 * module centralizes the parsing so `applySectionPatch` can pattern-match
 * on a discriminated result instead of re-doing the regex + `indexOf`
 * dance in-line, and so the rejection reasons surface to the caller as
 * structured data instead of a generic "zone not found" error
 * (review M1).
 *
 * Accepted shapes:
 *
 * - `"root"` / `"root-zone"` / `""` → the Puck top-level content array.
 *   The empty-string alias matches Puck's historical naming for the root
 *   zone; we preserve it for compatibility.
 * - `"<parentId>:<slotName>"` → either a legacy `data.zones` entry or a
 *   modern slot field on a component's props. Both halves must be
 *   non-empty and neither may contain a `:` (so `a::b` and `:b` and
 *   `a:` are all rejected).
 *
 * Anything else returns a tagged `invalid` result with a precise
 * `reason` string suitable for an error message.
 */

export type ParsedZoneId =
	| { kind: "root" }
	| { kind: "slot"; parentId: string; slotName: string }
	| { kind: "invalid"; reason: string };

const ROOT_ZONE_ALIASES = new Set(["root", "root-zone", ""]);

export function parseZoneId(zoneId: string): ParsedZoneId {
	if (ROOT_ZONE_ALIASES.has(zoneId)) {
		return { kind: "root" };
	}

	const colonIndex = zoneId.indexOf(":");
	if (colonIndex === -1) {
		return {
			kind: "invalid",
			reason: `missing ":" separator (expected "<parentId>:<slotName>")`,
		};
	}

	const parentId = zoneId.slice(0, colonIndex);
	const slotName = zoneId.slice(colonIndex + 1);

	if (parentId === "") {
		return { kind: "invalid", reason: 'empty parentId before ":"' };
	}
	if (slotName === "") {
		return { kind: "invalid", reason: 'empty slotName after ":"' };
	}
	if (slotName.includes(":")) {
		// Catches `a::b` and `a:b:c`. Puck slot names are simple
		// identifiers; an extra `:` is almost certainly a malformed
		// patch from upstream rather than a legitimate slot name.
		return {
			kind: "invalid",
			reason: `slotName contains ":" (got "${slotName}")`,
		};
	}

	return { kind: "slot", parentId, slotName };
}
