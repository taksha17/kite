import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./crypto";
import { can } from "./permissions";

describe("permissions", () => {
  it("gives owner user management", () => {
    expect(can("owner", "manage_users")).toBe(true);
    expect(can("accountant", "manage_users")).toBe(false);
    expect(can("data_entry", "manage_ledgers")).toBe(false);
    expect(can("data_entry", "create_voucher")).toBe(true);
  });
});

describe("password hashing", () => {
  it("verifies matching passwords", async () => {
    const encoded = await hashPassword("kite-secret");
    expect(await verifyPassword("kite-secret", encoded)).toBe(true);
    expect(await verifyPassword("wrong", encoded)).toBe(false);
  });
});
