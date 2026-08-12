import { createInnerSignalServer } from "../server/create-server.mjs";

export async function runRuntimeSmoke({ config, providers }) {
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json();
    return {
      ok: response.ok && body.ok === true,
      status: response.status,
      health: body
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
