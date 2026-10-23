import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEval, includes, satisfies } from "@cursor/bdk/evals";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const questionario = readFileSync(
  join(root, "fixtures/docs/questionario-eo.md"),
  "utf8",
);

/** Mandatory analysis headings from the freeze line / hillclimb plan. */
const FORMAT =
  /\*\*Empresa:\*\*[\s\S]*### 1\. O que a empresa faz[\s\S]*### 2\. Detalhamento dos serviços profissionais[\s\S]*### 3\. Experiência[\s\S]*### 4\. Reputação[\s\S]*### 5\. Análise de documentos enviados[\s\S]*### 6\. Classificação do risco E&O[\s\S]*### 7\. Opinião sobre o risco[\s\S]*### Fontes consultadas/;

/** Accept bold risk label with optional trailing punctuation inside/outside marks. */
const RISK = /\*\*(Baixo|Médio|Alto)\.?\*\*|\b(Baixo|Médio|Alto)\b/;

export default defineEval({
  tags: ["freeze", "hillclimb", "smoke"],
  cases: [
    {
      id: "f1-clean-okbr",
      description:
        "F1 freeze: OKBR clean CNPJ → lookup + web-research + full E&O format; empty docs.",
      async test(t) {
        await t.send(
          "Produto: E&O / RC Profissional. Faça a análise preliminar completa de risco E&O do CNPJ 19.131.243/0001-97.",
        );
        t.succeeded();
        t.calledTool("lookup-cnpj");
        t.calledTool("web-research");
        t.check(t.reply, includes(FORMAT));
        t.check(t.reply, includes(RISK));
        t.check(t.reply, includes(/OPEN KNOWLEDGE BRASIL/i));
        t.check(t.reply, includes(/brasilapi\.com\.br/i));
        t.check(
          t.reply,
          includes(/Nenhum documento enviado|nenhum documento/i),
        );
      },
    },
    {
      id: "f2-noise-bb",
      description:
        "F2 freeze: Banco do Brasil noise → E&O format; stays on RC Profissional.",
      async test(t) {
        await t.send(
          "Produto: E&O / RC Profissional. Analise o risco E&O do CNPJ 00.000.000/0001-91. Foque em RC Profissional / Errors & Omissions, não em outros ramos.",
        );
        t.succeeded();
        t.calledTool("lookup-cnpj");
        t.calledTool("web-research");
        t.check(t.reply, includes(FORMAT));
        t.check(t.reply, includes(RISK));
        t.check(t.reply, includes(/BANCO DO BRASIL/i));
        t.check(t.reply, includes(/E&O|RC Profissional/i));
        t.check(t.reply, includes(/brasilapi\.com\.br/i));
      },
    },
    {
      id: "f3-doc-okbr",
      description:
        "F3 freeze: OKBR + questionario workspaceFiles → analyze-document + §5 facts.",
      async test(t) {
        await t.send(
          "Produto: E&O / RC Profissional. CNPJ 19.131.243/0001-97. Analise o risco E&O usando também o questionário anexado.",
          {
            workspaceFiles: {
              "questionario-eo.md": questionario,
            },
          },
        );
        t.succeeded();
        t.calledTool("lookup-cnpj");
        t.calledTool("web-research");
        t.calledTool("analyze-document");
        t.check(t.reply, includes(FORMAT));
        t.check(t.reply, includes(RISK));
        t.check(t.reply, includes(/questionario-eo\.md|questionário/i));
        // Fixture revenue may appear as 2.400.000 or paraphrased "2,4 milhões".
        t.check(t.reply, includes(/2\.?400\.?000|2,4\s*milh/i));
        t.check(t.reply, includes(/1\.?000\.?000|1\s*milh/i));
        t.check(
          t.reply,
          satisfies(
            (value) =>
              typeof value === "string" &&
              !/Nenhum documento enviado/i.test(value),
            "§5 must not claim no documents when questionnaire is attached",
          ),
        );
      },
    },
  ],
});
