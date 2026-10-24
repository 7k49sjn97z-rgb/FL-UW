import { slackChannel } from "@cursor/bdk/channels/slack";

/** Socket Mode Slack channel for fl-uw-chat (env: FL_UW_CHAT_SLACK_*). */
export default slackChannel({
  envPrefix: "FL_UW_CHAT",
  suggestedPrompts: [
    {
      title: "Analisar CNPJ",
      message:
        "Analise o risco E&O / RC Profissional deste CNPJ (valide o formato, consulte dados públicos e entregue a análise estruturada): ",
    },
    {
      title: "Red flags E&O",
      message:
        "Com base na análise já feita deste risco, quais são os principais red flags de RC Profissional / E&O (serviços, exposição a terceiros, reputação, litígios ou sinistralidade)?",
    },
    {
      title: "Docs a solicitar",
      message:
        "Que documentação adicional devo solicitar ao segurado ou corretor para completar a análise preliminar de E&O / RC Profissional deste risco?",
    },
  ],
});
