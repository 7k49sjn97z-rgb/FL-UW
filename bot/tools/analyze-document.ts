import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import * as z from "zod/v4";

const execFileAsync = promisify(execFile);

const TEXT_EXT = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
]);
const DOC_EXT = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

type ExtractedDoc = {
  path: string;
  kind: string;
  bytes: number;
  textExcerpt: string | null;
  note: string | null;
};

type AnalyzeOk = {
  ok: true;
  workspaceDir: string;
  documents: ExtractedDoc[];
  eoHints: string[];
};

type AnalyzeErr = {
  ok: false;
  error: string;
};

function safeResolve(workspaceDir: string, rel: string): string | null {
  const cleaned = rel.replace(/^\/+/, "");
  if (cleaned.includes("..")) return null;
  const full = path.resolve(workspaceDir, cleaned);
  if (!full.startsWith(path.resolve(workspaceDir) + path.sep) && full !== path.resolve(workspaceDir)) {
    return null;
  }
  return full;
}

async function listCandidateFiles(
  workspaceDir: string,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || out.length >= 20) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      if (ent.name === "memory" || ent.name === "node_modules") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (DOC_EXT.has(ext)) out.push(full);
      }
    }
  }
  await walk(workspaceDir, 0);
  return out;
}

async function extractTxt(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return buf.toString("utf8").slice(0, 12_000);
}

async function extractDocx(file: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "python3",
    [
      "-c",
      `
import zipfile, sys, re
from xml.etree import ElementTree as ET
path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    xml = z.read("word/document.xml")
root = ET.fromstring(xml)
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
texts = [t.text for t in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t") if t.text]
print("\\n".join(texts)[:12000])
`,
      file,
    ],
    { timeout: 15_000, maxBuffer: 2_000_000 },
  );
  return stdout.trim();
}

async function extractPdf(file: string): Promise<string> {
  // Lean first cut: pull printable strings from the PDF bytes (no extra npm deps).
  const { stdout } = await execFileAsync(
    "python3",
    [
      "-c",
      `
import re, sys
data = open(sys.argv[1], "rb").read()
# Prefer text between BT/ET blocks when present; fallback to printable runs.
chunks = []
for m in re.finditer(rb"BT(.*?)ET", data, re.S):
    part = m.group(1)
    for s in re.findall(rb"\\((?:\\\\.|[^\\\\)])*\\)|\\<[^>]+\\>", part):
        raw = s
        if raw.startswith(b"(") and raw.endswith(b")"):
            raw = raw[1:-1].replace(b"\\\\n", b"\\n").replace(b"\\\\(", b"(").replace(b"\\\\)", b")")
            try:
                chunks.append(raw.decode("latin-1", "ignore"))
            except Exception:
                pass
text = "\\n".join(chunks)
if len(text.strip()) < 40:
    runs = re.findall(rb"[\\x20-\\x7e\\x0a\\x0d]{6,}", data)
    text = "\\n".join(r.decode("ascii", "ignore") for r in runs)
print(text[:12000])
`,
      file,
    ],
    { timeout: 15_000, maxBuffer: 2_000_000 },
  );
  return stdout.trim();
}

const EO_KEYWORDS = [
  "apolice",
  "apólice",
  "sinistro",
  "indeniza",
  "reclamac",
  "reclamação",
  "responsabilidade civil",
  "erro profissional",
  "omissão",
  "omissao",
  "e&o",
  "rc profissional",
  "contrato",
  "serviços profissionais",
  "servicos profissionais",
  "limite de indenização",
  "franquia",
  "processo",
];

function collectHints(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const kw of EO_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return hits.slice(0, 20);
}

export default defineTool({
  description: prompt`
    Extract E&O-relevant text from uploaded session workspace documents
    (PDF, DOCX, text, images). Call when the user uploaded files or when
    the analysis must cover "Análise de documentos". Pass relative paths
    or omit to scan the workspace.
  `,
  inputSchema: z.object({
    paths: z
      .array(z.string())
      .optional()
      .describe(
        "Optional relative paths inside the session workspace. If omitted, scans for common document types.",
      ),
  }),
  effect: "read",
  async execute({ paths }, ctx): Promise<AnalyzeOk | AnalyzeErr> {
    const workspaceDir = ctx.workspaceDir;
    if (!workspaceDir) {
      return { ok: false, error: "No session workspace directory available." };
    }

    let files: string[] = [];
    if (paths?.length) {
      for (const rel of paths) {
        const full = safeResolve(workspaceDir, rel);
        if (!full) continue;
        try {
          const st = await fs.stat(full);
          if (st.isFile()) files.push(full);
        } catch {
          /* skip missing */
        }
      }
    } else {
      files = await listCandidateFiles(workspaceDir);
    }

    if (!files.length) {
      return {
        ok: true,
        workspaceDir,
        documents: [],
        eoHints: [],
      };
    }

    const documents: ExtractedDoc[] = [];
    const hintSet = new Set<string>();

    for (const file of files.slice(0, 8)) {
      const ext = path.extname(file).toLowerCase();
      const rel = path.relative(workspaceDir, file);
      const st = await fs.stat(file);
      let textExcerpt: string | null = null;
      let note: string | null = null;
      let kind = ext.replace(".", "") || "file";

      try {
        if (TEXT_EXT.has(ext)) {
          textExcerpt = await extractTxt(file);
        } else if (ext === ".docx") {
          textExcerpt = await extractDocx(file);
        } else if (ext === ".pdf") {
          textExcerpt = await extractPdf(file);
          if (!textExcerpt) {
            note = "No extractable text found in PDF (may be scanned/image-only).";
          }
        } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
          kind = "image";
          note =
            "Image present; OCR not available in v1. Note filename and ask user for key facts if needed.";
        } else {
          note = `Unsupported extension ${ext} for text extraction.`;
        }
      } catch (err) {
        note = `Extraction failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (textExcerpt) {
        for (const h of collectHints(textExcerpt)) hintSet.add(h);
        if (textExcerpt.length > 8000) {
          textExcerpt = textExcerpt.slice(0, 8000) + "\n…[truncated]";
        }
      }

      documents.push({
        path: rel,
        kind,
        bytes: st.size,
        textExcerpt,
        note,
      });
    }

    return {
      ok: true,
      workspaceDir,
      documents,
      eoHints: [...hintSet],
    };
  },
});
