/**
 * Configuração de secretarias responsáveis por cada tema político.
 * Edite os campos whatsapp e email com os dados reais dos secretários.
 */

export interface Secretario {
  nome: string;
  cargo: string;
  /** Palavras-chave que mapeiam posts do Claude para esta secretaria */
  temas: string[];
  /** Ex: +557531234567  (DDI 55 + DDD + número) */
  whatsapp: string;
  email: string;
}

export const SECRETARIOS: Secretario[] = [
  {
    nome: "Secretaria Municipal de Saúde",
    cargo: "Secretário(a) de Saúde",
    temas: ["saude", "saúde", "hospital", "ubs", "posto de saude", "medicamento", "epidemiologia"],
    whatsapp: "+557531000001",
    email: "saude@alagoinhas.ba.gov.br",
  },
  {
    nome: "Secretaria Municipal de Educação",
    cargo: "Secretário(a) de Educação",
    temas: ["educacao", "educação", "escola", "merenda", "ensino", "professor", "aluno"],
    whatsapp: "+557531000002",
    email: "educacao@alagoinhas.ba.gov.br",
  },
  {
    nome: "Secretaria Municipal de Obras",
    cargo: "Secretário(a) de Obras e Infraestrutura",
    temas: ["obras", "infraestrutura", "rua", "buraco", "pavimentacao", "pavimentação", "calçada", "calcada", "asfalto"],
    whatsapp: "+557531000003",
    email: "obras@alagoinhas.ba.gov.br",
  },
  {
    nome: "Secretaria Municipal de Segurança",
    cargo: "Secretário(a) de Segurança Pública",
    temas: ["seguranca", "segurança", "violencia", "violência", "crime", "policia", "polícia"],
    whatsapp: "+557531000004",
    email: "seguranca@alagoinhas.ba.gov.br",
  },
  {
    nome: "Secretaria Municipal de Transporte",
    cargo: "Secretário(a) de Transporte",
    temas: ["transporte", "onibus", "ônibus", "mobilidade", "trânsito", "transito", "trafego", "tráfego"],
    whatsapp: "+557531000005",
    email: "transporte@alagoinhas.ba.gov.br",
  },
  {
    nome: "Secretaria Municipal de Meio Ambiente",
    cargo: "Secretário(a) de Meio Ambiente",
    temas: ["ambiente", "lixo", "coleta", "saneamento", "agua", "água", "mata", "esgoto"],
    whatsapp: "+557531000006",
    email: "meioambiente@alagoinhas.ba.gov.br",
  },
  {
    nome: "Secretaria Municipal de Assistência Social",
    cargo: "Secretário(a) de Assistência Social",
    temas: ["social", "assistencia", "assistência", "bolsa", "beneficio", "benefício", "pobreza", "cras"],
    whatsapp: "+557531000007",
    email: "social@alagoinhas.ba.gov.br",
  },
  {
    nome: "Gabinete do Prefeito",
    cargo: "Chefe de Gabinete",
    temas: ["gestao", "gestão", "administracao", "administração", "governo", "prefeito", "prefeitura"],
    whatsapp: "+557531000000",
    email: "gabinete@alagoinhas.ba.gov.br",
  },
];

/** Remove acentos para comparação fuzzy */
function normalizar(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Retorna o secretário responsável pelo tema, ou o Gabinete como fallback */
export function findSecretario(tema: string): Secretario {
  const t = normalizar(tema);
  const found = SECRETARIOS.find((s) =>
    s.temas.some((st) => {
      const n = normalizar(st);
      return t.includes(n) || n.includes(t);
    })
  );
  return found ?? SECRETARIOS[SECRETARIOS.length - 1];
}
