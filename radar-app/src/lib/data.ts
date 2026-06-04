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
  source?: "supabase" | "sheets";
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

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";

/** Lê do Postgres (Supabase) via PostgREST. Retorna [] se vazio/indisponível. */
async function fetchFromSupabase(): Promise<Post[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/posts?tenant=eq.${TENANT}` +
    `&select=*&order=data_post.desc&limit=3000`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows.map(normalizePost);
}

/** Lê do Apps Script (Sheets) — fonte original. */
async function fetchFromAppsScript(): Promise<RadarPayload> {
  const url = getScriptUrl();
  if (!url) throw new Error("NO_URL");
  const res = await fetch(`${url}?action=list`);
  if (!res.ok) throw new Error(`Falha ao carregar dados (HTTP ${res.status})`);
  const json = (await res.json()) as { data?: unknown[]; perfis?: Perfil[] };
  return {
    data: (json.data ?? []).map((r) => normalizePost(r as Record<string, unknown>)),
    perfis: json.perfis ?? [],
  };
}

/**
 * Fonte de dados com fallback: tenta Supabase (Postgres) primeiro; se vazio
 * (ainda sem dual-write) ou indisponível, cai para o Apps Script (Sheets).
 */
export async function fetchRadar(): Promise<RadarPayload> {
  const supa = await fetchFromSupabase().catch(() => [] as Post[]);
  if (supa.length > 0) return { data: supa, perfis: [], source: "supabase" } as RadarPayload;
  const sheets = await fetchFromAppsScript();
  return { ...sheets, source: "sheets" };
}

/** Parse pt-BR/ISO de data_post para Date (ou null). */
export function parseData(str: string): Date | null {
  if (!str) return null;
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface DailyMetric {
  dia: string;
  iad: number;
  ica: number;
  risco: number;
  nivel_crise: string;
  volume_posts: number;
  volume_coments: number;
  pct_pos: number;
  pct_neg: number;
  pct_neu: number;
}

/** Histórico de índices (Central de Crises). Vazio se Supabase indisponível. */
export async function fetchDailyMetrics(): Promise<DailyMetric[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/daily_metrics?tenant=eq.${TENANT}` +
    `&select=*&order=dia.asc&limit=180`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as DailyMetric[];
}

export interface Briefing {
  dia: string;
  nivel_crise: string;
  risco: number;
  diagnostico: string;
  oportunidades: { titulo: string; acao: string; impacto?: string; esforco?: string }[];
  alertas: { nivel: string; tema: string; janela?: string }[];
  recomendacoes: { canal: string; mensagem: string; tom?: string; timing?: string }[];
  gerado_em: string;
}

/** Último briefing estratégico (Assistente IA). Null se indisponível/vazio. */
export async function fetchBriefing(): Promise<Briefing | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const q =
    `${SUPABASE_URL}/rest/v1/ai_briefings?tenant=eq.${TENANT}` +
    `&select=*&order=dia.desc&limit=1`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = (await res.json()) as Briefing[];
  return rows[0] ?? null;
}

export interface Influencer {
  handle: string;
  tipo: "perfil_monitorado" | "cidadao";
  categoria: string;
  alcance: number;
  engajamento: number;
  frequencia: number;
  influencia_score: number;
  classe: string;
  alinhamento: string;
  pct_positivo: number;
  pct_negativo: number;
  atualizado_em: string;
}

/** Ranking de influenciadores (perfis monitorados + cidadãos). */
export async function fetchInfluencers(): Promise<Influencer[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/influencers?tenant=eq.${TENANT}` +
    `&select=*&order=influencia_score.desc&limit=100`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as Influencer[];
}

export interface Narrative {
  id: string;
  tema: string;
  sentimento: string;
  rotulo: string;
  origem_handle: string;
  origem_url: string;
  primeiro_visto: string;
  ultimo_visto: string;
  volume_posts: number;
  volume_coments: number;
  amplificacao: number;
  perfis_distintos: number;
  queixa_top: string;
  elogio_top: string;
  comentario_top: string;
  comentario_top_curtidas: number;
  status: "ativa" | "esfriando" | "encerrada";
  coordenacao_score?: number;
  coordenacao_sinais?: string[];
  suspeitos_usernames?: string[];
}

export interface CoordinationGroup {
  id: string;
  texto_representativo: string;
  n_comentarios: number;
  usernames: string[];
  sentimento: string;
  autor_posts: string[];
}

/** Grupos de comentários coordenados (campanhas detectadas). */
export async function fetchCoordinationGroups(): Promise<CoordinationGroup[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/coordination_groups?tenant=eq.${TENANT}` +
    `&select=*&order=n_comentarios.desc&limit=50`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as CoordinationGroup[];
}

/** Narrativas ativas/esfriando/encerradas. */
export async function fetchNarratives(): Promise<Narrative[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/narratives?tenant=eq.${TENANT}` +
    `&select=*&order=amplificacao.desc&limit=100`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as Narrative[];
}

export interface DailyTheme {
  dia: string;
  tema: string;
  volume_posts: number;
  volume_coments: number;
  curtidas: number;
  pct_pos: number;
  pct_neg: number;
  pct_neu: number;
  score_risco: number;
}

/** Histórico tema/dia (Tendências). */
export async function fetchDailyThemes(): Promise<DailyTheme[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/daily_themes?tenant=eq.${TENANT}` +
    `&select=*&order=dia.asc&limit=5000`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as DailyTheme[];
}

export interface Comment {
  id: string;
  url_post: string;
  autor_post: string;
  categoria_post: string;
  username: string;
  tipo: string;
  texto: string;
  curtidas: number;
  sentimento: string;
  data_comentario: string;
}

/** Comentários (cidadão/político) para drill-down de Aprovação. */
export async function fetchComments(limit = 1000): Promise<Comment[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/comments?tenant=eq.${TENANT}` +
    `&select=*&order=curtidas.desc&limit=${limit}`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as Comment[];
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
