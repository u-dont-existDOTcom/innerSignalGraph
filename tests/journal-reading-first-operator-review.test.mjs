import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OPERATOR_REVIEW_FILE, OPERATOR_REVIEW_MAX_BYTES, OPERATOR_WORKLIST_FILE, canonicalJson, readOperatorReviewBundle,
  removeOperatorWorklist, validateOperatorReviewBundle, writeOperatorWorklist
} from "../src/journal-import/reading-first-operator-review.mjs";
import { checkReviewDirectory } from "../src/journal-import/pointer-examples.mjs";
import { journalOperatorReadPages, journalReplacedPublication } from "../src/journal-import/run-config.mjs";

// The operator's review bundle and worklist, and the run-config settings of the authorized review route. Everything here is
// invented.

const INVALID = "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID";
const UNSAFE = "JOURNAL_READING_FIRST_OPERATOR_REVIEW_FILE_UNSAFE";
const SOURCE = "a".repeat(64);
const PAGE = "b".repeat(64);
const sha = (text) => createHash("sha256").update(text).digest("hex");

const review = (page, extra = {}) => ({
  page, source_page_sha256: PAGE, reviewed_modalities: "text", source_read_complete: true,
  source_specific_understanding: "A reviewer read the page and described what it says.",
  exact_source_anchors: [{ exact_text: "An invented sentence.", occurrence: null }],
  source_findings: [{ statement: "The author reports something.", required_qualifiers: [], anchor_indices: [0] }],
  ...extra
});
const bundle = (reviews = [review(1)], extra = {}) => ({
  schema_version: 1, source_sha256: SOURCE, reviewer: "Synthetic Reviewer", authorization_ref: "synthetic:authorization:1", reviews, ...extra
});
const validate = (value, pageCount = 3) => validateOperatorReviewBundle(value, { sourceSha256: SOURCE, pageCount });
const refuses = (value, pageCount, label = "") => assert.throws(() => validate(value, pageCount), (error) => {
  assert.equal(error.code, INVALID, label);
  // The error is a code and nothing else: no page, no digest, no text.
  assert.equal(error.message, INVALID, label);
  return true;
}, label);

async function privateDirectory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-operator-review-"));
  await fs.chmod(dir, 0o700);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("canonical JSON puts every object's keys in order, so the same review always has the same bytes", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson(review(1)), canonicalJson(Object.fromEntries(Object.entries(review(1)).reverse())));
});

test("a review bundle is accepted only in its exact shape, and the error names nothing about the bundle", () => {
  const accepted = validate(bundle([review(1), review(3, { reviewed_modalities: "text+image", image_content_reviewed: true })]));
  assert.deepEqual(accepted.reviews.map((item) => item.page), [1, 3]);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(validate(bundle([])).reviews.length, 0, "a bundle with no review is a bundle");

  // A key the schema does not name is refused at every level.
  refuses(bundle([review(1)], { note: "anything" }), 3, "bundle level");
  refuses(bundle([review(1, { note: "anything" })]), 3, "review level");
  refuses(bundle([review(1, { exact_source_anchors: [{ exact_text: "An invented sentence.", occurrence: null, note: "x" }] })]), 3, "anchor level");
  refuses(bundle([review(1, { source_findings: [{ statement: "S.", required_qualifiers: [], anchor_indices: [0], note: "x" }] })]), 3, "finding level");
  // Missing parts, wrong versions and another source.
  for (const key of ["schema_version", "source_sha256", "reviewer", "authorization_ref", "reviews"]) {
    const without = bundle();
    delete without[key];
    refuses(without, 3, `missing ${key}`);
  }
  for (const key of ["page", "source_page_sha256", "reviewed_modalities", "source_read_complete", "source_specific_understanding",
    "exact_source_anchors", "source_findings"]) {
    const without = review(1);
    delete without[key];
    refuses(bundle([without]), 3, `review missing ${key}`);
  }
  refuses(bundle([review(1)], { schema_version: 2 }));
  refuses(bundle([review(1)], { source_sha256: "c".repeat(64) }));
  refuses(null);
  refuses([]);
  refuses("a bundle");
  // Who reviewed and under what authorization are names, not blanks.
  refuses(bundle([review(1)], { reviewer: "   " }));
  refuses(bundle([review(1)], { reviewer: "r".repeat(201) }));
  refuses(bundle([review(1)], { authorization_ref: "" }));
  refuses(bundle([review(1)], { authorization_ref: "a".repeat(321) }));
  validate(bundle([review(1)], { reviewer: "r".repeat(200), authorization_ref: "a".repeat(320) }));
  // The pages: real, once each, and no more reviews than pages.
  refuses(bundle([review(0)]));
  refuses(bundle([review(4)]));
  refuses(bundle([review(1.5)]));
  refuses(bundle([review("1")]));
  refuses(bundle([review(1), review(1)]));
  refuses(bundle([review(1), review(2), review(3), review(1)]), 3);
  refuses(bundle([review(1)]), 0);
  // The page's source was read whole, and the picture looked at exactly when there is one.
  refuses(bundle([review(1, { source_read_complete: false })]));
  refuses(bundle([review(1, { reviewed_modalities: "pdf" })]));
  refuses(bundle([review(1, { reviewed_modalities: "text+image" })]), 3, "an image page without the image claim");
  refuses(bundle([review(1, { reviewed_modalities: "image", image_content_reviewed: false })]), 3, "an image claim of false");
  refuses(bundle([review(1, { image_content_reviewed: true })]), 3, "an image claim on a text page");
  refuses(bundle([review(1, { image_content_reviewed: false })]), 3, "an image field on a text page, even false");
  // Bounds of the reader's own schema.
  refuses(bundle([review(1, { source_specific_understanding: "" })]));
  refuses(bundle([review(1, { source_specific_understanding: "u".repeat(2501) })]));
  refuses(bundle([review(1, { exact_source_anchors: Array.from({ length: 26 }, () => ({ exact_text: "x", occurrence: null })) })]));
  refuses(bundle([review(1, { source_findings: Array.from({ length: 31 }, () => ({ statement: "S.", required_qualifiers: [], anchor_indices: [0] })) })]));
  // Anchors name their place by occurrence or by offsets, never both, and offsets are a real span.
  const anchored = (anchor) => bundle([review(1, { exact_source_anchors: [anchor] })]);
  validate(anchored({ exact_text: "An invented sentence.", occurrence: 0 }));
  validate(anchored({ exact_text: "An invented sentence.", start: 0, end: 21 }));
  refuses(anchored({ exact_text: "" }));
  refuses(anchored({ exact_text: "x".repeat(1201), occurrence: null }));
  refuses(anchored({ exact_text: "An invented sentence." }), 3, "neither occurrence nor offsets");
  refuses(anchored({ exact_text: "An invented sentence.", occurrence: -1 }));
  refuses(anchored({ exact_text: "An invented sentence.", occurrence: null, start: 0, end: 5 }), 3, "both");
  refuses(anchored({ exact_text: "An invented sentence.", start: 5, end: 5 }));
  refuses(anchored({ exact_text: "An invented sentence.", start: -1, end: 5 }));
  refuses(anchored({ exact_text: "An invented sentence.", start: 0 }));
  // A finding cites anchors that exist, each once.
  const found = (finding) => bundle([review(1, { source_findings: [finding] })]);
  refuses(found({ statement: "S.", required_qualifiers: [], anchor_indices: [] }));
  refuses(found({ statement: "S.", required_qualifiers: [], anchor_indices: [1] }));
  refuses(found({ statement: "S.", required_qualifiers: [], anchor_indices: [0, 0] }));
  refuses(found({ statement: " ", required_qualifiers: [], anchor_indices: [0] }));
  refuses(found({ statement: "S.", required_qualifiers: [3], anchor_indices: [0] }));
  refuses(found({ statement: "S.", required_qualifiers: Array.from({ length: 21 }, () => "q"), anchor_indices: [0] }));
});

test("each review has its own digest and the reviewer it names, or else the bundle's", () => {
  const second = review(2, { reviewer: "Second Reviewer" });
  const { reviews, reviewer, authorization_ref: authorization } = validate(bundle([review(1), second]));
  assert.equal(reviewer, "Synthetic Reviewer");
  assert.equal(authorization, "synthetic:authorization:1");
  assert.deepEqual(reviews.map((item) => item.reviewer), ["Synthetic Reviewer", "Second Reviewer"]);
  assert.equal(reviews[0].review_sha256, sha(canonicalJson(review(1))));
  assert.equal(reviews[1].review_sha256, sha(canonicalJson(second)), "the digest covers the review's own reviewer too");
  // Another review, another bundle-level reviewer or another key order changes no page's digest.
  const alone = validate(bundle([review(1)], { reviewer: "Someone Else" })).reviews[0];
  assert.equal(alone.review_sha256, reviews[0].review_sha256);
  assert.equal(validate(bundle([Object.fromEntries(Object.entries(review(1)).reverse())])).reviews[0].review_sha256, alone.review_sha256);
  assert.equal(alone.reviewer, "Someone Else");
  // A different review is a different digest.
  assert.notEqual(validate(bundle([review(1, { source_specific_understanding: "Another account." })])).reviews[0].review_sha256, alone.review_sha256);
  refuses(bundle([review(1, { reviewer: " " })]));
  refuses(bundle([review(1, { reviewer: "r".repeat(201) })]));
  // The digest is of a copy: changing the caller's object afterwards changes nothing.
  const source = bundle([review(1)]);
  const checked = validate(source);
  source.reviews[0].source_specific_understanding = "changed afterwards";
  assert.notEqual(checked.reviews[0].entry.source_specific_understanding, "changed afterwards");
});

test("the review file is read through one handle, only when it is a private regular file of the right size", async (t) => {
  const dir = await privateDirectory(t);
  const file = path.join(dir, OPERATOR_REVIEW_FILE);
  assert.equal(await readOperatorReviewBundle(dir), null, "no file means no bundle");
  const write = async (content, mode = 0o600) => {
    await fs.rm(file, { recursive: true, force: true });
    await fs.writeFile(file, content, { mode });
    await fs.chmod(file, mode);
  };
  await write(JSON.stringify(bundle()));
  assert.deepEqual(await readOperatorReviewBundle(dir), bundle());

  // A link, even to a good file, and a directory.
  const elsewhere = path.join(dir, "elsewhere.json");
  await fs.writeFile(elsewhere, JSON.stringify(bundle()), { mode: 0o600 });
  await fs.rm(file);
  await fs.symlink(elsewhere, file);
  await assert.rejects(readOperatorReviewBundle(dir), { code: UNSAFE });
  await fs.unlink(file);
  await fs.mkdir(file, { mode: 0o700 });
  await assert.rejects(readOperatorReviewBundle(dir), { code: UNSAFE });
  // Anyone but the owner able to open it.
  for (const mode of [0o640, 0o604, 0o660, 0o666, 0o644]) {
    await write(JSON.stringify(bundle()), mode);
    await assert.rejects(readOperatorReviewBundle(dir), { code: UNSAFE }, mode.toString(8));
  }
  // Too large: judged from the opened file, before it is read.
  await write("{}");
  await fs.truncate(file, OPERATOR_REVIEW_MAX_BYTES + 1);
  await assert.rejects(readOperatorReviewBundle(dir), { code: UNSAFE });
  await fs.truncate(file, OPERATOR_REVIEW_MAX_BYTES);
  await assert.rejects(readOperatorReviewBundle(dir), { code: INVALID }, "at the limit it is read, and is not JSON");
  // Not JSON, and JSON that is no bundle (a stored null is not the absence of a bundle).
  for (const content of ["", "this is not json", "{", "null"]) {
    await write(content);
    await assert.rejects(readOperatorReviewBundle(dir), { code: INVALID }, JSON.stringify(content));
  }
  await write("[]");
  assert.deepEqual(await readOperatorReviewBundle(dir), []);
  assert.throws(() => validate([]), { code: INVALID }, "which the bundle's own check then refuses");
});

test("the worklist is replaced whole in the private directory and removed once nothing waits", async (t) => {
  const dir = await privateDirectory(t);
  const verified = await checkReviewDirectory(dir);
  const file = path.join(dir, OPERATOR_WORKLIST_FILE);
  const worklist = (page) => ({ schema_version: 1, source_sha256: SOURCE, generation: "generation:synthetic",
    pages: [{ page, source_page_sha256: PAGE, required_modalities: "text", reason: "visual_pending", text: "An invented sentence." }] });
  await writeOperatorWorklist({ dir, verified, worklist: worklist(2) });
  const handle = await fs.open(file, "r");
  try {
    assert.equal((await handle.stat()).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await handle.readFile("utf8")), worklist(2));
  } finally { await handle.close(); }
  await writeOperatorWorklist({ dir, verified, worklist: worklist(3) });
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), worklist(3), "the next worklist replaces the last");
  assert.deepEqual(await fs.readdir(dir), [OPERATOR_WORKLIST_FILE], "no temporary file is left");

  // A link at the final name is replaced, never followed to what it names.
  const elsewhere = path.join(dir, "elsewhere.txt");
  await fs.writeFile(elsewhere, "not the worklist", { mode: 0o600 });
  await fs.unlink(file);
  await fs.symlink(elsewhere, file);
  await writeOperatorWorklist({ dir, verified, worklist: worklist(4) });
  assert.equal(await fs.readFile(elsewhere, "utf8"), "not the worklist");
  assert.equal((await fs.lstat(file)).isFile(), true);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), worklist(4));

  await removeOperatorWorklist(dir);
  assert.equal(await fs.access(file).then(() => true, () => false), false);
  await removeOperatorWorklist(dir);
});

test("pages given to a reviewer are positive page numbers, listed once, and need the review directory", () => {
  const dir = path.join(os.tmpdir(), "synthetic-operator-review-directory");
  assert.deepEqual(journalOperatorReadPages({}), []);
  assert.deepEqual(journalOperatorReadPages({ operator_read_pages: null }), []);
  assert.deepEqual(journalOperatorReadPages({ operator_read_pages: [] }), [], "no page needs no directory");
  assert.deepEqual(journalOperatorReadPages({ operator_review_dir: dir, operator_read_pages: [7, 2, 40] }), [2, 7, 40]);
  assert.equal(Object.isFrozen(journalOperatorReadPages({ operator_review_dir: dir, operator_read_pages: [1] })), true);
  for (const pages of [3, "1", {}, [0], [-2], [1.5], ["1"], [null], [1, 1], [Number.MAX_SAFE_INTEGER + 1]])
    assert.throws(() => journalOperatorReadPages({ operator_review_dir: dir, operator_read_pages: pages }),
      { code: "JOURNAL_OPERATOR_READ_PAGES_INVALID" }, JSON.stringify(pages));
  assert.throws(() => journalOperatorReadPages({ operator_read_pages: [1] }), { code: "JOURNAL_OPERATOR_REVIEW_DIR_REQUIRED" });
  assert.throws(() => journalOperatorReadPages({ operator_read_pages: [1], operator_review_dir: null }),
    { code: "JOURNAL_OPERATOR_REVIEW_DIR_REQUIRED" });
  assert.throws(() => journalOperatorReadPages({ operator_read_pages: [1], operator_review_dir: "relative/dir" }),
    { code: "JOURNAL_OPERATOR_REVIEW_DIR_INVALID" });
});

test("the corpus a run replaces is a published corpus id without its quote suffix, and the generation it has active", () => {
  const corpus = "corpus:0b9f5f3e-6c52-4d5b-8f0e-5d1f3a9a7c11";
  assert.equal(journalReplacedPublication({}), null);
  assert.equal(journalReplacedPublication({ replaces_published_quotes: null }), null);
  const named = journalReplacedPublication({ replaces_published_quotes: { corpus_id: corpus, generation: "generation:synthetic:quotes:v4:pointer-1a2b3c4d" } });
  assert.deepEqual(named, { corpus_id: corpus, generation: "generation:synthetic:quotes:v4:pointer-1a2b3c4d" });
  assert.equal(Object.isFrozen(named), true);
  for (const value of [
    "corpus", [], 3,
    {},
    { corpus_id: corpus },
    { generation: "g" },
    { corpus_id: corpus, generation: "g", extra: 1 },
    { corpus_id: `${corpus}:quotes`, generation: "g" },
    { corpus_id: "corpus:not-a-uuid", generation: "g" },
    { corpus_id: corpus.replace("-4d5b-", "-1d5b-"), generation: "g" },
    { corpus_id: corpus.toUpperCase(), generation: "g" },
    { corpus_id: corpus.slice("corpus:".length), generation: "g" },
    { corpus_id: 7, generation: "g" },
    { corpus_id: corpus, generation: "" },
    { corpus_id: corpus, generation: "has space" },
    { corpus_id: corpus, generation: "g".repeat(161) },
    { corpus_id: corpus, generation: 4 }
  ]) assert.throws(() => journalReplacedPublication({ replaces_published_quotes: value }),
    { code: "JOURNAL_REPLACED_PUBLICATION_INVALID" }, JSON.stringify(value));
  journalReplacedPublication({ replaces_published_quotes: { corpus_id: corpus, generation: "g".repeat(160) } });
});
