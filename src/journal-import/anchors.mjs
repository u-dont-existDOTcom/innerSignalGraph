import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { resolveExactQuote } from "./contracts.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

export function resolveUnitQuote(units, { unit_id: unitId, quote, occurrence = null }) {
  invariant(Array.isArray(units), "UNITS_INVALID");
  const unit = units.find((candidate) => candidate.unit_id === unitId);
  invariant(unit, "ANCHOR_UNIT_NOT_FOUND");
  const local = resolveExactQuote(unit.text, quote, occurrence);
  const quoteBytes = Buffer.from(quote, "utf8");
  return Object.freeze({
    anchor_kind: "exact_quote",
    unit_id: unitId,
    representation_id: unit.representation_id,
    start_byte: unit.start_byte + local.start_byte,
    end_byte: unit.start_byte + local.end_byte,
    quote,
    quote_sha256: sha256(quoteBytes),
    occurrence
  });
}

export function createRestrictedSourcePointer({ unitId, regionId = null, nonGraphicStatement, reviewState = "unreviewed" }) {
  invariant(typeof unitId === "string" && unitId.length > 0, "RESTRICTED_UNIT_INVALID");
  invariant(typeof nonGraphicStatement === "string" && nonGraphicStatement.length > 0, "RESTRICTED_STATEMENT_INVALID");
  invariant(["unreviewed", "source_checked", "independent_checked", "disputed"].includes(reviewState), "RESTRICTED_REVIEW_STATE_INVALID");
  return Object.freeze({
    anchor_kind: "restricted_source_pointer",
    unit_id: unitId,
    region_id: regionId,
    disclosure: "restricted",
    non_graphic_statement: nonGraphicStatement,
    review_state: reviewState
  });
}
