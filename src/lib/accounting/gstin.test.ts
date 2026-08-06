import { describe, expect, it } from "vitest";
import {
  assertGstinOrEmpty,
  isValidGstin,
  normalizeGstin,
  stateCodeFromGstin,
} from "./gstin";

describe("gstin", () => {
  it("normalizes case and spaces", () => {
    expect(normalizeGstin(" 29abcde1234f1z5 ")).toBe("29ABCDE1234F1Z5");
  });

  it("accepts well-formed GSTINs", () => {
    expect(isValidGstin("24ABCDE1234F1Z5")).toBe(true);
    expect(isValidGstin("29BBCDE4321G1Z3")).toBe(true);
  });

  it("rejects short or malformed values", () => {
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("29ABCDE")).toBe(false);
    expect(isValidGstin("XXABCDE1234F1Z5")).toBe(false);
    expect(isValidGstin("29ABCDE1234F1A5")).toBe(false); // 14th must be Z
  });

  it("derives state from GSTIN prefix", () => {
    expect(stateCodeFromGstin("24ABCDE1234F1Z5")).toBe("24");
    expect(stateCodeFromGstin("29BBCDE4321G1Z3")).toBe("29");
    expect(stateCodeFromGstin("99XXXXX0000X1Z0")).toBeNull();
  });

  it("assertGstinOrEmpty allows blank and normalizes good values", () => {
    expect(assertGstinOrEmpty("")).toBeUndefined();
    expect(assertGstinOrEmpty(" 24abcde1234f1z5 ")).toBe("24ABCDE1234F1Z5");
    expect(() => assertGstinOrEmpty("bad")).toThrow(/not valid/);
  });
});
