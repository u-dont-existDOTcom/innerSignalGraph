import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  JOURNAL_GRAPH_CONTRACT,
  isJournalTimeBound,
  resolveExactQuote,
  splitUtf8,
  timeBoundStartsByEndOf,
  validateJournalGraph,
  validateJournalSchema,
  verifyUtf8Coverage
} from "../src/journal-import/contracts.mjs";
import { journalImportHelp, parseJournalImportArgs, runJournalImportCli } from "../src/cli/journal-import.mjs";

const load = async (name) => JSON.parse(await readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
const root = path.resolve(new URL("..", import.meta.url).pathname);
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

test("time bounds are calendar values the timeline can order, each naming a whole period", () => {
  for (const bound of ["2021", "2021-05", "2021-05-14", "2021-05-14T09:30", "2021-05-14T09:30:15", "2021-05-14T09:30:15.250",
    "2021-05-14T09:30Z", "2024-02-29", "0099-01-01"]) assert.equal(isJournalTimeBound(bound), true, bound);
  // Vague wording, dates that do not exist, numeric offsets (the zone has its own field) and other
  // spellings are not bounds.
  for (const bound of ["last summer", "May 2021", "2021-5", "2021-13", "2021-02-30", "2023-02-29", "2021-05-14T24:00",
    "2021-05-14 09:30", "2021-05-14T09:30+02:00", "2021-05-14Z", "2021-05-14T09:30:15.2500", "", null, 2021]) {
    assert.equal(isJournalTimeBound(bound), false, String(bound));
  }
  // A coarser bound covers its whole period, so May 20 begins before "May" ends; a trailing Z does
  // not change the order.
  assert.equal(timeBoundStartsByEndOf("2021-05-20", "2021-05"), true);
  assert.equal(timeBoundStartsByEndOf("2021-05", "2021-05-01"), true);
  assert.equal(timeBoundStartsByEndOf("2021-06", "2021-05-31"), false);
  assert.equal(timeBoundStartsByEndOf("2021-05-14T09:30:15.250Z", "2021-05-14T09:30:15"), true);
  assert.equal(timeBoundStartsByEndOf("2021-05-14T09:30Z", "2021-05-14T09:29:59"), false);
});

test("each present time bound is checked, and a closed interval may not end before it starts", async () => {
  const graph = await load("synthetic-graph.json");
  const sources = await load("synthetic-sources.json");
  const timed = (time) => mutate(graph, (copy) => {
    copy.nodes.find(({ id }) => id === "a1").data.event_time = { raw: "synthetic", timezone: null, basis: "explicit", evidence_ids: ["p1"], ...time };
  });
  // Open at one end: the one bound present is still checked.
  assert.equal(validateJournalGraph(timed({ from: "2021-05", to: null, precision: "interval" }), sources).result, "PASS_STRUCTURAL_GRAPH_ONLY");
  assert.throws(() => validateJournalGraph(timed({ from: "last summer", to: null, precision: "interval" }), sources), /INVALID_TIME_BOUND/);
  assert.throws(() => validateJournalGraph(timed({ from: null, to: "2021-02-30", precision: "interval" }), sources), /INVALID_TIME_BOUND/);
  // Closed: both are checked and ordered by the periods they name.
  assert.equal(validateJournalGraph(timed({ from: "2021-05-20", to: "2021-05", precision: "interval" }), sources).result, "PASS_STRUCTURAL_GRAPH_ONLY");
  assert.throws(() => validateJournalGraph(timed({ from: "2021-06-01", to: "2021-05", precision: "interval" }), sources), /INVALID_TIME_INTERVAL/);
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
    execution_root: path.join(directory, "execution"),
    existing_grant_ref: "synthetic:grant",
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

test("configured doctor prepares the exchange before authorizing its inference route", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-doctor-exchange-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const privateDirectory = path.join(directory, "private");
  await fs.mkdir(path.join(privateDirectory, "source"), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from("Synthetic private journal entry.\n", "utf8");
  await fs.writeFile(path.join(privateDirectory, "source", "journal.txt"), bytes, { mode: 0o600 });
  const configPath = path.join(privateDirectory, "run-config.json");
  await fs.writeFile(configPath, `${JSON.stringify({
    schema_version: 1,
    mode: "synthetic_private_doctor",
    source: {
      relative_path: "private/source/journal.txt",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength
    },
    target_profile: { case_id: "synthetic-doctor-case" },
    private_runtime_root: path.join(directory, "runtime"),
    execution_root: path.join(directory, "execution"),
    existing_grant_ref: "synthetic:grant",
    max_external_spend_usd: 0
  })}\n`, { mode: 0o600 });
  const route = {
    schema_version: 1,
    provider: "chatgpt_connector_exchange",
    route_ref: "route:synthetic-exchange",
    model: "GPT-5.6 Sol",
    effort: "Pro",
    timeout_ms: 60_000,
    max_external_spend_usd: 0,
    allowance_evidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 }
  };
  let stdout = "";
  const code = await runJournalImportCli(["doctor", "--config", configPath], {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: () => {} },
    environment: {
      INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(route),
      INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: Buffer.alloc(32, 73).toString("base64"),
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root,
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: Buffer.alloc(32, 75).toString("base64")
    }
  });
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.capabilities.inference_route, "unavailable");
  assert.ok(report.blockers.includes("JOURNAL_WORK_EXCHANGE_ROOT_INSIDE_REPOSITORY"));
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
      execution_root: path.join(directory, "execution"),
      existing_grant_ref: "synthetic:grant",
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

test("doctor reports what a run requires of the config, and paths are judged on their real location", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-doctor-config-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const privateDirectory = path.join(directory, "private");
  await fs.mkdir(path.join(privateDirectory, "source"), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from("%PDF-synthetic-private-doctor", "utf8");
  await fs.writeFile(path.join(privateDirectory, "source", "journal.pdf"), bytes, { mode: 0o600 });
  const configPath = path.join(privateDirectory, "incomplete.json");
  await fs.writeFile(configPath, `${JSON.stringify({
    schema_version: 1, mode: "synthetic_private_doctor",
    source: { relative_path: "private/source/journal.pdf", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength },
    target_profile: { case_id: "synthetic-doctor-case" }, private_runtime_root: path.join(directory, "runtime"), max_external_spend_usd: 0
  })}\n`, { mode: 0o600 });
  let stdout = "";
  assert.equal(await runJournalImportCli(["doctor", "--config", configPath], {
    stdout: { write: (chunk) => { stdout += chunk; } }, stderr: { write: () => {} }, environment: {}
  }), 0);
  const report = JSON.parse(stdout);
  assert.ok(report.blockers.includes("JOURNAL_EXECUTION_ROOT_REQUIRED"));
  assert.ok(report.blockers.includes("JOURNAL_GRANT_REFERENCE_REQUIRED"));
  // A config reached through a link into the public checkout is inside it.
  const link = path.join(directory, "checkout-link");
  await fs.symlink(root, link);
  let stderr = "";
  assert.equal(await runJournalImportCli(["doctor", "--config", path.join(link, "not-private.json")], {
    stdout: { write: () => {} }, stderr: { write: (chunk) => { stderr += chunk; } }, environment: {}
  }), 1);
  assert.deepEqual(JSON.parse(stderr), { error: "JOURNAL_CONFIG_LOCATION_INVALID" });
  // An empty source is supported by its parser but has nothing to import, so doctor says so.
  await fs.writeFile(path.join(privateDirectory, "source", "empty.txt"), "", { mode: 0o600 });
  const emptyConfig = path.join(privateDirectory, "empty.json");
  await fs.writeFile(emptyConfig, `${JSON.stringify({
    schema_version: 1, mode: "synthetic_private_doctor",
    source: { relative_path: "private/source/empty.txt", sha256: createHash("sha256").update("").digest("hex"), bytes: 0 },
    target_profile: { case_id: "synthetic-doctor-case" }, private_runtime_root: path.join(directory, "runtime"), max_external_spend_usd: 0,
    execution_root: path.join(directory, "execution"), existing_grant_ref: "synthetic:grant"
  })}\n`, { mode: 0o600 });
  stdout = "";
  await runJournalImportCli(["doctor", "--config", emptyConfig], {
    stdout: { write: (chunk) => { stdout += chunk; } }, stderr: { write: () => {} }, environment: {}
  });
  assert.ok(JSON.parse(stdout).blockers.includes("JOURNAL_SOURCE_EMPTY"));
});
