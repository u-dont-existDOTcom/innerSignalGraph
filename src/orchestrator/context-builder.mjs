import { loadGuide, loadSomaticGuide, selectGuideExcerpts } from "../guide/load-guide.mjs";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { ValidationError } from "../core/errors.mjs";

export async function buildContext(input, config) {
  if (!input || typeof input !== "object") throw new ValidationError("Input must be an object.");
  if (typeof input.userMessage !== "string" || !input.userMessage.trim()) {
    throw new ValidationError("userMessage is required.");
  }
  const recentTranscript = typeof input.recentTranscript === "string" ? input.recentTranscript.trim() : "";
  const userFacts = Array.isArray(input.userFacts) ? input.userFacts.filter((fact) => typeof fact === "string") : [];
  const guide = await loadGuide(config);
  const somaticText = await loadSomaticGuide(config);
  const graphBundle = await loadCompiledGuideGraphBundle({ packetRoot: config.guidePacketRoot });
  const query = `${recentTranscript}\n${input.userMessage}`;
  const perGuideBudget = Math.max(2000, Math.floor(config.guideExcerptMaxChars / 2));
  const guideExcerpts = input.guideExcerpts?.trim() || [
    `# Inner-child guide\n${selectGuideExcerpts(guide.text, query, perGuideBudget)}`,
    `# Somatic sequencing guide\n${selectGuideExcerpts(somaticText, query, perGuideBudget)}`
  ].join("\n\n").slice(0, config.guideExcerptMaxChars);

  return {
    userMessage: input.userMessage.trim(),
    recentTranscript,
    userFacts,
    priorCaseSnapshot: input.priorCaseSnapshot && typeof input.priorCaseSnapshot === "object" ? input.priorCaseSnapshot : null,
    priorInterventionContract: input.priorInterventionContract && typeof input.priorInterventionContract === "object" ? input.priorInterventionContract : null,
    priorProcessingTier: typeof input.priorProcessingTier === "string" ? input.priorProcessingTier : "",
    guideManifest: guide.manifest,
    graphBundleVersion: graphBundle.version,
    guidePacketVersion: guide.manifest.guidePacketVersion ?? null,
    guideSources: guide.manifest.sources?.map((source) => ({ id: source.id, version: source.version })) ?? [],
    guideExcerpts
  };
}

export async function buildHypnosisContext(input, config) {
  const base = await buildContext(input, config);
  const request = input.hypnosisRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new ValidationError("hypnosisRequest is required for the hypnosis compiler.");
  }
  const target = typeof request.target === "string" ? request.target.trim() : "";
  if (!target) throw new ValidationError("hypnosisRequest.target is required.");
  const relationship = request.relationship ?? "communion";
  if (!["command", "communion"].includes(relationship)) {
    throw new ValidationError("hypnosisRequest.relationship must be command or communion.");
  }
  const language = request.language ?? "en";
  if (language !== "en") {
    throw new ValidationError("v0.7.2 hypnosis compiler currently supports language=en only.");
  }
  const depth = request.depth ?? "classic";
  if (!["subtle", "classic", "deep"].includes(depth)) {
    throw new ValidationError("hypnosisRequest.depth must be subtle, classic, or deep.");
  }
  const sessionType = request.sessionType ?? "awake";
  if (sessionType !== "awake") {
    throw new ValidationError("v0.7.2 compiles awake sessions only; sleep/night mode remains a separate contract.");
  }
  const durationMinutes = Number(request.durationMinutes ?? 10);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 2 || durationMinutes > 60) {
    throw new ValidationError("hypnosisRequest.durationMinutes must be from 2 to 60.");
  }
  return {
    ...base,
    hypnosisRequest: Object.freeze({
      target,
      relationship,
      language,
      depth,
      sessionType,
      durationMinutes: Math.round(durationMinutes),
      protectorGateRequired: request.protectorGateRequired !== false,
      fullyAwakeAfterward: request.fullyAwakeAfterward !== false,
      notes: Array.isArray(request.notes) ? request.notes.filter((item) => typeof item === "string") : []
    })
  };
}
