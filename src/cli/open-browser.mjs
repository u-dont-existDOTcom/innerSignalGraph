#!/usr/bin/env node
import { launchBrowser } from "../release/browser-launcher.mjs";

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: node src/cli/open-browser.mjs http://localhost:PORT");
  process.exitCode = 2;
} else {
  try {
    const result = await launchBrowser({ url: args[0] });
    if (!result.ok) {
      console.error(`Browser not opened: ${result.discovery.message}`);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(`Browser not opened: ${error.message}`);
    process.exitCode = 1;
  }
}
