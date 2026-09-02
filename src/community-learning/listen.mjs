import { createInnerSignalCommunityServer } from "./server.mjs";

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function listenInnerSignalCommunity({
  rootDir,
  port = 8790,
  host = "127.0.0.1",
  inviteCode = "",
  moderatorKey = "",
  requireInviteCode = !["127.0.0.1", "::1", "localhost"].includes(host),
  sessionDays = 30,
  mainAppUrl = "http://localhost:8787",
  seedCards = null,
  clock = () => new Date()
}) {
  if (requireInviteCode && !String(inviteCode).trim()) {
    throw new Error("COMMUNITY_INVITE_CODE is required when InnerSignal Commons is not bound exclusively to loopback.");
  }
  if (requireInviteCode && !String(moderatorKey).trim()) {
    throw new Error("COMMUNITY_MODERATOR_KEY is required when InnerSignal Commons is not bound exclusively to loopback.");
  }
  const server = createInnerSignalCommunityServer({
    rootDir,
    inviteCode,
    moderatorKey,
    requireInviteCode,
    sessionDays,
    mainAppUrl,
    seedCards,
    clock
  });
  await listen(server, port, host);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = host === "0.0.0.0" ? "localhost" : host === "::" ? "localhost" : host;
  return {
    server,
    port: actualPort,
    host,
    url: `http://${displayHost.includes(":") ? `[${displayHost}]` : displayHost}:${actualPort}`,
    async close() { await closeServer(server); }
  };
}
