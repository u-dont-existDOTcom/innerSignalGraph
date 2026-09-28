import { ValidationError } from "../core/errors.mjs";

const ID = /^[A-Za-z0-9:_-]{1,160}$/;

function id(value, name) {
  if (typeof value !== "string" || !ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

export function createJournalContinuityProjection(journalCorpora = [], { consumerCapabilitySupported = false } = {}) {
  if (!Array.isArray(journalCorpora)) throw new ValidationError("journalCorpora must be an array.");
  const corpora = journalCorpora
    .filter((reference) => reference?.active_generation != null)
    .map((reference, index) => ({
      corpus_id: id(reference.corpus_id, `journalCorpora[${index}].corpus_id`),
      generation: id(reference.active_generation, `journalCorpora[${index}].active_generation`),
      manifest_object_id: id(reference.manifest_object_id, `journalCorpora[${index}].manifest_object_id`),
      visibility_epoch: reference.visibility_epoch
    }));
  if (corpora.some(({ visibility_epoch: epoch }) => !Number.isSafeInteger(epoch) || epoch < 0)) {
    throw new ValidationError("Journal continuity visibility epoch is invalid.");
  }
  return Object.freeze({
    schema_version: 1,
    capability: "journal-evidence-v1",
    mode: corpora.length ? "external_reference_only" : "not_attached",
    corpora: Object.freeze(corpora.map(Object.freeze)),
    requires_live_source_service: corpora.length > 0,
    portable_objects_included: false,
    consumer_capability_supported: consumerCapabilitySupported === true
  });
}

export function validateJournalContinuityProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1
      || value.capability !== "journal-evidence-v1" || !["not_attached", "external_reference_only"].includes(value.mode)
      || !Array.isArray(value.corpora) || typeof value.requires_live_source_service !== "boolean"
      || value.portable_objects_included !== false || typeof value.consumer_capability_supported !== "boolean") {
    throw new ValidationError("Journal continuity projection is invalid.");
  }
  const ids = new Set();
  for (const [index, corpus] of value.corpora.entries()) {
    if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)
        || JSON.stringify(Object.keys(corpus).sort()) !== JSON.stringify(["corpus_id", "generation", "manifest_object_id", "visibility_epoch"].sort())) {
      throw new ValidationError("Journal continuity corpus pointer is invalid.");
    }
    id(corpus.corpus_id, `journal_continuity.corpora[${index}].corpus_id`);
    id(corpus.generation, `journal_continuity.corpora[${index}].generation`);
    id(corpus.manifest_object_id, `journal_continuity.corpora[${index}].manifest_object_id`);
    if (!Number.isSafeInteger(corpus.visibility_epoch) || corpus.visibility_epoch < 0 || ids.has(corpus.corpus_id)) {
      throw new ValidationError("Journal continuity corpus pointer is invalid.");
    }
    ids.add(corpus.corpus_id);
  }
  const attached = value.corpora.length > 0;
  if ((value.mode === "external_reference_only") !== attached || value.requires_live_source_service !== attached) {
    throw new ValidationError("Journal continuity mode is inconsistent with its corpus pointers.");
  }
  return value;
}

export function journalContinuityUnsupported(value) {
  const projection = validateJournalContinuityProjection(structuredClone(value));
  return projection.corpora.length > 0 && projection.consumer_capability_supported !== true;
}
