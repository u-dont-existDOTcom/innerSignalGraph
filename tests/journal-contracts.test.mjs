import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  JOURNAL_GRAPH_CONTRACT,
  resolveExactQuote,
  splitUtf8,
  validateJournalGraph,
  validateJournalSchema,
  verifyUtf8Coverage
} from "../src/journal-import/contracts.mjs";
import { journalImportHelp, parseJournalImportArgs, runJournalImportCli } from "../src/cli/journal-import.mjs";

const load = async (name) => JSON.parse(await readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
const mutate = (value, change) => { const copy = structuredClone(value); change(copy); return copy; };

test("UTF-8 contracts preserve exact bytes and reject malformed source", () => {
  const text = "é 🌿 Café\nété";
  const units = splitUtf8(text, 5);
  assert.equal(units.map((unit) => unit.text).join(""), text);
  assert.equal(verifyUtf8Coverage(text, units).bytes, Buffer.byteLength(text));
  assert.throws(() => splitUtf8("\ud800", 4), /MALFORMED_UNICODE/);
  assert.equal(resolveExactQuote("🌿 é test", "é").start_byte, 5);
  assert.throws(() => resolveExactQuote("oui oui", "oui"), /QUOTE_AMBIGUOUS/);
});

test("versioned schemas reject unknown keys", async () => {
  const graph = await load("synthetic-graph.json");
  assert.throws(() => validateJournalSchema("graph", { ...graph, unexpected: true }), /does not satisfy/);
});

test("invented graph passes structural contracts", async () => {
  const graph = await load("synthetic-graph.json");
  const sources = await load("synthetic-sources.json");
  assert.equal(validateJournalGraph(graph, sources, JOURNAL_GRAPH_CONTRACT).result, "PASS_STRUCTURAL_GRAPH_ONLY");
});

test("source-less assertion is rejected", async () => {
  const graph = await load("synthetic-graph.json");
  const sources = await load("synthetic-sources.json");
  const invalid = mutate(graph, (copy) => { copy.nodes.find(({ id }) => id === "a1").data.evidence_ids = []; });
  assert.throws(() => validateJournalGraph(invalid, sources), /does not satisfy|ASSERTION_WITHOUT_SOURCE/);
});

test("wrong narrative mode is rejected", async () => {
  const graph = await load("synthetic-graph.json");
  const sources = await load("synthetic-sources.json");
  const invalid = mutate(graph, (copy) => { copy.nodes.find(({ id }) => id === "a6").data.narrative_mode = "waking"; });
  assert.throws(() => validateJournalGraph(invalid, sources), /DREAM_SCOPE_LOST/);
});

test("unsupported causal edge type is rejected", async () => {
  const graph = await load("synthetic-graph.json");
  const sources = await load("synthetic-sources.json");
  const invalid = mutate(graph, (copy) => { copy.edges[0].relation = "causes"; });
  assert.throws(() => validateJournalGraph(invalid, sources), /does not satisfy|UNAUTHORIZED_EDGE_TYPE/);
});

test("CLI grammar requires private absolute config outside mock doctor", () => {
  assert.deepEqual(parseJournalImportArgs(["doctor", "--mock"]), {
    command: "doctor", configPath: null, mock: true, json: false
  });
  assert.throws(() => parseJournalImportArgs(["run"]), /private --config path is required/);
  assert.throws(() => parseJournalImportArgs(["run", "--config", "relative.json"]), /absolute private path/);
});

test("CLI help and doctor mock are executable and content-free", async () => {
  assert.match(journalImportHelp(), /Commands: doctor/);
  let stdout = "";
  let stderr = "";
  const code = await runJournalImportCli(["doctor", "--mock"], {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.mode, "synthetic_mock");
  assert.equal(report.mutation_allowed, false);
  assert.equal(report.external_spend_usd, 0);
  assert.equal(stderr, "");
});

test("configured doctor verifies the private source while reporting missing operator and inference routes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-doctor-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const privateDirectory = path.join(directory, "private");
  const sourceDirectory = path.join(privateDirectory, "source");
  await fs.mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from("%PDF-synthetic-private-doctor", "utf8");
  const sourcePath = path.join(sourceDirectory, "journal.pdf");
  const configPath = path.join(privateDirectory, "run-config.json");
  await fs.writeFile(sourcePath, bytes, { mode: 0o600 });
  await fs.writeFile(configPath, `${JSON.stringify({
    schema_version: 1,
    mode: "synthetic_private_doctor",
    source: {
      relative_path: "private/source/journal.pdf",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength
    },
    target_profile: { case_id: "synthetic-doctor-case" },
    private_runtime_root: path.join(directory, "runtime"),
    max_external_spend_usd: 0
  })}\n`, { mode: 0o600 });
  let stdout = "";
  let stderr = "";
  const code = await runJournalImportCli(["doctor", "--config", configPath], {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    environment: {}
  });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.capabilities.source_mount, "verified");
  assert.equal(report.capabilities.parser, "pdfjs-dist");
  assert.equal(report.capabilities.private_target, "unavailable");
  assert.equal(report.capabilities.inference_route, "unavailable");
  assert.deepEqual(report.blockers, ["INFERENCE_ISOLATION_UNAVAILABLE", "OPERATOR_ENVIRONMENT_UNAVAILABLE"]);
});

test("doctor reports a UTF-8 text source as importable and other non-PDF bytes as unsupported", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-doctor-text-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const privateDirectory = path.join(directory, "private");
  const sourceDirectory = path.join(privateDirectory, "source");
  await fs.mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
  const doctor = async (name, bytes) => {
    await fs.writeFile(path.join(sourceDirectory, name), bytes, { mode: 0o600 });
    const configPath = path.join(privateDirectory, `${name}.json`);
    await fs.writeFile(configPath, `${JSON.stringify({
      schema_version: 1,
      mode: "synthetic_private_doctor",
      source: { relative_path: `private/source/${name}`, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength },
      target_profile: { case_id: "synthetic-doctor-case" },
      private_runtime_root: path.join(directory, "runtime"),
      max_external_spend_usd: 0
    })}\n`, { mode: 0o600 });
    let stdout = "";
    assert.equal(await runJournalImportCli(["doctor", "--config", configPath], {
      stdout: { write: (chunk) => { stdout += chunk; } }, stderr: { write: () => {} }, environment: {}
    }), 0);
    return JSON.parse(stdout);
  };
  const text = await doctor("journal.txt", Buffer.from("Entrée inventée 🌿 — une ligne.\n", "utf8"));
  assert.equal(text.capabilities.parser, "node-utf8");
  assert.equal(text.blockers.includes("FORMAT_UNSUPPORTED"), false);
  const binary = await doctor("journal.bin", Buffer.from([0xff, 0xfe, 0x00, 0x81]));
  assert.equal(binary.capabilities.parser, "unsupported");
  assert.equal(binary.blockers.includes("FORMAT_UNSUPPORTED"), true);
});

test("commands that are designed but not built fail plainly instead of opening a run", async () => {
  for (const command of ["cold-test", "export"]) {
    let stderr = "";
    let opened = false;
    const code = await runJournalImportCli([command, "--config", "/synthetic/private/run.json"], {
      stdout: { write: () => {} },
      stderr: { write: (chunk) => { stderr += chunk; } },
      environment: {},
      runtimeFactory: async () => { opened = true; throw new Error("must not open"); }
    });
    assert.equal(code, 1);
    assert.equal(opened, false);
    assert.deepEqual(JSON.parse(stderr), { error: "JOURNAL_COMMAND_NOT_AVAILABLE" });
  }
  let help = "";
  await runJournalImportCli(["--help"], { stdout: { write: (chunk) => { help += chunk; } }, stderr: { write: () => {} } });
  assert.match(help, /Planned, not available yet: cold-test, export/);
  assert.doesNotMatch(help.split("Planned")[0], /cold-test|export/);
});
