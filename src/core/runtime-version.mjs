import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

export const RUNTIME_VERSION = String(pkg.version);
