/**
 * Campus News — Bild-Upload.
 *
 * Bewusst kein Multipart-Parser: die Redaktions-Oberfläche schickt die Datei
 * als rohen Body mit passendem Content-Type:
 *   fetch("/api/admin/uploads", { method: "POST", headers: { "Content-Type": file.type }, body: file })
 * Damit bleibt der Server abhängigkeitsfrei (kein multer/busboy).
 *
 * Sicherheit: MIME-Allowlist, Magic-Byte-Prüfung, Größenlimit, zufälliger
 * Dateiname, Ablage außerhalb von public/ (Auslieferung über /uploads/).
 */
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { UPLOAD_DIR } from "./db.js";
import { sendJson } from "./http.js";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);

const IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

function looksLikeImage(type, buffer) {
  if (type === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (type === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (type === "image/gif") return buffer.subarray(0, 3).toString("ascii") === "GIF";
  if (type === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

export async function handleUpload(req, res, user) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) {
    sendJson(res, 415, { error: "Nur PNG, JPEG, WEBP oder GIF. Bitte ein Bild auswählen." });
    return;
  }

  const chunks = [];
  let size = 0;
  let tooBig = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) { tooBig = true; break; }
    chunks.push(chunk);
  }

  if (tooBig) {
    sendJson(res, 413, {
      error: `Das Bild ist zu groß (max. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB). Bitte vorher verkleinern.`
    });
    return;
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.length < 32) {
    sendJson(res, 400, { error: "Die Datei ist leer." });
    return;
  }
  if (!looksLikeImage(type, buffer)) {
    sendJson(res, 415, { error: "Die Datei ist kein gültiges Bild." });
    return;
  }

  const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), buffer);

  sendJson(res, 201, {
    url: `/uploads/${name}`,
    bytes: buffer.length,
    uploadedBy: user.username
  });
}
