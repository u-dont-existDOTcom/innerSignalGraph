import test from "node:test";
import assert from "node:assert/strict";
import { createStoredZip } from "../src/core/zip.mjs";

test("stored ZIP timestamps are UTC and independent of the host timezone", () => {
  const originalTimezone = process.env.TZ;
  const entries = [{ name: "payload.txt", data: Buffer.from("same payload", "utf8") }];
  const instant = new Date("2026-08-11T19:30:00.000Z");

  try {
    process.env.TZ = "Europe/Lisbon";
    const lisbon = createStoredZip(entries, instant);
    process.env.TZ = "UTC";
    const utc = createStoredZip(entries, instant);

    assert.deepEqual(lisbon, utc);
    const dosTime = utc.readUInt16LE(10);
    assert.equal((dosTime >>> 11) & 0x1f, 19);
    assert.equal((dosTime >>> 5) & 0x3f, 30);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
