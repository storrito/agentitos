// A PNG cut back to its top rows, without a package. Chrome's picture of a page is taken in a
// window taller than the frame: some Chromes count their own bars into the window, so that the
// page ends above the picture's bottom and the rest is black. Taken taller and cut here, the
// picture is the frame with any of them. A PNG stores its rows one after the other, each
// filtered against the row above only, so the first rows stand for themselves.
//
//   cutPng(file, height) → true when the file now holds a picture of that height

import fs from "node:fs";
import zlib from "node:zlib";

const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export function cutPng(file, height) {
  let png;
  try { png = fs.readFileSync(file); } catch { return false; }
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) return false;
  const chunks = [];
  for (let at = 8; at + 12 <= png.length;) {
    const n = png.readUInt32BE(at);
    chunks.push({ type: png.toString("latin1", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + n) });
    at += 12 + n;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR"), idat = chunks.filter((c) => c.type === "IDAT");
  if (!ihdr || !idat.length) return false;
  const head = Buffer.from(ihdr.data), width = head.readUInt32BE(0), tall = head.readUInt32BE(4), channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[head[9]];
  if (tall === height) return true;
  // too short to hold the frame, or stored interlaced (Chrome does neither)
  if (tall < height || !channels || head[12] !== 0) return false;
  const row = 1 + Math.ceil(width * channels * head[8] / 8);
  const rows = zlib.inflateSync(Buffer.concat(idat.map((c) => c.data))).subarray(0, row * height);
  head.writeUInt32BE(height, 4);
  // every other chunk stays where it was; the rows become one chunk in the place of the first
  let done = false;
  const out = [png.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === "IHDR") out.push(chunk("IHDR", head));
    else if (c.type === "IDAT") { if (!done) out.push(chunk("IDAT", zlib.deflateSync(rows))); done = true; }
    else out.push(chunk(c.type, c.data));
  }
  fs.writeFileSync(file, Buffer.concat(out));
  return true;
}
