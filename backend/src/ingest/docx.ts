// DOCX validation (type, size, and decompression limits) and text extraction into stable passages.
import mammoth from "mammoth";
import { DomainError } from "../domain/events";

export const DOCX_LIMITS = {
  maxEntries: 2000,
  maxUncompressedBytes: 40 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxExtractedChars: 400_000,
};

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/** Reads the ZIP central directory without inflating anything. Throws DomainError on malformed archives. */
export function readZipDirectory(buf: Buffer): ZipEntry[] {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new DomainError(400, "The file is not a valid DOCX (ZIP) document.", "invalid_docx");
  }
  // Find End Of Central Directory record (search backwards over the max comment length).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DomainError(400, "The DOCX archive is truncated or corrupt.", "invalid_docx");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new DomainError(400, "ZIP64 archives are not accepted.", "invalid_docx");
  }
  if (cdOffset + cdSize > buf.length) throw new DomainError(400, "The DOCX archive is corrupt.", "invalid_docx");
  if (count > DOCX_LIMITS.maxEntries) throw new DomainError(400, "The DOCX contains too many parts.", "docx_limits");
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new DomainError(400, "The DOCX central directory is corrupt.", "invalid_docx");
    }
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, compressedSize, uncompressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function checkDocxLimits(buf: Buffer, maxBytes: number): void {
  if (buf.length === 0) throw new DomainError(400, "The uploaded file is empty.", "invalid_docx");
  if (buf.length > maxBytes) {
    throw new DomainError(413, `The file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit.`, "upload_too_large");
  }
  const entries = readZipDirectory(buf);
  if (!entries.some((e) => e.name === "word/document.xml")) {
    throw new DomainError(400, "The archive is not a Word document (word/document.xml missing).", "invalid_docx");
  }
  let total = 0;
  for (const e of entries) {
    total += e.uncompressedSize;
    if (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > DOCX_LIMITS.maxCompressionRatio) {
      throw new DomainError(400, "The DOCX has a suspicious compression ratio and was rejected.", "docx_limits");
    }
  }
  if (total > DOCX_LIMITS.maxUncompressedBytes) {
    throw new DomainError(400, "The DOCX expands beyond the decompression limit.", "docx_limits");
  }
}

export async function extractDocxText(buf: Buffer, maxBytes: number): Promise<string> {
  checkDocxLimits(buf, maxBytes);
  let text: string;
  try {
    const out = await mammoth.extractRawText({ buffer: buf });
    text = out.value;
  } catch {
    throw new DomainError(400, "The DOCX could not be read.", "invalid_docx");
  }
  text = normalizeText(text);
  if (!text.trim()) throw new DomainError(400, "The DOCX contains no extractable text.", "empty_docx");
  if (text.length > DOCX_LIMITS.maxExtractedChars) throw new DomainError(400, "The DOCX text is too long.", "docx_limits");
  return text;
}

export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits extracted text into paragraph passages with exact offsets into the extracted text. */
export function splitPassages(text: string): { ordinal: number; text: string; start: number; end: number }[] {
  const out: { ordinal: number; text: string; start: number; end: number }[] = [];
  const re = /[^\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = m.index + raw.indexOf(trimmed);
    out.push({ ordinal: out.length + 1, text: trimmed, start, end: start + trimmed.length });
  }
  return out;
}
