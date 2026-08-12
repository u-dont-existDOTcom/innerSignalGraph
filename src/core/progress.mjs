export function createProgressReporter({ stream = process.stderr, prefix = "inner-signal" } = {}) {
  const started = Date.now();
  return (event) => {
    const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);
    const detail = event.detail ? ` — ${event.detail}` : "";
    stream.write(`[${prefix} +${elapsedSeconds}s] ${event.stage}: ${event.status}${detail}\n`);
  };
}
