import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_GRAPH_CONTRACT } from "./contracts.mjs";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const defaults = JOURNAL_GRAPH_CONTRACT.source_defaults;
const continuation = (byte) => (byte & 0xc0) === 0x80;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function boundaryAtOrBefore(bytes, offset, lowerBound) {
  let cursor = Math.min(offset, bytes.length);
  while (cursor > lowerBound && cursor < bytes.length && continuation(bytes[cursor])) cursor -= 1;
  return cursor;
}

function boundaryAtOrAfter(bytes, offset) {
  let cursor = Math.max(0, offset);
  while (cursor < bytes.length && continuation(bytes[cursor])) cursor += 1;
  return cursor;
}

function preferredEnd(bytes, start, targetBytes, maximumBytes) {
  const hardEnd = boundaryAtOrBefore(bytes, Math.min(bytes.length, start + maximumBytes), start);
  if (hardEnd === bytes.length) return hardEnd;
  const target = Math.min(hardEnd, start + targetBytes);
  const delimiters = [Buffer.from("\n\n", "utf8"), Buffer.from("\n", "utf8")];
  for (const delimiter of delimiters) {
    const after = bytes.indexOf(delimiter, target);
    if (after >= target && after + delimiter.length <= hardEnd) return after + delimiter.length;
  }
  for (const delimiter of delimiters) {
    const before = bytes.lastIndexOf(delimiter, target);
    if (before >= start + Math.floor(targetBytes / 2)) return before + delimiter.length;
  }
  return hardEnd;
}

export function partitionRepresentation({
  representationId,
  text,
  targetBytes = defaults.core_target_utf8_bytes,
  maximumBytes = defaults.core_max_utf8_bytes,
  contextEachSideBytes = defaults.context_each_side_utf8_bytes
}) {
  invariant(typeof representationId === "string" && representationId.length > 0, "REPRESENTATION_ID_INVALID");
  invariant(typeof text === "string" && text.isWellFormed(), "REPRESENTATION_TEXT_INVALID");
  invariant(Number.isSafeInteger(targetBytes) && targetBytes > 0, "PARTITION_TARGET_INVALID");
  invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= targetBytes, "PARTITION_MAXIMUM_INVALID");
  invariant(Number.isSafeInteger(contextEachSideBytes) && contextEachSideBytes >= 0, "PARTITION_CONTEXT_INVALID");
  const bytes = Buffer.from(text, "utf8");
  const units = [];
  for (let start = 0; start < bytes.length;) {
    const end = preferredEnd(bytes, start, targetBytes, maximumBytes);
    invariant(end > start && end - start <= maximumBytes, "PARTITION_BOUNDARY_INVALID");
    const core = bytes.subarray(start, end);
    const digest = sha256(core);
    units.push({
      unit_id: `unit:${sha256(Buffer.from(`${representationId}\0${start}\0${end}\0${digest}`, "utf8")).slice(0, 32)}`,
      representation_id: representationId,
      start_byte: start,
      end_byte: end,
      utf8_byte_length: core.byteLength,
      sha256: digest,
      text: utf8.decode(core)
    });
    start = end;
  }
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const contextStart = boundaryAtOrAfter(bytes, Math.max(0, unit.start_byte - contextEachSideBytes));
    const contextEnd = boundaryAtOrBefore(bytes, Math.min(bytes.length, unit.end_byte + contextEachSideBytes), unit.end_byte);
    unit.context = {
      before_start_byte: contextStart,
      before_end_byte: unit.start_byte,
      after_start_byte: unit.end_byte,
      after_end_byte: contextEnd,
      before: utf8.decode(bytes.subarray(contextStart, unit.start_byte)),
      after: utf8.decode(bytes.subarray(unit.end_byte, contextEnd))
    };
    Object.freeze(unit.context);
    Object.freeze(unit);
  }
  return Object.freeze(units);
}

export function verifyRepresentationCoverage(text, units) {
  invariant(typeof text === "string" && text.isWellFormed() && Array.isArray(units), "COVERAGE_INPUT_INVALID");
  const bytes = Buffer.from(text, "utf8");
  let cursor = 0;
  for (const unit of units) {
    invariant(unit.start_byte === cursor && unit.end_byte > cursor && unit.end_byte <= bytes.length, "COVERAGE_GAP_OR_OVERLAP");
    const core = bytes.subarray(unit.start_byte, unit.end_byte);
    invariant(core.byteLength === unit.utf8_byte_length && sha256(core) === unit.sha256 && utf8.decode(core) === unit.text, "COVERAGE_BYTES_CHANGED");
    cursor = unit.end_byte;
  }
  invariant(cursor === bytes.length, "COVERAGE_INCOMPLETE");
  return Object.freeze({ byte_length: bytes.length, unit_count: units.length, complete: true });
}
