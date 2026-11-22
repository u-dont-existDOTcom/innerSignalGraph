import path from "node:path";
import { readOnOffSetting } from "../core/on-off-setting.mjs";

// The feedback switches and settings (design section 13). Both switches are off unless set; with the page's switch on, the root,
// the owner's key, the token's hash and the page's address are all required. Errors name the setting, never its value.

export const FEEDBACK_SETTINGS = Object.freeze({
  page: "INNER_SIGNAL_FEEDBACK",
  tool: "INNER_SIGNAL_FEEDBACK_TOOL",
  root: "INNER_SIGNAL_FEEDBACK_ROOT",
  ownerPublicKey: "INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY",
  ownerTokenSha256: "INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256",
  publicUrl: "INNER_SIGNAL_FEEDBACK_PUBLIC_URL",
  trustForwardedFor: "INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR"
});

function onOff(environment, name) {
  const reading = readOnOffSetting(environment[name]);
  if (reading === null) throw new Error(`${name} must be true or false.`);
  return reading;
}

// Null while the page's switch is off (and then the tool's switch must be off too); otherwise the checked settings.
export function readFeedbackSettings(environment = process.env) {
  const page = onOff(environment, FEEDBACK_SETTINGS.page);
  const tool = onOff(environment, FEEDBACK_SETTINGS.tool);
  const trustForwardedFor = onOff(environment, FEEDBACK_SETTINGS.trustForwardedFor);
  if (!page) {
    if (tool) throw new Error(`${FEEDBACK_SETTINGS.tool} needs ${FEEDBACK_SETTINGS.page} on.`);
    return null;
  }
  const value = (name) => {
    const raw = environment[name];
    if (typeof raw !== "string" || raw.trim() === "") throw new Error(`${name} is required when ${FEEDBACK_SETTINGS.page} is on.`);
    return raw.trim();
  };
  const root = value(FEEDBACK_SETTINGS.root);
  if (!path.isAbsolute(root)) throw new Error(`${FEEDBACK_SETTINGS.root} must be an absolute path.`);
  const ownerPublicKey = value(FEEDBACK_SETTINGS.ownerPublicKey);
  const ownerTokenSha256 = value(FEEDBACK_SETTINGS.ownerTokenSha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(ownerTokenSha256)) throw new Error(`${FEEDBACK_SETTINGS.ownerTokenSha256} must be 64 hex characters.`);
  let publicUrl;
  try {
    publicUrl = new URL(value(FEEDBACK_SETTINGS.publicUrl));
  } catch {
    throw new Error(`${FEEDBACK_SETTINGS.publicUrl} must be an https address.`);
  }
  if (publicUrl.protocol !== "https:" || publicUrl.search || publicUrl.hash || !/\/feedback$/u.test(publicUrl.pathname.replace(/\/$/u, ""))) {
    throw new Error(`${FEEDBACK_SETTINGS.publicUrl} must be an https address whose path ends in /feedback.`);
  }
  return Object.freeze({
    tool,
    trustForwardedFor,
    root,
    ownerPublicKey,
    ownerTokenSha256,
    publicUrl: publicUrl.toString().replace(/\/$/u, "")
  });
}
