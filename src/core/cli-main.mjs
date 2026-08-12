function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
    details: error?.details,
    cause: error?.cause?.message
  };
}

export async function runCliMain(main) {
  try {
    const result = await main();
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: serializeError(error) }, null, 2));
    process.exitCode = 1;
  }
}
