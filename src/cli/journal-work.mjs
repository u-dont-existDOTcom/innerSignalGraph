import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertJournalWorkExchangeRoot, assertJournalWorkId, createJournalWorkDispatchReader,
  createJournalWorkExchange, journalWorkExchangeSecret, journalWorkFileKey, resolveJournalWorkExchangeRoot
} from "../journal-import/work-exchange.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STAGE_NAME = /^stage-[0-9a-f-]{36}$/u;
const CONTEXT = /^claude-session:[0-9A-Za-z-]{8,64}$/u;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function flags(argv, names) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!names.includes(argv[i]) || argv[i + 1] === undefined || Object.hasOwn(result, argv[i])) fail("JOURNAL_WORK_COMMAND_INVALID");
    result[argv[i]] = argv[i + 1];
  }
  if (Object.keys(result).length !== names.length) fail("JOURNAL_WORK_COMMAND_INVALID");
  return result;
}

async function stageParent(root) {
  const parent = path.join(root, "stage");
  await fs.mkdir(parent, { mode: 0o700 }).catch((error) => { if (error?.code !== "EEXIST") throw error; });
  const info = await fs.lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid())
    || await fs.realpath(parent) !== parent) fail("JOURNAL_WORK_STAGE_DIR_INSECURE");
  return parent;
}

async function checkedStage(root, stageDir) {
  const parent = await stageParent(root);
  if (!path.isAbsolute(stageDir) || path.dirname(stageDir) !== parent || !STAGE_NAME.test(path.basename(stageDir))) {
    fail("JOURNAL_WORK_STAGE_DIR_INVALID");
  }
  const info = await fs.lstat(stageDir);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid())
    || await fs.realpath(stageDir) !== stageDir) fail("JOURNAL_WORK_STAGE_DIR_INSECURE");
  return stageDir;
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function writeAttemptMarker(marker, value, exclusive = false) {
  const target = exclusive ? marker : `${marker}.${randomUUID()}.tmp`;
  const handle = await fs.open(target, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  catch (error) { await handle.close(); await fs.unlink(target).catch(() => {}); throw error; }
  await handle.close();
  if (!exclusive) await fs.rename(target, marker);
  await syncDirectory(path.dirname(marker));
}

async function sweepStages(root) {
  const parent = await stageParent(root);
  const records = await createJournalWorkDispatchReader({ root }).listDispatch();
  const durations = records.map((record) => Date.parse(record.expires_at) - Date.parse(record.issued_at))
    .filter((value) => Number.isFinite(value) && value > 0);
  const ttl = durations.length ? Math.max(...durations) : 24 * 3_600_000;
  let removed = 0;
  for (const name of await fs.readdir(parent)) {
    if (!STAGE_NAME.test(name)) continue;
    const target = path.join(parent, name);
    const info = await fs.lstat(target);
    if (info.isDirectory() && (info.mode & 0o777) === 0o700
      && (!process.getuid || info.uid === process.getuid()) && info.mtimeMs < Date.now() - ttl) {
      await fs.rm(target, { recursive: true, force: false });
      removed += 1;
    }
  }
  return removed;
}

export async function runJournalWork(argv, { environment = process.env, stdout = process.stdout } = {}) {
  const [command, ...options] = argv;
  const configuredRoot = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT;
  if (!configuredRoot) fail("JOURNAL_WORK_EXCHANGE_ROOT_REQUIRED");
  const root = await resolveJournalWorkExchangeRoot(configuredRoot, { outside: repositoryRoot });
  await assertJournalWorkExchangeRoot(root);
  if (command === "dispatch" && (options.length === 0 || (options.length === 1 && options[0] === "--json"))) {
    const records = await createJournalWorkDispatchReader({ root }).listDispatch();
    const now = Date.now();
    for (const record of records) {
      if (Date.parse(record.expires_at) <= now) continue;
      const { work_id, role, output_schema_name, model, effort, tier = "standard", issued_at, expires_at, answered } = record;
      stdout.write(`${JSON.stringify({ work_id, role, output_schema_name, model, effort, tier, issued_at, expires_at, answered })}\n`);
    }
    return;
  }
  if (command === "stage-create" && options.length === 0) {
    await sweepStages(root);
    const parent = await stageParent(root);
    const stageDir = path.join(parent, `stage-${randomUUID()}`);
    await fs.mkdir(stageDir, { mode: 0o700 });
    stdout.write(`${JSON.stringify({ stage_dir: stageDir })}\n`);
    return;
  }
  if (command === "stage-sweep" && options.length === 0) {
    stdout.write(`${JSON.stringify({ removed: await sweepStages(root) })}\n`);
    return;
  }
  if (["attempt-status", "attempt-reserve", "attempt-mark", "attempt-release"].includes(command)) {
    const parsed = flags(options, command === "attempt-status" ? ["--work-id"] : ["--work-id", "--claim"]);
    const value = parsed["--work-id"];
    const workId = assertJournalWorkId(value);
    if (command !== "attempt-status" && !/^[0-9a-f-]{36}$/u.test(parsed["--claim"])) fail("JOURNAL_WORK_ATTEMPT_INVALID");
    const directory = path.join(root, "claude-attempts");
    await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (error?.code !== "EEXIST") throw error; });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o777) !== 0o700
      || (process.getuid && info.uid !== process.getuid()) || await fs.realpath(directory) !== directory) {
      fail("JOURNAL_WORK_ATTEMPT_DIR_INSECURE");
    }
    const marker = path.join(directory, `${journalWorkFileKey(workId)}.json`);
    if (command === "attempt-reserve") {
      let claimed = true;
      try { await writeAttemptMarker(marker, { work_id: workId, status: "reserved", claim: parsed["--claim"] }, true); }
      catch (error) { if (error?.code === "EEXIST") claimed = false; else throw error; }
      stdout.write(`${JSON.stringify({ claimed })}\n`);
      return;
    }
    const status = await fs.readFile(marker, "utf8").then((bytes) => JSON.parse(bytes), (error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (status && (status.work_id !== workId || !["reserved", "attempted"].includes(status.status))) {
      fail("JOURNAL_WORK_ATTEMPT_INVALID");
    }
    if (command !== "attempt-status" && status?.claim !== parsed["--claim"]) fail("JOURNAL_WORK_ATTEMPT_INVALID");
    if (command === "attempt-mark" && status?.status === "reserved") {
      await writeAttemptMarker(marker, { ...status, status: "attempted" });
    } else if (command === "attempt-release") {
      await fs.unlink(marker);
      await syncDirectory(directory);
    }
    stdout.write(`${JSON.stringify({ attempted: status !== null })}\n`);
    return;
  }
  if (command === "stage-remove") {
    const { "--stage-dir": value } = flags(options, ["--stage-dir"]);
    const stageDir = await checkedStage(root, value);
    await fs.rm(stageDir, { recursive: true, force: false });
    stdout.write('{"removed":true}\n');
    return;
  }
  if (command === "stage-check" || command === "promote") {
    const fields = command === "promote"
      ? ["--work-id", "--stage-dir", "--execution-json", "--subject"] : ["--work-id", "--stage-dir"];
    const parsed = flags(options, fields);
    const workId = assertJournalWorkId(parsed["--work-id"]);
    const stageDir = await checkedStage(root, parsed["--stage-dir"]);
    const exchange = createJournalWorkExchange({ root, secret: await journalWorkExchangeSecret(environment) });
    const status = await exchange.stagedStatus({ stageDir, workId });
    if (command === "stage-check") { stdout.write(`${JSON.stringify(status)}\n`); return; }
    let execution;
    try { execution = JSON.parse(parsed["--execution-json"]); } catch { fail("JOURNAL_WORK_EXECUTION_INVALID"); }
    const dispatch = (await createJournalWorkDispatchReader({ root }).listDispatch()).find((item) => item.work_id === workId);
    if (dispatch?.tier !== "hardest" || dispatch.model !== "claude-opus-5-5" || dispatch.effort !== "max"
      || Date.parse(dispatch.expires_at) <= Date.now()
      || parsed["--subject"] !== "local:claude-hardest"
      || execution?.profile_evidence !== "claude_code_model_usage_reported"
      || execution.effective_model_profile !== dispatch.model || execution.effective_effort !== dispatch.effort
      || !CONTEXT.test(execution.request_context_id ?? "") || Object.keys(execution).length !== 4) {
      fail("JOURNAL_WORK_EXECUTION_INVALID");
    }
    if (dispatch.answered) {
      stdout.write('{"answered":false,"already":true}\n');
      return;
    }
    const result = await exchange.promoteStaged({ stageDir, workId, execution, subject: parsed["--subject"] });
    stdout.write(`${JSON.stringify({ answered: !result.already, already: result.already })}\n`);
    return;
  }
  fail("JOURNAL_WORK_COMMAND_INVALID");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runJournalWork(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${typeof error?.code === "string" ? error.code : "JOURNAL_WORK_COMMAND_FAILED"}\n`);
    process.exitCode = 1;
  }
}
