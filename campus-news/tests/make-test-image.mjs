/**
 * Erzeugt ein einfaches PNG (1200x675) ohne externe Bibliotheken —
 * nur für den End-to-End-Test des Bild-Uploads im Redaktionsbereich.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1200, H = 675;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc((W * 3 + 1) * H);
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // Filter: none
  for (let x = 0; x < W; x++) {
    const t = x / W;
    raw[o++] = Math.round(11 + t * 40);
    raw[o++] = Math.round(11 + t * 24);
    raw[o++] = Math.round(14 + t * 12);
  }
}
// roter Signalstreifen (Markenfarbe) + helle Blöcke als "Layout"
for (let y = 120; y < 168; y++) for (let x = 80; x < 420; x++) {
  const i = (y * (W * 3 + 1)) + 1 + x * 3;
  raw[i] = 255; raw[i + 1] = 59; raw[i + 2] = 31;
}
for (let y = 240; y < 300; y++) for (let x = 80; x < 900; x++) {
  const i = (y * (W * 3 + 1)) + 1 + x * 3;
  raw[i] = 242; raw[i + 1] = 242; raw[i + 2] = 239;
}
for (let y = 330; y < 370; y++) for (let x = 80; x < 700; x++) {
  const i = (y * (W * 3 + 1)) + 1 + x * 3;
  raw[i] = 150; raw[i + 1] = 150; raw[i + 2] = 158;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // Bittiefe
ihdr[9] = 2;  // Truecolor RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

const target = process.argv[2] || "artikelbild.png";
writeFileSync(target, png);
console.log(`${target}: ${W}x${H}, ${(png.length / 1024).toFixed(1)} KB`);
