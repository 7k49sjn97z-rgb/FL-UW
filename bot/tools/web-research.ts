import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { digitsOnly, formatCnpj } from "../lib/cnpj";

type ResearchHit = {
  title: string;
  url: string;
  snippet: string;
  query: string;
};

type ResearchOk = {
  ok: true;
  companyName: string;
  cnpjFormatted: string | null;
  queries: string[];
  hits: ResearchHit[];
  notes: string[];
};

type ResearchErr = {
  ok: false;
  error: string;
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHref(href: string): string {
  try {
    if (href.startsWith("//duckduckgo.com/l/?")) {
      const u = new URL("https:" + href);
      const uddg = u.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch {
    /* keep original */
  }
  return href;
}

async function searchDuckDuckGo(
  query: string,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url =
    "https://html.duckduckgo.com/html/?" +
    new URLSearchParams({ q: query }).toString();
  const res = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent":
        "Mozilla/5.0 (compatible; fl-uw-chat/0.1; +https://cursor.com)",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blockRe =
    /<div[^>]*class="[^"]*result[^"]*"[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < 5) {
    const href = decodeHref(match[1] ?? "");
    const title = stripTags(match[2] ?? "");
    const snippet = stripTags(match[3] || match[4] || "");
    if (!href || !title) continue;
    if (href.includes("duckduckgo.com")) continue;
    results.push({ title, url: href, snippet });
  }
  return results;
}

export default defineTool({
  description: prompt`
    Complementary public-web research for E&O / RC Profissional risk
    signals (official site, news, complaints, public litigation hints,
    professional reputation). Call after lookup-cnpj with the legal name
    and CNPJ. Does not invent facts — returns search hits and snippets only.
  `,
  inputSchema: z.object({
    companyName: z.string().min(2).describe("Razão social or trade name."),
    cnpj: z.string().optional().describe("CNPJ digits or formatted."),
    focus: z
      .string()
      .optional()
      .describe(
        "Optional extra focus, e.g. CNAE description or known brand site.",
      ),
  }),
  effect: "read",
  async execute({ companyName, cnpj, focus }): Promise<ResearchOk | ResearchErr> {
    const name = companyName.trim();
    if (!name) {
      return { ok: false, error: "companyName is required." };
    }

    const digits = cnpj ? digitsOnly(cnpj) : "";
    const formatted = digits.length === 14 ? formatCnpj(digits) : null;
    const queries = [
      `"${name}"`,
      `"${name}" reclamações OR processo OR indenização`,
      `"${name}" "responsabilidade civil" OR "erro profissional" OR E&O`,
    ];
    if (formatted) queries.push(`"${formatted}" OR "${digits}"`);
    if (focus?.trim()) queries.push(`${name} ${focus.trim()}`);

    const hits: ResearchHit[] = [];
    const notes: string[] = [];
    const seen = new Set<string>();

    for (const query of queries.slice(0, 4)) {
      try {
        const found = await searchDuckDuckGo(query);
        if (!found.length) {
          notes.push(`No HTML results for query: ${query}`);
          continue;
        }
        for (const item of found) {
          const key = item.url;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ ...item, query });
        }
      } catch (err) {
        notes.push(
          `Search failed for "${query}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      ok: true,
      companyName: name,
      cnpjFormatted: formatted,
      queries,
      hits: hits.slice(0, 12),
      notes,
    };
  },
});
