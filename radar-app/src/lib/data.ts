/**
 * Camada de dados — Fase 1.
 * Lê do MESMO Google Apps Script que o dashboard HTML já usa.
 * Zero mudança no pipeline (agora.py / Sheets). Fonte da verdade intacta.
 *
 * Configure VITE_SCRIPT_URL em .env (veja .env.example).
 */

export interface Post {
  url: string;
  data_post: string;
  autor: string;
  categoria: string;
  curtidas: number;
  comentarios_total: number;
  comentarios_count?: number;
  total_cidadaos: number;
  total_politicos: number;
  sentimento_post: string;
  sentimento_comentarios: string;
  comentarios_pct_pos: number;
  comentarios_pct_neg: number;
  score_imagem: number;
  score_risco: number;
  risco_crise: string;
  tema: string;
  atribuicao: string;
  tendencia: string;
  urgencia: string;
  sugestao_acao: string;
  janela_acao: string;
  queixa_dominante: string;
  elogio_dominante: string;
  comentarios_destaque: string;
  comentarios_destaque_curtidas: number;
  comentarios_destaque_autor: string;
  resumo: string;
}

export interface Perfil {
  perfil?: string;
  autor?: string;
  categoria?: string;
  total_posts?: number;
  pct_positivo?: number;
}

export interface RadarPayload {
  data: Post[];
  perfis: Perfil[];
}

const LS_KEY = "radar_script_url";

/** URL do Apps Script: localStorage (runtime) tem prioridade sobre env (build). */
export function getScriptUrl(): string {
  const fromLs = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  return (fromLs || (import.meta.env.VITE_SCRIPT_URL as string | undefined) || "").trim();
}

export function setScriptUrl(url: string): void {
  localStorage.setItem(LS_KEY, url.trim());
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Normaliza um registro bruto do Sheets para o tipo Post. */
function normalizePost(r: Record<string, unknown>): Post {
  return {
    url: String(r.url ?? ""),
    data_post: String(r.data_post ?? ""),
    autor: String(r.autor ?? ""),
    categoria: String(r.categoria ?? ""),
    curtidas: num(r.curtidas),
    comentarios_total: num(r.comentarios_total),
    comentarios_count: num(r.comentarios_count ?? r.comentarios_total),
    total_cidadaos: num(r.total_cidadaos),
    total_politicos: num(r.total_politicos),
    sentimento_post: String(r.sentimento_post ?? "").toLowerCase(),
    sentimento_comentarios: String(r.sentimento_comentarios ?? "").toLowerCase(),
    comentarios_pct_pos: num(r.comentarios_pct_pos),
    comentarios_pct_neg: num(r.comentarios_pct_neg),
    score_imagem: num(r.score_imagem),
    score_risco: num(r.score_risco),
    risco_crise: String(r.risco_crise ?? "").toLowerCase(),
    tema: String(r.tema ?? ""),
    atribuicao: String(r.atribuicao ?? ""),
    tendencia: String(r.tendencia ?? "").toLowerCase(),
    urgencia: String(r.urgencia ?? "").toLowerCase(),
    sugestao_acao: String(r.sugestao_acao ?? ""),
    janela_acao: String(r.janela_acao ?? ""),
    queixa_dominante: String(r.queixa_dominante ?? ""),
    elogio_dominante: String(r.elogio_dominante ?? ""),
    comentarios_destaque: String(r.comentarios_destaque ?? r.comentario_destaque ?? ""),
    comentarios_destaque_curtidas: num(r.comentarios_destaque_curtidas),
    comentarios_destaque_autor: String(r.comentarios_destaque_autor ?? ""),
    resumo: String(r.resumo ?? ""),
  };
}

export async function fetchRadar(): Promise<RadarPayload> {
  const url = getScriptUrl();
  if (!url) {
    throw new Error("NO_URL");
  }
  const res = await fetch(`${url}?action=list`);
  if (!res.ok) throw new Error(`Falha ao carregar dados (HTTP ${res.status})`);
  const json = (await res.json()) as { data?: unknown[]; perfis?: Perfil[] };
  return {
    data: (json.data ?? []).map((r) => normalizePost(r as Record<string, unknown>)),
    perfis: json.perfis ?? [],
  };
}

/** Parse pt-BR/ISO de data_post para Date (ou null). */
export function parseData(str: string): Date | null {
  if (!str) return null;
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function filtrarPorPeriodo(posts: Post[], dias: number): Post[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dias);
  cutoff.setHours(0, 0, 0, 0);
  return posts.filter((p) => {
    const d = parseData(p.data_post);
    return d ? d >= cutoff : true;
  });
}
