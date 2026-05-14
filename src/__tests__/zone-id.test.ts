/**
 * @file Unit tests for `parseZoneId` — the structural parser used by
 * `applySectionPatch` to discriminate root / slot / invalid zone ids
 * before any zone lookup runs (review M1).
 */

import { describe, expect, it } from "vitest";

import { parseZoneId } from "../internal/zone-id.js";

describe("parseZoneId", () => {
	it("treats 'root' as the top-level content zone", () => {
		expect(parseZoneId("root")).toEqual({ kind: "root" });
	});

	it("treats 'root-zone' as the top-level content zone", () => {
		expect(parseZoneId("root-zone")).toEqual({ kind: "root" });
	});

	it("treats the empty string as the top-level content zone (legacy alias)", () => {
		expect(parseZoneId("")).toEqual({ kind: "root" });
	});

	it("parses a well-formed slot zone into parentId and slotName", () => {
		expect(parseZoneId("hero-1:children")).toEqual({
			kind: "slot",
			parentId: "hero-1",
			slotName: "children",
		});
	});

	it("preserves slot names with hyphens and dots", () => {
		expect(parseZoneId("card-1:content.body")).toEqual({
			kind: "slot",
			parentId: "card-1",
			slotName: "content.body",
		});
	});

	it("rejects a leading colon as empty parentId", () => {
		const result = parseZoneId(":children");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/empty parentId/);
		}
	});

	it("rejects a trailing colon as empty slotName", () => {
		const result = parseZoneId("hero-1:");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/empty slotName/);
		}
	});

	it("rejects a double colon (a::b) — slotName contains ':'", () => {
		const result = parseZoneId("a::b");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/slotName contains ":"/);
		}
	});

	it("rejects more than one colon (a:b:c)", () => {
		const result = parseZoneId("a:b:c");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/slotName contains ":"/);
		}
	});

	it("rejects a missing separator", () => {
		const result = parseZoneId("hero-1");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/missing ":" separator/);
		}
	});

	it("only-colon yields empty parentId (the first failure reported)", () => {
		const result = parseZoneId(":");
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/empty parentId/);
		}
	});
});
