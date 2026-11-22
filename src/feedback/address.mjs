// The feedback page's address (design section 3). One constant: the served sentence, the runner's button and the setting
// INNER_SIGNAL_FEEDBACK_PUBLIC_URL must equal it. Tests check the first two; the connector refuses to start with the page on when
// the packaged rules name an address the setting doesn't match. The owner settles the address before the first release that
// names it (design owner point 1); until then this is the server's own address.
export const FEEDBACK_PAGE_URL = "https://private-mcp.185-233-106-15.sslip.io/feedback";

// An https address whose path is exactly /feedback: a structural match on the served text, no judgment of meaning.
const NAMED_ADDRESS = /https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/feedback(?![A-Za-z0-9/_-])/u;

// The feedback address the packaged rules name, or null. Read from the protocol the connector serves (its instructions and its
// reference files), so it follows the image, not a setting: when the rules name an address and the page is off, the connector
// answers that address with a closed page instead of a 404.
export function feedbackAddressInRules(protocol) {
  if (!protocol) return null;
  const texts = [protocol.instructions, ...(Array.isArray(protocol.files) ? protocol.files.map((file) => file?.content) : [])];
  for (const text of texts) {
    const match = typeof text === "string" ? NAMED_ADDRESS.exec(text) : null;
    if (match) return match[0];
  }
  return null;
}
