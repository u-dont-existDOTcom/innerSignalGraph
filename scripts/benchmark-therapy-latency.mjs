#!/usr/bin/env node
import { runTherapyLatencyBenchmark } from "../src/autopilot/therapy-latency-benchmark.mjs";

function iterationsFromArgs(argv) {
  const argument = argv.find((item) => item.startsWith("--iterations="));
  return argument ? Number.parseInt(argument.slice("--iterations=".length), 10) : 3;
}

const result = await runTherapyLatencyBenchmark({ iterations: iterationsFromArgs(process.argv.slice(2)) });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
