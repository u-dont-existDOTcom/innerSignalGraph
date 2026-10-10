#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { isOutside } from "../core/private-path.mjs";
import { sourceFormatForPath, sourceParserCapabilities } from "../journal-import/parsers/index.mjs";
import { loadJournalInferencePortFromEnvironment } from "../journal-import/provider-runtime.mjs";
import { prepareJournalOperatorEnvironment } from "../journal-import/operator-auth.mjs";
import { journalCalibrationCriticalMissLimit, journalCalibrationFailureLimit, journalSemanticConcurrency,
  normalizeJournalHardestLaneConfig, vaultRootMatchesConfig } from "../journal-import/run-config.mjs";
import { PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES, createPrivateCaseAccessService } from "../storage/private-case-access.mjs";
import { loadHostedPrivateCaseOperatorProvidersFromEnvironment } from "../storage/hosted-private-case-providers.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export const JOURNAL_IMPORT_COMMANDS = Object.freeze([
  "doctor",
  "inventory",
  "stage",
  "run",
  "recalibrate",
  "resume-calibration",
  "build-quotes",
  "publish-quotes",
  "visual-only",
  "status",
  "verify",
  "audit",
  "patterns",
  "commit",
  "cold-test",
  "report",
  "export",
  "delete-plan"
]);

// Designed but not built yet: they fail with JOURNAL_COMMAND_NOT_AVAILABLE rather than open a run.
// The cold test still needs question freezing, the separate consumer and scoring wired together.
export const JOURNAL_IMPORT_PLANNED_COMMANDS = Object.freeze(["cold-test", "export"]);

export function journalImportHelp() {
  return [
    "InnerSignal private journal importer",
    "",
    "Usage:",
    "  npm run journal:import -- <command> --config /absolute/private/run.json [--env-file /absolute/private/file.env ...]",
    "  npm run journal:import -- doctor --mock",
    "",
    `Commands: ${JOURNAL_IMPORT_COMMANDS.filter((command) => !JOURNAL_IMPORT_PLANNED_COMMANDS.includes(command)).join(", ")}`,
    `Planned, not available yet: ${JOURNAL_IMPORT_PLANNED_COMMANDS.join(", ")}`,
    "",
    "The source, target and private receipts are never accepted as inline command arguments.",
    "Live mutation, disclosure, export and deletion remain denied unless the private configuration supplies their grants."
  ].join("\n");
}

export function parseJournalImportArgs(argv) {
  if (!Array.isArray(argv)) throw new ValidationError("Journal import arguments must be an array.");
  const args = [...argv];
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return Object.freeze({ help: true });
  const command = args.shift();
  if (!JOURNAL_IMPORT_COMMANDS.includes(command)) throw new ValidationError("Unknown journal import command.", { code: "JOURNAL_COMMAND_UNKNOWN" });
  const options = { command, configPath: null, mock: false, json: false, envFiles: [] };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--mock") options.mock = true;
    else if (flag === "--json") options.json = true;
    else if (flag === "--env-file") {
      const envFile = args.shift();
      if (!envFile || !path.isAbsolute(envFile)) throw new ValidationError("--env-file must be followed by an absolute private path.", { code: "JOURNAL_ENV_FILE_PATH_INVALID" });
      options.envFiles.push(path.normalize(envFile));
    } else if (flag === "--config") {
      const configPath = args.shift();
      if (!configPath || !path.isAbsolute(configPath)) throw new ValidationError("--config must be followed by an absolute private path.", { code: "JOURNAL_CONFIG_PATH_INVALID" });
      options.configPath = path.normalize(configPath);
    } else {
      throw new ValidationError("Unknown journal import option.", { code: "JOURNAL_OPTION_UNKNOWN" });
    }
  }
  if (options.mock && command !== "doctor") throw new ValidationError("--mock is supported only by doctor.", { code: "JOURNAL_MOCK_SCOPE_INVALID" });
  if (options.mock && options.envFiles.length > 0) throw new ValidationError("--env-file is not used with --mock.", { code: "JOURNAL_MOCK_SCOPE_INVALID" });
  if (!options.mock && !options.configPath) throw new ValidationError("A private --config path is required.", { code: "JOURNAL_CONFIG_REQUIRED" });
  return Object.freeze({ ...options, envFiles: Object.freeze(options.envFiles) });
}

export function mockJournalDoctorReport() {
  return Object.freeze({
    schema_version: 1,
    mode: "synthetic_mock",
    mutation_allowed: false,
    external_spend_usd: 0,
    capabilities: {
      source_mount: "synthetic",
      parser: "not_checked",
      private_target: "synthetic_only",
      inference_route: "mock_only",
      inference_isolation: "synthetic",
      archive_scope: "synthetic",
      semantic_scope: "unavailable",
      version_support: "contracts_loaded"
    },
    blockers: ["PRIVATE_CONFIGURATION_NOT_LOADED", "LIVE_MUTATION_DENIED"]
  });
}

// Judged on real locations, so a link can't smuggle a private file into the public checkout.
const outsideRepository = (candidate) => isOutside(repositoryRoot, candidate);

async function loadPrivateConfig(configPath) {
  if (!outsideRepository(configPath)) throw new ValidationError("Private journal configuration must remain outside the public repository.", { code: "JOURNAL_CONFIG_LOCATION_INVALID" });
  return withOpenedRegularFile(configPath, async (handle, information) => {
    if ((information.mode & 0o077) !== 0) throw new ValidationError("Private journal configuration must have mode 0600 or stricter.", { code: "JOURNAL_CONFIG_MODE_INVALID" });
    let value;
    try { value = JSON.parse(await handle.readFile("utf8")); }
    catch { throw new ValidationError("Private journal configuration is invalid.", { code: "JOURNAL_CONFIG_INVALID" }); }
    if (value?.schema_version !== 1 || !CASE_ID.test(value?.target_profile?.case_id ?? "")
        || typeof value?.private_runtime_root !== "string" || !path.isAbsolute(value.private_runtime_root)) {
      throw new ValidationError("Private journal configuration is unresolved.", { code: "JOURNAL_CONFIG_UNRESOLVED" });
    }
    return value;
  });
}

async function inspectConfiguredSource(configPath, config) {
  const bundleRoot = path.resolve(path.dirname(configPath), "..");
  const sourcePath = path.resolve(bundleRoot, config.source?.relative_path ?? "");
  if (!outsideRepository(sourcePath)) throw new ValidationError("Journal source must remain outside the public repository.", { code: "JOURNAL_SOURCE_LOCATION_INVALID" });
  return withOpenedRegularFile(sourcePath, async (handle, information) => {
    if ((information.mode & 0o077) !== 0) throw new ValidationError("Journal source must have mode 0600 or stricter.", { code: "JOURNAL_SOURCE_MODE_INVALID" });
    const bytes = await handle.readFile();
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    // The runtime parses a non-PDF source as UTF-8 text, so it is supported exactly when it decodes.
    const format = sourceFormatForPath(sourcePath);
    let decodes = true;
    if (format === "text") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { decodes = false; }
    }
    bytes.fill(0);
    return Object.freeze({
      available: true,
      byte_length_matches: information.size === config.source.bytes,
      digest_matches: actualDigest === config.source.sha256,
      format: decodes ? format : "unknown"
    });
  });
}

async function inspectOperator(config, environment) {
  const requiredNames = [
    "INNER_SIGNAL_PRIVATE_ROOT",
    "INNER_SIGNAL_OAUTH_ISSUER",
    "INNER_SIGNAL_OAUTH_AUDIENCE",
    "INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON",
    "INNER_SIGNAL_OPERATOR_CASE_ACL_JSON",
    "INNER_SIGNAL_CASE_KEYS_JSON",
    "INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN"
  ];
  if (requiredNames.some((name) => typeof environment[name] !== "string" || environment[name].length === 0)) {
    return Object.freeze({ available: false, authorized_purposes: [], blocker: "OPERATOR_ENVIRONMENT_UNAVAILABLE" });
  }
  const providerEnvironment = { ...environment };
  const providers = loadHostedPrivateCaseOperatorProvidersFromEnvironment(providerEnvironment);
  const service = createPrivateCaseAccessService({
    rootDir: providers.rootDir,
    authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider
  });
  try {
    if (!vaultRootMatchesConfig(config, providers.rootDir)) {
      return Object.freeze({ available: false, authorized_purposes: [], blocker: "OPERATOR_PRIVATE_ROOT_MISMATCH" });
    }
    const authContext = { bearerToken: environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN };
    const purposes = [PRIVATE_JOURNAL_PURPOSES.ARCHIVE, PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH, PRIVATE_JOURNAL_PURPOSES.SESSION_USE];
    const authorized = [];
    for (const purpose of purposes) {
      await service.verifyCaseAccess(config.target_profile.case_id, { requiredScope: PRIVATE_CASE_SCOPES.WRITE, requiredPurpose: purpose }, authContext);
      authorized.push(purpose);
    }
    return Object.freeze({ available: true, authorized_purposes: authorized, blocker: null });
  } catch {
    return Object.freeze({ available: false, authorized_purposes: [], blocker: "OPERATOR_AUTHORIZATION_DENIED" });
  } finally {
    providers.close();
  }
}

// What opening a run requires of the config, checked the way the run checks it, so doctor never
// passes a config that every real command would then refuse.
function runConfigBlockers(config) {
  const blockers = [];
  try { journalSemanticConcurrency(config); }
  catch (error) { blockers.push(error.code ?? "JOURNAL_SEMANTIC_CONCURRENCY_INVALID"); }
  try { journalCalibrationFailureLimit(config); }
  catch (error) { blockers.push(error.code ?? "JOURNAL_CALIBRATION_FAILURE_LIMIT_INVALID"); }
  try { journalCalibrationCriticalMissLimit(config); }
  catch (error) { blockers.push(error.code ?? "JOURNAL_CALIBRATION_CRITICAL_MISS_LIMIT_INVALID"); }
  if (config.max_external_spend_usd !== 0) blockers.push("JOURNAL_ZERO_SPEND_REQUIRED");
  if (typeof config.execution_root !== "string" || !path.isAbsolute(config.execution_root)) blockers.push("JOURNAL_EXECUTION_ROOT_REQUIRED");
  else if (!outsideRepository(config.execution_root)) blockers.push("JOURNAL_EXECUTION_ROOT_PRIVATE_REQUIRED");
  if (typeof config.existing_grant_ref !== "string" || !config.existing_grant_ref) blockers.push("JOURNAL_GRANT_REFERENCE_REQUIRED");
  if (typeof config.source?.relative_path !== "string" || !config.source.relative_path
    || !Number.isSafeInteger(config.source.bytes) || !/^[0-9a-f]{64}$/u.test(config.source.sha256 ?? "")) blockers.push("JOURNAL_SOURCE_BINDING_REQUIRED");
  // An empty source has nothing to import: no unit or page would ever reach a later stage.
  else if (config.source.bytes <= 0) blockers.push("JOURNAL_SOURCE_EMPTY");
  return blockers;
}

export async function configuredJournalDoctorReport(configPath, environment = process.env, {
  inferencePortLoader = loadJournalInferencePortFromEnvironment
} = {}) {
  const config = await loadPrivateConfig(configPath);
  const blockers = runConfigBlockers(config);
  let source;
  try { source = await inspectConfiguredSource(configPath, config); }
  catch (error) { source = { available: false, byte_length_matches: false, digest_matches: false, format: "unknown" }; blockers.push(error?.code ?? "SOURCE_UNAVAILABLE"); }
  if (source.available && (!source.byte_length_matches || !source.digest_matches)) blockers.push("SOURCE_BINDING_MISMATCH");
  const parser = sourceParserCapabilities();
  if (!parser.formats[source.format]) blockers.push("FORMAT_UNSUPPORTED");
  let operator;
  try { operator = await inspectOperator(config, environment); }
  catch { operator = { available: false, authorized_purposes: [], blocker: "OPERATOR_CONFIGURATION_INVALID" }; }
  if (operator.blocker) blockers.push(operator.blocker);
  let inference;
  try {
    const port = inferencePortLoader({ ...environment }, {
      caseId: config.target_profile.case_id,
      hardestLane: normalizeJournalHardestLaneConfig(config)
    });
    try {
      await port.prepare?.();
      inference = port.capabilities();
    }
    finally { port.close?.(); }
  } catch (error) {
    inference = { enabled: false, live_inference: false, external_spend_authorized_usd: 0 };
    blockers.push(error?.code ?? "INFERENCE_ISOLATION_UNAVAILABLE");
  }
  const inferenceIsolationAvailable = inference.enabled === true
    && inference.packet_only === true
    && inference.fresh_context_per_generate === true;
  const inferenceExecutionProfileAvailable = inference.enabled === true
    && inference.authenticated_execution_profile_per_generate === true;
  const hardestEnabled = normalizeJournalHardestLaneConfig(config).enabled;
  const hardestIsolationAvailable = !hardestEnabled || inference.hardest_fresh_context_per_generate === true;
  const hardestExecutionProfileAvailable = !hardestEnabled
    || inference.hardest_authenticated_execution_profile_per_generate === true;
  const inferenceAuthorized = inferenceIsolationAvailable && inferenceExecutionProfileAvailable
    && hardestIsolationAvailable && hardestExecutionProfileAvailable;
  if (!inferenceIsolationAvailable) blockers.push("INFERENCE_ISOLATION_UNAVAILABLE");
  if (inference.enabled && !inferenceExecutionProfileAvailable) blockers.push("JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
  if (!hardestIsolationAvailable) blockers.push("INFERENCE_ISOLATION_UNAVAILABLE");
  if (!hardestExecutionProfileAvailable) blockers.push("JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
  if ((inference.external_spend_authorized_usd ?? 0) > config.max_external_spend_usd) blockers.push("INFERENCE_ALLOWANCE_EXCEEDS_CONFIG");
  return Object.freeze({
    schema_version: 1,
    mode: config.mode,
    mutation_allowed: operator.available,
    external_spend_usd: 0,
    capabilities: {
      source_mount: source.available && source.byte_length_matches && source.digest_matches ? "verified" : "unavailable",
      parser: parser.formats[source.format]?.adapter ?? "unsupported",
      private_target: operator.available ? "authorized_operator" : "unavailable",
      inference_route: inferenceAuthorized ? "authorized" : "unavailable",
      inference_isolation: inferenceIsolationAvailable ? "packet_only_fresh_context" : "unavailable",
      archive_scope: operator.authorized_purposes.includes(PRIVATE_JOURNAL_PURPOSES.ARCHIVE) ? "authorized" : "unavailable",
      semantic_scope: operator.authorized_purposes.includes(PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH) && inferenceAuthorized ? "authorized" : "unavailable",
      version_support: "contracts_loaded"
    },
    blockers: [...new Set(blockers)].sort()
  });
}

export async function runJournalImportCli(argv, { stdout = process.stdout, stderr = process.stderr, environment = process.env, runtimeFactory = null } = {}) {
  try {
    const parsed = parseJournalImportArgs(argv);
    if (parsed.help) {
      stdout.write(`${journalImportHelp()}\n`);
      return 0;
    }
    if (parsed.command === "doctor" && parsed.mock) {
      stdout.write(`${JSON.stringify(mockJournalDoctorReport())}\n`);
      return 0;
    }
    // Unavailable commands are refused before any private file is read or any sign-in is attempted.
    if (JOURNAL_IMPORT_PLANNED_COMMANDS.includes(parsed.command)) {
      throw new ValidationError("This journal import command isn't available yet.", { code: "JOURNAL_COMMAND_NOT_AVAILABLE" });
    }
    // The private config is checked before any env file is read or any sign-in is attempted. Doctor
    // reports run-config blockers itself; every other command stops on the first one here, with the
    // same code the run would give.
    const config = await loadPrivateConfig(parsed.configPath);
    if (parsed.command !== "doctor") {
      const [blocker] = runConfigBlockers(config);
      if (blocker) throw new ValidationError("The private journal configuration can't open a run.", { code: blocker });
    }
    // Private env files and the operator's renewing sign-in, for doctor and every run command.
    const prepared = await prepareJournalOperatorEnvironment(environment, { envFiles: parsed.envFiles, config });
    if (parsed.command === "doctor") {
      stdout.write(`${JSON.stringify(await configuredJournalDoctorReport(parsed.configPath, prepared.environment))}\n`);
      return 0;
    }
    // The configured one-shot operator owns writes. The MCP remains read-only.
    const openRuntime = runtimeFactory ?? (await import("../journal-import/private-runtime.mjs")).openJournalExecutionRuntime;
    const runtime = await openRuntime({ config, configPath: parsed.configPath, environment: prepared.environment,
      ...(prepared.authContextProvider ? { authContextProvider: prepared.authContextProvider } : {}) });
    try { stdout.write(`${JSON.stringify(await runtime.execute(parsed.command))}\n`); }
    finally { await runtime.close(); }
    return 0;
  } catch (error) {
    const code = error?.code ?? "JOURNAL_COMMAND_FAILED";
    stderr.write(`${JSON.stringify({ error: code })}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.exitCode = await runJournalImportCli(process.argv.slice(2));
}
