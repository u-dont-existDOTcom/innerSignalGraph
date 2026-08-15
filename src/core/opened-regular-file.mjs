import fs from "node:fs";
import { open } from "node:fs/promises";

function noFollowFlags() {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) {
    const error = new Error("no-follow file opens are unavailable");
    error.code = "ERR_NOFOLLOW_UNAVAILABLE";
    throw error;
  }
  return fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
}

function requireRegularFile(openedStat) {
  if (!openedStat.isFile()) {
    const error = new Error("opened path is not a regular file");
    error.code = "ERR_NOT_REGULAR_FILE";
    throw error;
  }
}

export async function withOpenedRegularFile(filePath, reader) {
  if (typeof reader !== "function") throw new TypeError("reader must be a function");
  const handle = await open(filePath, noFollowFlags());
  try {
    const openedStat = await handle.stat();
    requireRegularFile(openedStat);
    return await reader(handle, openedStat);
  } finally {
    await handle.close();
  }
}

export function withOpenedRegularFileSync(filePath, reader) {
  if (typeof reader !== "function") throw new TypeError("reader must be a function");
  const descriptor = fs.openSync(filePath, noFollowFlags());
  try {
    const openedStat = fs.fstatSync(descriptor);
    requireRegularFile(openedStat);
    return reader(descriptor, openedStat);
  } finally {
    fs.closeSync(descriptor);
  }
}
