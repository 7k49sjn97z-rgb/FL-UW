import { defineEval, includes } from "@cursor/bdk/evals";

/**
 * Post-analysis chatbot freeze (multi-turn). Does not modify F1–F3 cases.
 * Tags: chatbot, hillclimb (not `freeze` — keep `--tag freeze` = F1–F3 only).
 */
export default defineEval({
  tags: ["chatbot", "hillclimb"],
  cases: [
    {
      id: "followups-okbr",
      description:
        "After F1-style analysis, follow-ups stay grounded/E&O-focused without inventing litigation.",
      async test(t) {
        const analysis = await t.send(
          "Produto: E&O / RC Profissional. Faça a análise preliminar completa de risco E&O do CNPJ 19.131.243/0001-97.",
        );
        analysis.calledTool("lookup-cnpj");
        t.check(
          analysis.message,
          includes(/\*\*Empresa:\*\*[\s\S]*### 6\. Classificação do risco E&O[\s\S]*### Fontes consultadas/),
        );

        const redFlags = await t.send(
          "Quais são os principais red flags E&O desta análise?",
        );
        redFlags.usedNoTools();
        t.check(redFlags.message, includes(/E&O|RC Profissional|risco/i));

        const docs = await t.send(
          "Que documentação adicional você recomenda para avançar na aceitação?",
        );
        docs.usedNoTools();
        t.check(
          docs.message,
          includes(/questionário|document|sinistro|contrato/i),
        );

        const acceptance = await t.send(
          "Quais condições de aceitação fariam sentido neste perfil?",
        );
        acceptance.usedNoTools();
        t.check(acceptance.message, includes(/aceit|limite|franquia|cobertura/i));

        const litigation = await t.send(
          "Há indícios de processos por falha profissional nas fontes consultadas?",
        );
        litigation.usedNoTools();
        // Must not invent active lawsuits; smoke baseline was clear “não há indícios”.
        t.check(
          litigation.message,
          includes(/não há indícios|nao ha indicios|não retornou|ausência de evidência|sem hits|não identif/i),
        );

        t.succeeded();
      },
    },
  ],
});
