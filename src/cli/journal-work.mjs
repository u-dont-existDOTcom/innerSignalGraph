import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertJournalWorkExchangeRoot, assertJournalWorkId, createJournalWorkDispatchReader,
  createJournalWorkExchange, journalWorkExchangeSecret, journalWorkFileKey, resolveJournalWorkExchangeRoot
} from "../journal-import/work-exchange.mjs";
import { journalWorkPacketValue, MAX_HARDEST_PACKET_CHARS } from "../journal-import/packet-bounds.mjs";

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

export async function writeAttemptMarker(marker, value, exclusive = false) {
  const target = `${marker}.${randomUUID()}.tmp`;
  const handle = await fs.open(target, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  catch (error) { await handle.close(); await fs.unlink(target).catch(() => {}); throw error; }
  await handle.close();
  try {
    if (exclusive) await fs.link(target, marker);
    else await fs.rename(target, marker);
  } finally { await fs.unlink(target).catch((error) => { if (error?.code !== "ENOENT") throw error; }); }
  await syncDirectory(path.dirname(marker));
}

// The explicit dispatch identity covers both reference :resend:N keys and :rN
// successors. Hardest records must never fall back to their changing work IDs.
export function journalAttemptIdentity(record) {
  if (!/^[0-9a-f]{48}$/u.test(record?.attempt_identity ?? "")) fail("JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED");
  return record.attempt_identity;
}

// Keep the earlier worker's marker filename for the base digest. Adding an
// explicit dispatch identity must not reset existing attempted/isolation holds.
export const journalAttemptMarkerKey = identity => journalWorkFileKey(`journal-work:${identity}`);

export async function releaseAttemptMarker(marker, claim) {
  const temporary = `${marker}.${randomUUID()}.tmp`;
  try { await fs.rename(marker, temporary); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  try {
    const value = JSON.parse(await fs.readFile(temporary, "utf8"));
    if (value.claim !== claim || value.status !== "reserved") fail("JOURNAL_WORK_ATTEMPT_INVALID");
  } catch (error) {
    // A mark that won before the rename must survive. A concurrent mark that
    // recreated the canonical path is already safe; never overwrite it.
    try { await fs.link(temporary, marker); }
    catch (restoreError) { if (restoreError?.code !== "EEXIST") throw restoreError; }
    throw error;
  } finally {
    await fs.unlink(temporary);
    await syncDirectory(path.dirname(marker));
  }
}

async function sweepAttemptTemporaries(directory) {
  for (const name of await fs.readdir(directory)) {
    if (!/^[0-9a-f]{64}\.json\.[0-9a-f-]{36}\.tmp$/u.test(name)) continue;
    const target = path.join(directory, name);
    try {
      const info = await fs.lstat(target);
      if (info.isFile() && info.mtimeMs < Date.now() - 3_600_000) await fs.unlink(target);
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

async function attemptDirectory(root) {
  const directory = path.join(root, "claude-attempts");
  await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (error?.code !== "EEXIST") throw error; });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700
    || (process.getuid && info.uid !== process.getuid()) || await fs.realpath(directory) !== directory) {
    fail("JOURNAL_WORK_ATTEMPT_DIR_INSECURE");
  }
  await sweepAttemptTemporaries(directory);
  return directory;
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
    try {
      const info = await fs.lstat(target);
      if (info.isDirectory() && (info.mode & 0o777) === 0o700
        && (!process.getuid || info.uid === process.getuid()) && info.mtimeMs < Date.now() - ttl) {
        await fs.rm(target, { recursive: true, force: false });
        removed += 1;
      }
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
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
      const { work_id, attempt_identity, role, output_schema_name, model, effort, tier = "standard", issued_at, expires_at, answered } = record;
      stdout.write(`${JSON.stringify({ work_id, attempt_identity, role, output_schema_name, model, effort, tier, issued_at, expires_at, answered })}\n`);
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
    await attemptDirectory(root);
    stdout.write(`${JSON.stringify({ removed: await sweepStages(root) })}\n`);
    return;
  }
  if (command === "packet-check") {
    const parsed = flags(options, ["--work-id"]);
    const exchange = createJournalWorkExchange({ root, secret: await journalWorkExchangeSecret(environment) });
    const entry = await exchange.readWork(assertJournalWorkId(parsed["--work-id"]));
    const packetLength = entry ? JSON.stringify(journalWorkPacketValue(entry)).length : null;
    const allowed = Boolean(entry && entry.tier === "hardest" && !exchange.isExpired(entry)
      && packetLength <= MAX_HARDEST_PACKET_CHARS);
    stdout.write(`${JSON.stringify({ allowed, packet_length: packetLength })}\n`);
    return;
  }
  if (["attempt-status", "attempt-reserve", "attempt-mark", "attempt-refuse", "attempt-release", "attempt-clear"].includes(command)) {
    const timeoutIndex = options.indexOf("--timeout-ms");
    let timeoutMs = 1_800_000;
    if (command === "attempt-reserve" && timeoutIndex >= 0) {
      timeoutMs = Number(options[timeoutIndex + 1]);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) fail("JOURNAL_WORK_ATTEMPT_INVALID");
      options.splice(timeoutIndex, 2);
    }
    // The worker passes the identity it read from the dispatch record, because the runtime removes the
    // record once the item is answered or retired. While the record exists, the two must agree.
    const identityIndex = options.indexOf("--attempt-identity");
    let suppliedIdentity = null;
    if (identityIndex >= 0) {
      suppliedIdentity = options[identityIndex + 1];
      if (!/^[0-9a-f]{48}$/u.test(suppliedIdentity ?? "")) fail("JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED");
      options.splice(identityIndex, 2);
    }
    const operatorCommand = ["attempt-status", "attempt-clear"].includes(command);
    const parsed = flags(options, operatorCommand ? ["--work-id"] : ["--work-id", "--claim"]);
    const value = parsed["--work-id"];
    const workId = assertJournalWorkId(value);
    if (!operatorCommand && !/^[0-9a-f-]{36}$/u.test(parsed["--claim"])) fail("JOURNAL_WORK_ATTEMPT_INVALID");
    const directory = await attemptDirectory(root);
    const dispatch = (await createJournalWorkDispatchReader({ root }).listDispatch()).find(item => item.work_id === workId);
    let identity;
    if (dispatch) {
      identity = journalAttemptIdentity(dispatch);
      if (suppliedIdentity !== null && suppliedIdentity !== identity) fail("JOURNAL_WORK_ATTEMPT_INVALID");
    } else if (command !== "attempt-reserve" && suppliedIdentity !== null) {
      identity = suppliedIdentity;
    } else {
      fail("JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED");
    }
    const marker = path.join(directory, `${journalAttemptMarkerKey(identity)}.json`);
    if (command === "attempt-reserve") {
      let claimed = true;
      try { await writeAttemptMarker(marker, { work_id: workId, attempt_identity: identity, status: "reserved", claim: parsed["--claim"], timeout_ms: timeoutMs }, true); }
      catch (error) { if (error?.code === "EEXIST") claimed = false; else throw error; }
      stdout.write(`${JSON.stringify({ claimed })}\n`);
      return;
    }
    let status = null, ageSeconds = null;
    try {
      // One no-follow handle supplies both the age and the content, so the two can't diverge.
      const handle = await fs.open(marker, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile()) fail("JOURNAL_WORK_ATTEMPT_INVALID");
        ageSeconds = Math.max(0, (Date.now() - info.mtimeMs) / 1000);
        try { status = JSON.parse(await handle.readFile("utf8")); } catch { status = { status: "attempted" }; }
      } finally { await handle.close(); }
      const legacyIdentity = /^journal-work:([0-9a-f]{48})(?::r[1-8])?$/u.exec(status?.work_id ?? "")?.[1];
      if (!status || (status.attempt_identity ?? legacyIdentity) !== identity
        || !["reserved", "attempted", "isolation_refused"].includes(status.status)
        || !/^[0-9a-f-]{36}$/u.test(status.claim ?? "")
        || (status.timeout_ms !== undefined && (!Number.isSafeInteger(status.timeout_ms)
          || status.timeout_ms < 1 || status.timeout_ms > 3_600_000))) status = { status: "attempted" };
      else status.attempt_identity = identity;
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (command === "attempt-clear") {
      if (status?.status !== "isolation_refused"
        && !(status?.status === "reserved" && ageSeconds * 1000 >= 2 * (status.timeout_ms ?? 1_800_000) + 600_000)) {
        fail("JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED");
      }
      await fs.unlink(marker);
      await syncDirectory(directory);
      stdout.write('{"cleared":true}\n');
      return;
    }
    if (command === "attempt-release" && status === null) {
      stdout.write('{"attempted":false,"status":"none","age_seconds":null}\n');
      return;
    }
    if (!operatorCommand && status?.claim !== parsed["--claim"]) fail("JOURNAL_WORK_ATTEMPT_INVALID");
    if (command === "attempt-mark" && status?.status === "reserved") {
      await writeAttemptMarker(marker, { ...status, status: "attempted" });
      status.status = "attempted";
    } else if (command === "attempt-refuse") {
      if (!["reserved", "attempted", "isolation_refused"].includes(status.status)) fail("JOURNAL_WORK_ATTEMPT_INVALID");
      await writeAttemptMarker(marker, { ...status, status: "isolation_refused" });
      status.status = "isolation_refused";
    } else if (command === "attempt-release") {
      if (status.status !== "reserved") fail("JOURNAL_WORK_ATTEMPT_INVALID");
      await releaseAttemptMarker(marker, parsed["--claim"]);
      status = null; ageSeconds = null;
    }
    stdout.write(`${JSON.stringify({ attempted: status !== null, status: status?.status ?? "none", age_seconds: ageSeconds })}\n`);
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
