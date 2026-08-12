import { createInnerSignalServer } from "./create-server.mjs";

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

/**
 * Start Inner Signal on IPv4 loopback and, when the OS supports it, IPv6
 * loopback too. The application remains local-only; it never binds to a LAN
 * interface. `localhost` and `127.0.0.1` therefore both work on normal Linux
 * configurations without exposing therapy traffic to the local network.
 */
export async function listenInnerSignalLoopback({ config, providers, port = config.port }) {
  const ipv4 = createInnerSignalServer({ config, providers });
  await listen(ipv4, port, "127.0.0.1");
  const actualPort = ipv4.address().port;

  let ipv6 = null;
  try {
    ipv6 = createInnerSignalServer({ config, providers });
    await listen(ipv6, actualPort, "::1");
  } catch (error) {
    await closeServer(ipv6).catch(() => {});
    ipv6 = null;
    if (!["EADDRNOTAVAIL", "EAFNOSUPPORT", "EPROTONOSUPPORT", "EINVAL", "EADDRINUSE"].includes(error?.code)) {
      await closeServer(ipv4).catch(() => {});
      throw error;
    }
  }

  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    ipv4Url: `http://127.0.0.1:${actualPort}`,
    ipv6Available: Boolean(ipv6),
    servers: [ipv4, ...(ipv6 ? [ipv6] : [])],
    async close() {
      await Promise.all([closeServer(ipv4), closeServer(ipv6)]);
    }
  };
}
