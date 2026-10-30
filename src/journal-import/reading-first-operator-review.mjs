import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { writeReviewFile } from "./pointer-examples.mjs";

// The authorized review route of the reading-first importer (spec 2026-10-18, "Authorized review route (28 Oct 2026)").
// A page the source reader cannot read (an image, an empty page, a refusal, a model that does not answer) can be reviewed by
// an authorized human or model that is given the page's source. That review is a bundle in the operator's private review
// directory. This module only reads and checks the bundle's shape; the producer checks each review against its page, and
// only the runtime's own key attests the receipts that follow.

export const OPERATOR_REVIEW_ROUTE = "authorized_operator_review";
export const OPERATOR_REVIEW_FILE = "reading-first-reviews.json";
export const OPERATOR_WORKLIST_FILE = "reading-first-review-worklist.json";
export const OPERATOR_REVIEW_MAX_BYTES = 32 * 1024 * 1024;

const HEX64 = /^[a-f0-9]{64}$/u;
const MODALITIES = Object.freeze(["text", "image", "text+image"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const refuse = (code) => new ValidationError(code, { code });
const invalid = () => refuse("JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID");
const check = (ok) => { if (!ok) throw invalid(); };
// A reviewer or authorization is a name, never just space.
const label = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const exactKeys = (value, required, optional = []) => isObject(value)
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  && required.every((key) => Object.hasOwn(value, key));

/** JSON with every object's keys in sorted order, so the same review always hashes the same. */
export function canonicalJson(value) {
  const sorted = (item) => {
    if (Array.isArray(item)) return item.map(sorted);
    if (isObject(item)) return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sorted(item[key])]));
    return item;
  };
  return JSON.stringify(sorted(value));
}

// An anchor and a finding have the shapes the source reader gives (schemas/journal-import/source-reading-result.schema.json,
// and the offsets the producer's check also accepts), with the reader's bounds.
function checkAnchor(anchor) {
  check(exactKeys(anchor, ["exact_text"], ["occurrence", "start", "end"]));
  check(typeof anchor.exact_text === "string" && anchor.exact_text.length >= 1 && anchor.exact_text.length <= 1200);
  if (Object.hasOwn(anchor, "start") || Object.hasOwn(anchor, "end")) {
    check(!Object.hasOwn(anchor, "occurrence") && Number.isSafeInteger(anchor.start) && Number.isSafeInteger(anchor.end)
      && anchor.start >= 0 && anchor.end > anchor.start);
  } else {
    check(Object.hasOwn(anchor, "occurrence")
      && (anchor.occurrence === null || (Number.isSafeInteger(anchor.occurrence) && anchor.occurrence >= 0)));
  }
}
function checkFinding(finding, anchorCount) {
  check(exactKeys(finding, ["statement", "required_qualifiers", "anchor_indices"]));
  check(label(finding.statement, 4000));
  check(Array.isArray(finding.required_qualifiers) && finding.required_qualifiers.length <= 20
    && finding.required_qualifiers.every((item) => typeof item === "string" && item.length <= 1000));
  check(Array.isArray(finding.anchor_indices) && finding.anchor_indices.length >= 1 && finding.anchor_indices.length <= 10
    && new Set(finding.anchor_indices).size === finding.anchor_indices.length
    && finding.anchor_indices.every((index) => Number.isSafeInteger(index) && index >= 0 && index < anchorCount));
}

function checkReview(review, pageCount) {
  check(exactKeys(review, ["page", "source_page_sha256", "reviewed_modalities", "source_read_complete",
    "source_specific_understanding", "exact_source_anchors", "source_findings"], ["image_content_reviewed", "reviewer"]));
  check(Number.isSafeInteger(review.page) && review.page >= 1 && review.page <= pageCount);
  check(typeof review.source_page_sha256 === "string" && HEX64.test(review.source_page_sha256));
  check(MODALITIES.includes(review.reviewed_modalities) && review.source_read_complete === true);
  // The picture was looked at exactly when the page has one to look at, and the review says so.
  if (review.reviewed_modalities.includes("image")) check(review.image_content_reviewed === true);
  else check(!Object.hasOwn(review, "image_content_reviewed"));
  if (Object.hasOwn(review, "reviewer")) check(label(review.reviewer, 200));
  check(label(review.source_specific_understanding, 2500));
  check(Array.isArray(review.exact_source_anchors) && review.exact_source_anchors.length <= 25);
  review.exact_source_anchors.forEach(checkAnchor);
  check(Array.isArray(review.source_findings) && review.source_findings.length <= 30);
  review.source_findings.forEach((finding) => checkFinding(finding, review.exact_source_anchors.length));
}

/**
 * The bundle's shape, checked strictly (a key it does not name is refused at every level) and bound to this source. Nothing
 * here looks at a page; the producer checks each review against the page it names. The error carries a code and nothing
 * about the review: no page number and no text. Returns each review with its own digest, the hash of that one review's
 * canonical JSON, so adding a review for another page never changes a page already persisted, and the reviewer it names or
 * else the bundle's.
 */
export function validateOperatorReviewBundle(bundle, { sourceSha256, pageCount }) {
  check(Number.isSafeInteger(pageCount) && pageCount > 0 && HEX64.test(sourceSha256 ?? ""));
  check(exactKeys(bundle, ["schema_version", "source_sha256", "reviewer", "authorization_ref", "reviews"]));
  check(bundle.schema_version === 1 && bundle.source_sha256 === sourceSha256);
  check(label(bundle.reviewer, 200) && label(bundle.authorization_ref, 320));
  check(Array.isArray(bundle.reviews) && bundle.reviews.length <= pageCount);
  const pages = new Set();
  const reviews = bundle.reviews.map((review) => {
    checkReview(review, pageCount);
    check(!pages.has(review.page));
    pages.add(review.page);
    const entry = structuredClone(review);
    return Object.freeze({ page: entry.page, entry, reviewer: entry.reviewer ?? bundle.reviewer,
      review_sha256: createHash("sha256").update(canonicalJson(entry)).digest("hex") });
  });
  return Object.freeze({ reviewer: bundle.reviewer, authorization_ref: bundle.authorization_ref, reviews });
}

/**
 * The parsed bundle in the operator's review directory, or null when there is none. The directory is checked by the caller
 * (checkReviewDirectory). The file is opened without following a link and read through that one handle: a regular file only
 * its owner can open, no larger than OPERATOR_REVIEW_MAX_BYTES, holding JSON.
 */
export async function readOperatorReviewBundle(dir) {
  let bytes;
  try {
    bytes = await withOpenedRegularFile(path.join(dir, OPERATOR_REVIEW_FILE), async (handle, info) => {
      if ((info.mode & 0o077) !== 0 || info.size > OPERATOR_REVIEW_MAX_BYTES) throw refuse("JOURNAL_READING_FIRST_OPERATOR_REVIEW_FILE_UNSAFE");
      return handle.readFile();
    });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP" || error?.code === "ERR_NOT_REGULAR_FILE") throw refuse("JOURNAL_READING_FIRST_OPERATOR_REVIEW_FILE_UNSAFE");
    throw error;
  }
  try {
    check(bytes.length <= OPERATOR_REVIEW_MAX_BYTES);
    const parsed = JSON.parse(bytes.toString("utf8"));
    // A file that holds `null` is a bundle that is not one. `null` is how this function says there is no file, and a bundle
    // that is there must be checked, not mistaken for the absence of one.
    check(parsed !== null);
    return parsed;
  } catch (error) {
    throw error?.code === "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID" ? error : invalid();
  } finally { bytes.fill(0); }
}

/**
 * The worklist of pages still waiting for a review, written into the operator's review directory (checked earlier, `verified`
 * from checkReviewDirectory): a new owner-only file under a name of its own, then renamed over the last worklist, so a reader
 * sees the old one or the new one whole and never follows a link at the final name. It holds the importer's exact page text.
 */
export async function writeOperatorWorklist({ dir, verified, worklist }) {
  const temporary = `${OPERATOR_WORKLIST_FILE}.${randomBytes(6).toString("hex")}.tmp`;
  await writeReviewFile({ dir, name: temporary, verified, content: `${JSON.stringify(worklist, null, 2)}\n` });
  try { await fs.rename(path.join(dir, temporary), path.join(dir, OPERATOR_WORKLIST_FILE)); }
  catch (error) {
    await fs.unlink(path.join(dir, temporary)).catch(() => {});
    throw error;
  }
  const directory = await fs.open(dir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Takes the worklist away once nothing waits for review: it holds journal text and is out of date. Best effort. */
export async function removeOperatorWorklist(dir) {
  await fs.unlink(path.join(dir, OPERATOR_WORKLIST_FILE)).catch(() => {});
}
