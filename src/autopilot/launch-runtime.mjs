import { createInnerSignalServer } from "../server/create-server.mjs";
import { loadPrivateRuntimeAccessFromEnvironment } from "../storage/private-runtime-environment.mjs";

export async function launchRuntimeForeground({ config, providers, onProgress }) {
  const privateRuntime = await loadPrivateRuntimeAccessFromEnvironment();
  const server = createInnerSignalServer({
    config,
    providers,
    privateCaseAccessService: privateRuntime?.privateCaseAccessService ?? null,
    privateAuthContext: privateRuntime?.privateAuthContext ?? null
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${config.port}`;
  onProgress?.({ stage: "local-app", status: "running", detail: url });
  console.log(`\nInner Signal is running at ${url}`);
  console.log("Open that address in your browser. Press Ctrl+C here to stop it safely.\n");

  try {
    await new Promise((resolve) => {
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        server.close(() => resolve());
        setTimeout(resolve, 2000).unref();
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
    onProgress?.({ stage: "local-app", status: "stopped", detail: "local server closed" });
  } finally {
    privateRuntime?.close();
  }
}
