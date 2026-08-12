import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "../src/core/json.mjs";

 test("parseModelJson accepts fenced JSON", () => {
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });
});

test("parseModelJson extracts the first balanced object", () => {
  assert.deepEqual(parseModelJson('preface {"ok":true,"nested":{"x":1}} tail'), {
    ok: true,
    nested: { x: 1 }
  });
});
