function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

export function crc32(buffer) {
  let c = 0xFFFFFFFF;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = ((date.getUTCHours() & 0x1F) << 11) | ((date.getUTCMinutes() & 0x3F) << 5) | ((Math.floor(date.getUTCSeconds() / 2)) & 0x1F);
  const day = ((year - 1980) << 9) | (((date.getUTCMonth() + 1) & 0x0F) << 5) | (date.getUTCDate() & 0x1F);
  return { time, day };
}

function u16(value) {
  const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xFFFF); return b;
}
function u32(value) {
  const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b;
}

export function createStoredZip(entries, now = new Date()) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime(now);

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/^\/+/, ""), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
    ]);
    locals.push(local);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralBody = Buffer.concat(centrals);
  const localBody = Buffer.concat(locals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBody.length), u32(localBody.length), u16(0)
  ]);
  return Buffer.concat([localBody, centralBody, end]);
}

import { inflateRawSync } from "node:zlib";

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const min = Math.max(0, buffer.length - 0xFFFF - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error("Invalid ZIP: end-of-central-directory record not found.");
}

export function validateZipPath(name) {
  if (typeof name !== "string" || !name || name.includes("\0")) throw new Error("Unsafe ZIP path: empty or NUL-containing name.");
  if (name.includes("\\")) throw new Error(`Unsafe ZIP path: backslashes are not allowed (${name}).`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new Error(`Unsafe ZIP path: absolute path (${name}).`);
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "" && !name.endsWith("/"))) {
    throw new Error(`Unsafe ZIP path: traversal or ambiguous segment (${name}).`);
  }
  return name;
}

export function readZipEntries(buffer, {
  maxEntries = 5000,
  maxTotalUncompressedBytes = 64 * 1024 * 1024,
  maxEntryUncompressedBytes = 32 * 1024 * 1024
} = {}) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 22) throw new Error("Invalid ZIP: file is too short.");
  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) throw new Error("Unsupported ZIP: multi-disk archives are not allowed.");
  if (totalEntries > maxEntries) throw new Error(`ZIP contains too many entries (${totalEntries}).`);
  if (centralOffset + centralSize > eocd || centralOffset < 0) throw new Error("Invalid ZIP: central directory is out of bounds.");

  const result = new Map();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP: malformed central directory entry.");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > buffer.length) throw new Error("Invalid ZIP: central directory name is out of bounds.");
    const encoding = (flags & 0x0800) ? "utf8" : "utf8";
    const name = buffer.subarray(nameStart, nameEnd).toString(encoding);
    validateZipPath(name);
    if (result.has(name)) throw new Error(`Invalid ZIP: duplicate entry ${name}.`);
    const unixMode = (externalAttributes >>> 16) & 0xFFFF;
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`Unsafe ZIP entry: symbolic links are not allowed (${name}).`);
    if (flags & 0x0001) throw new Error(`Unsupported ZIP: encrypted entry ${name}.`);
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
    if (uncompressedSize > maxEntryUncompressedBytes) throw new Error(`ZIP entry is too large: ${name}.`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalUncompressedBytes) throw new Error("ZIP expands beyond the allowed size.");

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP: local header missing for ${name}.`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`Invalid ZIP: compressed data is out of bounds for ${name}.`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    try {
      data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    } catch (error) {
      throw new Error(`Invalid ZIP: cannot inflate ${name}: ${error.message}`);
    }
    if (data.length !== uncompressedSize) throw new Error(`Invalid ZIP: size mismatch for ${name}.`);
    if (crc32(data) !== expectedCrc) throw new Error(`Invalid ZIP: CRC mismatch for ${name}.`);
    if (!name.endsWith("/")) result.set(name, data);
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error("Invalid ZIP: central directory length mismatch.");
  return result;
}
