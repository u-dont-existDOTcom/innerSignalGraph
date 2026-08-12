import { parseModelJson } from "../core/json.mjs";
import { verifyGuidePacket } from "./verifier.mjs";
import { assertExactGuidePacketModel } from "./model-policy.mjs";
import { extractHtmlSections, htmlToText } from "./source-html.mjs";
import { INNER_CHILD_SECTION_ALIASES, SOMATIC_SECTION_ALIASES } from "./contract.mjs";

const compilationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "unresolved_material_disagreement", "source_roles", "graph_changes", "findings", "worst_plausible_failure"],
  properties: {
    verdict: { type: "string", enum: ["compiled", "blocked"] },
    summary: { type: "string" },
    unresolved_material_disagreement: { type: "boolean" },
    source_roles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["node_id", "role", "source_refs", "confidence", "notes"],
        properties: {
          node_id: { type: "string" },
          role: { type: "string" },
          source_refs: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          notes: { type: "string" }
        }
      }
    },
    graph_changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["node_id", "change_type", "source_refs", "behavioral_effect", "certainty"],
        properties: {
          node_id: { type: "string" },
          change_type: { type: "string", enum: ["add", "remove", "modify", "reprioritize", "unchanged"] },
          source_refs: { type: "array", items: { type: "string" } },
          behavioral_effect: { type: "string" },
          certainty: { type: "string" }
        }
      }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "reason", "required_action"],
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "review", "block"] },
          reason: { type: "string" },
          required_action: { type: "string" }
        }
      }
    },
    worst_plausible_failure: { type: "string" }
  }
};

function validateCompilation(value) {
  if (!value || typeof value !== "object") throw new Error("Guide packet compilation must return an object.");
  if (!['compiled', 'blocked'].includes(value.verdict)) throw new Error("Guide packet compilation verdict must be compiled or blocked.");
  if (typeof value.summary !== "string") throw new Error("Guide packet compilation summary is required.");
  if (typeof value.unresolved_material_disagreement !== "boolean") throw new Error("Guide packet compilation must declare unresolved_material_disagreement.");
  for (const key of ["source_roles", "graph_changes", "findings"]) if (!Array.isArray(value[key])) throw new Error(`Guide packet compilation ${key} must be an array.`);
  if (typeof value.worst_plausible_failure !== "string") throw new Error("Guide packet compilation worst plausible failure is required.");
  return value;
}

function completeSourceSections(verified) {
  const result = {};
  for (const guide of verified.manifest.guides) {
    const source = verified.entries.get(guide.sourcePath).toString("utf8");
    const aliases = guide.id === "inner-child"
      ? INNER_CHILD_SECTION_ALIASES
      : guide.id === "somatic"
        ? SOMATIC_SECTION_ALIASES
        : {};
    result[guide.id] = extractHtmlSections(source, { guideId: guide.id, aliases }).map((section) => ({
      id: section.id,
      heading: section.heading,
      ordinal: section.ordinal,
      text: htmlToText(section.rawHtml),
      textSha256: section.textSha256,
      rawHtmlSha256: section.rawHtmlSha256,
      sourceSha256: guide.sourceSha256
    }));
  }
  return result;
}

function compilationInput(verified) {
  return {
    manifest: {
      packetId: verified.manifest.packetId,
      packetVersion: verified.manifest.packetVersion,
      guides: verified.manifest.guides.map((guide) => ({ id: guide.id, revision: guide.revision, sourceSha256: guide.sourceSha256, graphSha256: guide.graphSha256 }))
    },
    sourceSections: completeSourceSections(verified),
    externalSourceExcerpts: verified.externalSources.map((source) => ({
      id: source.id,
      title: source.title,
      role: source.role,
      page: source.page,
      sourcePath: source.sourcePath,
      excerptPath: source.excerptPath,
      sourceSha256: source.sourceSha256,
      excerptSha256: source.excerptSha256,
      independentlyValidated: source.independentlyValidated,
      caveat: source.caveat,
      text: source.text
    })),
    graphNodes: verified.graphs.flatMap((graph) => (graph.nodes ?? []).map((node) => ({ id: node.id, title: node.title, priority: node.priority, sourceRefs: node.sourceRefs, authority: node.authority, recommendations: node.recommendations, avoid: node.avoid, effects: node.effects }))),
    behavioralDiff: verified.behavioralDiff,
    provenance: verified.provenance,
    certaintyRules: verified.certainty?.rules ?? [],
    deterministicRegressionStatus: verified.regressionStatus
  };
}

export async function compileGuidePacketCandidate({ packetBuffer, compiler, installedRevision = null, installedBundle = null, onProgress }) {
  assertExactGuidePacketModel(compiler, "compiler");
  const verified = verifyGuidePacket(packetBuffer, { installedRevision, installedBundle });
  if (!verified.ok) throw new Error(`Guide packet cannot enter Opus compilation: ${verified.errors.join("; ")}`);
  const input = compilationInput(verified);
  onProgress?.({ stage: "guide-packet-opus-compilation", status: "started", detail: `${compiler.id}/${compiler.model}` });
  const raw = await compiler.generate({
    system: "You are Claude Opus 5 compiling an Inner Signal Guide Packet source-role report. The input includes the complete hash-verified canonical prose for every guide section plus attached external-source excerpts. Compare canonical source, executable graph, cross-guide edges, provenance, certainty, and affected regressions. Identify exactly which graph rules are supported by source prose, owner amendments, product-only operational policy, author-provided external material, or unresolved inference. A hash proves source identity, not factual accuracy; material marked independentlyValidated=false must not be upgraded into validated medical evidence. Do not approve owner policy or any therapy or safety policy on Joel's behalf. Do not rewrite canonical guide prose. Return only the requested JSON schema.",
    user: `Compile this deterministically verified Guide Packet candidate into a source-role and behavioral-change report for independent Codex audit:\n${JSON.stringify(input, null, 2)}`,
    outputSchema: compilationSchema,
    metadata: { stage: "guide_packet_opus_compilation" }
  });
  const report = validateCompilation(parseModelJson(raw.text, `${compiler.id} guide packet compilation`));
  onProgress?.({ stage: "guide-packet-opus-compilation", status: "completed", detail: report.verdict });
  return {
    contractVersion: "guide-packet-opus-compilation-v1",
    status: report.verdict,
    compiledAt: new Date().toISOString(),
    compiler: { provider: compiler.id, model: compiler.model, requestId: raw.requestId ?? null },
    report
  };
}
