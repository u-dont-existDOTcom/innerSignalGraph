import { assertJournalWorkExchangeRoot, resolveJournalWorkExchangeRoot } from "../journal-import/work-exchange.mjs";
import { readOwnerPublicKey } from "./sealed-box.mjs";
import { FEEDBACK_SETTINGS, readFeedbackSettings } from "./settings.mjs";
import { openFeedbackStore } from "./store.mjs";
import { createFeedbackService } from "./service.mjs";
import { createSendFeedbackTool } from "./tool.mjs";

// Builds the feedback place from configuration, or returns null while INNER_SIGNAL_FEEDBACK is off. The store's root gets the same
// checks as the journal work exchange's: an existing real directory outside the public checkout, owned by this process's user,
// mode 0700, in directories no other user can change. Whether the address agrees with the served rules is checked by the
// connector, which holds the rules (createPrivateCaseMcpServer).

const ROOT_PROBLEMS = Object.freeze({
  JOURNAL_WORK_EXCHANGE_ROOT_INVALID: "must name a directory, not a file or a symbolic link",
  JOURNAL_WORK_EXCHANGE_ROOT_MISSING: "must name an existing directory",
  JOURNAL_WORK_EXCHANGE_ROOT_INSIDE_REPOSITORY: "must be outside the repository",
  JOURNAL_WORK_EXCHANGE_ROOT_INSECURE: "must be owned by this process's user, have mode 0700, and sit in directories no other user can change"
});

export async function createFeedbackFromEnvironment({ environment = process.env, repositoryRoot, log = () => {}, rootOwner = undefined, now = undefined } = {}) {
  const settings = readFeedbackSettings(environment);
  if (!settings) return null;
  // Every failure about the root becomes fixed words naming the setting, with at most an allowlisted error code: a file system
  // error's own message would carry the configured path.
  const rootError = (error) => {
    const problem = ROOT_PROBLEMS[error?.code];
    if (problem) return new Error(`${FEEDBACK_SETTINGS.root} ${problem}.`);
    const code = typeof error?.code === "string" && /^E[A-Z]{2,12}$/u.test(error.code) ? ` (${error.code})` : "";
    return new Error(`${FEEDBACK_SETTINGS.root} could not be used${code}.`);
  };
  let root;
  try {
    root = await resolveJournalWorkExchangeRoot(settings.root, { outside: repositoryRoot });
    await assertJournalWorkExchangeRoot(root, rootOwner === undefined ? {} : { owner: rootOwner });
  } catch (error) {
    throw rootError(error);
  }
  let ownerPublicKey;
  try {
    ownerPublicKey = readOwnerPublicKey(settings.ownerPublicKey);
  } catch {
    throw new Error(`${FEEDBACK_SETTINGS.ownerPublicKey} must be an X25519 public key in base64url (43 characters).`);
  }
  let store;
  try {
    store = await openFeedbackStore({ root, ownerPublicKey, ...(now ? { now: () => new Date(now()) } : {}) });
  } catch (error) {
    throw rootError(error);
  }
  const service = createFeedbackService({
    store,
    ownerTokenSha256: settings.ownerTokenSha256,
    trustForwardedFor: settings.trustForwardedFor,
    log,
    ...(now ? { now } : {})
  });
  const tool = settings.tool ? createSendFeedbackTool({ service, publicUrl: settings.publicUrl }) : null;
  return Object.freeze({
    service,
    tool,
    publicUrl: settings.publicUrl,
    health: Object.freeze({ page: "on", tool: tool ? "on" : "off" }),
    close() { service.close(); }
  });
}
