import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const STATIC_EVIDENCE_EXTRACTORS = new Set(["pdftotext", "unzip"]);
const MAX_EXTRACTOR_BUFFER_BYTES = 16_000_000;

export function extractStaticSourceText(file) {
  const extension = path.extname(file).toLowerCase();
  try {
    if (extension === ".pdf") return extract("pdftotext", [file, "-"]);
    if ([".docx", ".pptx"].includes(extension)) {
      const pattern = extension === ".docx" ? "word/document.xml" : "ppt/slides/*.xml";
      return extract("unzip", ["-p", file, pattern]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function extract(command, args) {
  if (!STATIC_EVIDENCE_EXTRACTORS.has(command)) throw new Error(`Static Source extractor is not allowed: ${command}`);
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: MAX_EXTRACTOR_BUFFER_BYTES });
}
