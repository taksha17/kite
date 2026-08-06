import { describe, expect, it } from "vitest";
import {
  decideBackupAction,
  type DriveManifestEntry,
} from "./backup";

function entry(overrides: Partial<DriveManifestEntry> = {}): DriveManifestEntry {
  return {
    companyId: "c1",
    name: "Test Co",
    record: {} as DriveManifestEntry["record"],
    fileId: "f1",
    updatedAt: "2026-08-05T10:00:00.000Z",
    deviceId: "device-a",
    deviceName: "Phone A",
    sizeBytes: 12345,
    ...overrides,
  };
}

describe("decideBackupAction", () => {
  it("uploads freely when no remote snapshot exists", () => {
    expect(
      decideBackupAction(null, { deviceId: "device-a", lastBackupAt: null }),
    ).toBe("upload");
  });

  it("uploads when this device owns the remote snapshot", () => {
    expect(
      decideBackupAction(entry(), {
        deviceId: "device-a",
        lastBackupAt: null,
      }),
    ).toBe("upload");
  });

  it("conflicts when another device wrote a newer snapshot", () => {
    expect(
      decideBackupAction(entry({ deviceId: "device-b" }), {
        deviceId: "device-a",
        lastBackupAt: "2026-08-05T09:00:00.000Z",
      }),
    ).toBe("conflict");
  });

  it("conflicts on a fresh device that never backed up", () => {
    expect(
      decideBackupAction(entry({ deviceId: "device-b" }), {
        deviceId: "device-a",
        lastBackupAt: null,
      }),
    ).toBe("conflict");
  });

  it("uploads when the other device's snapshot is not newer than our last backup", () => {
    expect(
      decideBackupAction(
        entry({ deviceId: "device-b", updatedAt: "2026-08-05T08:00:00.000Z" }),
        { deviceId: "device-a", lastBackupAt: "2026-08-05T09:30:00.000Z" },
      ),
    ).toBe("upload");
  });
});
