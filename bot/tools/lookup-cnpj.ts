import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { digitsOnly, formatCnpj, isValidCnpj } from "../lib/cnpj";

type BrasilApiCnpj = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  situacao_cadastral?: number;
  data_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  natureza_juridica?: string;
  porte?: string;
  descricao_porte?: string;
  capital_social?: number;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo?: number; descricao?: string }>;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string | number;
  ddd_telefone_1?: string;
  email?: string | null;
  qsa?: Array<{
    nome_socio?: string;
    qualificacao_socio?: string;
    data_entrada_sociedade?: string;
  }>;
};

type LookupOk = {
  ok: true;
  cnpj: string;
  cnpjFormatted: string;
  source: string;
  company: {
    razaoSocial: string | null;
    nomeFantasia: string | null;
    situacaoCadastral: string | null;
    dataSituacaoCadastral: string | null;
    dataInicioAtividade: string | null;
    naturezaJuridica: string | null;
    porte: string | null;
    capitalSocial: number | null;
    cnaePrincipal: { codigo: number | null; descricao: string | null };
    cnaesSecundarios: Array<{ codigo: number | null; descricao: string | null }>;
    endereco: string | null;
    telefone: string | null;
    email: string | null;
    socios: Array<{
      nome: string | null;
      qualificacao: string | null;
      dataEntrada: string | null;
    }>;
  };
};

type LookupErr = {
  ok: false;
  error: string;
  cnpj?: string;
  status?: number;
};

export default defineTool({
  description: prompt`
    Look up public Brazilian company registration data by CNPJ
    (Receita Federal via BrasilAPI). Validate digits first.
    Use at the start of every E&O analysis when the user provides a CNPJ.
  `,
  inputSchema: z.object({
    cnpj: z
      .string()
      .describe("CNPJ with or without punctuation (14 digits)."),
  }),
  effect: "read",
  async execute({ cnpj }): Promise<LookupOk | LookupErr> {
    const digits = digitsOnly(cnpj);
    if (!isValidCnpj(digits)) {
      return {
        ok: false,
        error: "Invalid CNPJ: expected 14 digits with valid check digits.",
        cnpj: digits || undefined,
      };
    }

    const url = `https://brasilapi.com.br/api/cnpj/v1/${digits}`;
    // BrasilAPI rejects Node's default User-Agent ("node") with HTTP 403.
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "fl-uw-chat/0.1 (+https://cursor.com; cnpj-lookup)",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 404) {
      return {
        ok: false,
        error: "CNPJ not found in public registry API.",
        cnpj: digits,
        status: 404,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `Public CNPJ API failed with HTTP ${res.status}.`,
        cnpj: digits,
        status: res.status,
      };
    }

    const data = (await res.json()) as BrasilApiCnpj;
    const addressParts = [
      data.logradouro,
      data.numero,
      data.complemento,
      data.bairro,
      data.municipio,
      data.uf,
      data.cep != null ? String(data.cep) : null,
    ].filter(Boolean);

    return {
      ok: true,
      cnpj: digits,
      cnpjFormatted: formatCnpj(digits),
      source: url,
      company: {
        razaoSocial: data.razao_social ?? null,
        nomeFantasia: data.nome_fantasia ?? null,
        situacaoCadastral:
          data.descricao_situacao_cadastral ??
          (data.situacao_cadastral != null
            ? String(data.situacao_cadastral)
            : null),
        dataSituacaoCadastral: data.data_situacao_cadastral ?? null,
        dataInicioAtividade: data.data_inicio_atividade ?? null,
        naturezaJuridica: data.natureza_juridica ?? null,
        porte: data.descricao_porte || data.porte || null,
        capitalSocial:
          typeof data.capital_social === "number" ? data.capital_social : null,
        cnaePrincipal: {
          codigo: data.cnae_fiscal ?? null,
          descricao: data.cnae_fiscal_descricao ?? null,
        },
        cnaesSecundarios: (data.cnaes_secundarios ?? []).slice(0, 15).map((c) => ({
          codigo: c.codigo ?? null,
          descricao: c.descricao ?? null,
        })),
        endereco: addressParts.length ? addressParts.join(", ") : null,
        telefone: data.ddd_telefone_1 ?? null,
        email: data.email ?? null,
        socios: (data.qsa ?? []).slice(0, 20).map((s) => ({
          nome: s.nome_socio ?? null,
          qualificacao: s.qualificacao_socio ?? null,
          dataEntrada: s.data_entrada_sociedade ?? null,
        })),
      },
    };
  },
});
