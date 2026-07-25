/**
 * Camada de dados — Fase 1.
 * Lê do MESMO Google Apps Script que o dashboard HTML já usa.
 * Zero mudança no pipeline (agora.py / Sheets). Fonte da verdade intacta.
 *
 * Configure VITE_SCRIPT_URL em .env (veja .env.example).
 */

import { supabase } from "@/lib/auth";

export interface Post {
  url: string;
  data_post: string;
  autor: string;
  categoria: string;
  /** Legenda original do post no Instagram (coluna posts.caption). */
  caption: string;
  curtidas: number;
  comentarios_total: number;
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
  subtema: string;
  // Camada SCCT/Coombs (colunas de supabase/scct_posts_e_irt.sql)
  cluster_crise: string;
  responsabilidade_atribuida: number;
  abordagem_recomendada: string;
  por_que_funciona: string;
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
    caption: String(r.caption ?? ""),
    curtidas: num(r.curtidas),
    comentarios_total: num(r.comentarios_total ?? r.comentarios_count),
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
    subtema: String(r.subtema ?? ""),
    cluster_crise: String(r.cluster_crise ?? "").toLowerCase(),
    responsabilidade_atribuida: num(r.responsabilidade_atribuida),
    abordagem_recomendada: String(r.abordagem_recomendada ?? ""),
    por_que_funciona: String(r.por_que_funciona ?? ""),
  };
}

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";

/**
 * Agregado de sentimento por post, derivado da tabela `comments` (a fonte da
 * verdade, classificada por comentário). Espelha `agora.py
 * --recalcular-sentimento`: percentuais sobre o total de comentários do post.
 *
 * Existe porque o agregado gravado em `posts.comentarios_pct_*` ficou congelado
 * no fallback 0/0/neutro enquanto os comentários seguem sendo classificados —
 * o que fazia o painel mostrar "0% críticas" com o banco cheio de comentários
 * negativos. Enquanto o backend não reescreve `posts`, reprojetamos aqui.
 */
interface AggSent { pctPos: number; pctNeg: number; sent: string }
async function fetchAgregadoComentarios(): Promise<Map<string, AggSent>> {
  const { data, error } = await supabase
    .from("comments")
    .select("url_post,sentimento")
    .eq("tenant", TENANT)
    .limit(8000);
  if (error || !data?.length) return new Map();
  const agg: Record<string, { pos: number; neg: number; tot: number }> = {};
  for (const r of data as { url_post: string; sentimento: string }[]) {
    const u = (r.url_post || "").trim();
    if (!u) continue;
    const a = (agg[u] ??= { pos: 0, neg: 0, tot: 0 });
    a.tot += 1;
    const s = (r.sentimento || "neutro").toLowerCase();
    if (s === "negativo") a.neg += 1;
    else if (s === "positivo") a.pos += 1;
  }
  const map = new Map<string, AggSent>();
  for (const [u, a] of Object.entries(agg)) {
    const tot = a.tot || 1;
    const pctPos = Math.round((a.pos / tot) * 100);
    const pctNeg = Math.round((a.neg / tot) * 100);
    let sent = "neutro";
    if (a.neg === 0 && a.pos === 0) sent = "neutro";
    else if (pctNeg >= pctPos) sent = pctNeg >= 50 ? "negativo" : "misto";
    else sent = pctPos >= 60 ? "positivo" : "misto";
    map.set(u, { pctPos, pctNeg, sent });
  }
  return map;
}

/** Lê do Postgres (Supabase) via PostgREST. Retorna [] se vazio/indisponível. */
async function fetchFromSupabase(): Promise<Post[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("tenant", TENANT)
    // Só Instagram: o feed e todos os índices são construídos sobre a análise
    // (sentimento, score, tema) que hoje só existe para o Instagram. Vídeos do
    // YouTube coletados entram em `posts` como dado cru (platform='youtube') e
    // apareceriam aqui sem análise, poluindo o feed — por isso são filtrados.
    // Registros antigos herdam platform='instagram' (default da migration 005).
    .eq("platform", "instagram")
    .order("data_post", { ascending: false })
    .limit(3000);
  if (error || !data?.length) return [];
  const posts = (data as Record<string, unknown>[]).map(normalizePost);

  // Corrige o dessync post↔comentários: sobrescreve o agregado só quando há
  // comentários classificados para o post; posts sem comentários ficam intactos.
  const agg = await fetchAgregadoComentarios().catch(() => new Map<string, AggSent>());
  if (agg.size) {
    for (const p of posts) {
      const a = agg.get((p.url || "").trim());
      if (a) {
        p.comentarios_pct_pos = a.pctPos;
        p.comentarios_pct_neg = a.pctNeg;
        p.sentimento_comentarios = a.sent;
      }
    }
  }
  return posts;
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

/**
 * Sentimento efetivo da REAÇÃO do público a um post — usado em "O que o povo
 * diz" (Favoráveis/Críticos) e no badge de cada card.
 *
 * `sentimento_post` é gravado pelo agora.py, mas posts antigos (anteriores
 * aos ajustes de prompt de jul/2026 — ver 7c08e2a) podem ter ficado com um
 * valor stale que não reflete a reação real dos comentários. Em vez de
 * confiar cegamente nesse campo, reaplicamos aqui a mesma regra de
 * desempate que o backend já usa (agora.py, "Safety net" antes de gravar
 * sentimento_post): os percentuais de comentários e o sentimento_comentarios
 * têm precedência, porque medem a reação do POVO — o que este card mostra —
 * e não o tom da legenda do post.
 */
export function sentimentoReacao(p: Post): "positivo" | "negativo" | "neutro" {
  const pctNeg = p.comentarios_pct_neg || 0;
  const pctPos = p.comentarios_pct_pos || 0;
  const sentComentarios = (p.sentimento_comentarios || "").toLowerCase();
  const ehOposicao = (p.categoria || "").toLowerCase().includes("oposi");

  if (pctNeg > 50) return "negativo";
  if (sentComentarios === "negativo") return "negativo";
  if (sentComentarios === "misto" && pctNeg > pctPos) return "negativo";
  if (pctPos > 60) return ehOposicao ? "negativo" : "positivo";
  if (p.sentimento_post === "positivo" || p.sentimento_post === "negativo" || p.sentimento_post === "neutro") {
    return p.sentimento_post;
  }
  return "neutro";
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

export interface CrisisPlan {
  post_url: string;
  autor: string;
  e_crise_real: boolean;
  nivel: string;
  tema?: string;
  pavio: string;
  velocidade: string;
  janela_resposta: string;
  plano_contencao: string[];
  risco_se_ignorar: string;
  score_risco: number;
  gerado_em: string;
}

/** Planos de contenção gerados pelo Agente Caçador de Crises. */
export async function fetchCrisisPlans(): Promise<CrisisPlan[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/crisis_plans?tenant=eq.${TENANT}` +
    `&select=*&order=score_risco.desc&limit=20`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as CrisisPlan[];
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

/** Janela de análise: dia (24h), semana (7 dias) ou mês (30 dias). */
export type Periodo = "dia" | "semana" | "mes";

export interface Briefing {
  dia: string;
  periodo: Periodo;
  nivel_crise: string;
  risco: number;
  diagnostico: string;
  oportunidades: { titulo: string; acao: string; impacto?: string; esforco?: string }[];
  /** tema_categoria (opcional): categoria fixa (ver TEMAS_VALIDOS no agora.py)
   * usada pra buscar os comentários reais que embasam o alerta. Vazio quando
   * a IA não conseguiu classificar — nesse caso o botão de evidência some. */
  alertas: { nivel: string; tema: string; tema_categoria?: string; janela?: string }[];
  recomendacoes: { canal: string; mensagem: string; tom?: string; timing?: string }[];
  gerado_em: string;
}

/**
 * Último briefing estratégico (Assistente IA) do período pedido. Null se
 * indisponível/vazio — ex.: tenant novo sem histórico suficiente pra gerar
 * a análise de semana/mês ainda (ver agora.py::gerar_briefings_periodo).
 */
export async function fetchBriefing(periodo: Periodo = "dia"): Promise<Briefing | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const q =
    `${SUPABASE_URL}/rest/v1/ai_briefings?tenant=eq.${TENANT}&periodo=eq.${periodo}` +
    `&select=*&order=dia.desc&limit=1`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = (await res.json()) as Briefing[];
  return rows[0] ?? null;
}

// Boletim Climático (boletim.py → tabela `boletins`, coluna jsonb `boletim`).
// Tipos espelham exatamente a saída de gerar_boletim().
export interface BoletimAlerta {
  motivo: string;
  url_post: string;
  scct: {
    cluster: string;
    rotulo_cluster: string;
    responsabilidade: number;
    rotulo_responsabilidade: string;
  };
  recomendacao_irt: string;
  por_que_funciona: string;
  override_aplicado: boolean;
}

export interface BoletimFrente {
  tema: string;
  /** Ausente no boletim público (view dashboard_public) — é um score numérico. */
  score?: number;
  tendencia: string;
  icone: string;
}

export interface Boletim {
  condicao: string;
  nivel_cor: string | null;
  elevado_por_post: boolean;
  frase_resumo: string;
  previsao_24h: string;
  frase_previsao: string;
  /** Campos numéricos de score — só presentes para admin (tabela completa). */
  pressao?: { valor: number; delta_24h: number; serie_7d: number[] };
  termometro?: Record<string, number>;
  rajadas?: Record<string, unknown>;
  frentes: BoletimFrente[];
  alerta_ativo: BoletimAlerta | null;
}

/**
 * Último Boletim Climático do período pedido, respeitando o papel:
 *   • admin → tabela `boletins` (boletim completo, com score numérico);
 *   • usuário comum → view `dashboard_public` (boletim sem score).
 * Usa o cliente autenticado (JWT da sessão), então o RLS é aplicado de fato.
 */
export async function fetchBoletimByRole(isAdmin: boolean, periodo: Periodo = "dia"): Promise<Boletim | null> {
  const from = isAdmin ? "boletins" : "dashboard_public";
  const { data, error } = await supabase
    .from(from)
    .select("boletim")
    .eq("tenant", TENANT)
    .eq("periodo", periodo)
    .order("dia", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return (data[0] as { boletim: Boletim }).boletim ?? null;
}

export interface Influencer {
  handle: string;
  tipo: "perfil_monitorado";
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

/**
 * Ranking de influenciadores — apenas perfis monitorados (contas institucionais,
 * imprensa, aliados/oposição). Cidadãos comuns NUNCA são incluídos aqui: expor
 * um ranking nominal de perfis pessoais de cidadãos violaria a LGPD (dado
 * pessoal de gente que não consentiu em ser rankeada publicamente). O filtro
 * é aplicado na própria query para que handles de cidadãos nunca cheguem ao
 * cliente.
 */
export async function fetchInfluencers(): Promise<Influencer[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/influencers?tenant=eq.${TENANT}` +
    `&tipo=eq.perfil_monitorado&select=*&order=influencia_score.desc&limit=100`;
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

/** Laço IRT: tema que disparou alerta fica em monitoramento de recuperação. */
export interface TemaMonitorado {
  tema: string;
  pico_em: string;
  volume_pico: number;
  pneg_pico: number;
  volume_atual: number;
  pneg_atual: number;
  tendencia: string; // em_queda | estavel | em_alta
  status: string;    // monitorando | recuperado | persistente
  atualizado_em: string;
}

export async function fetchTemasMonitorados(): Promise<TemaMonitorado[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/temas_monitorados?tenant=eq.${TENANT}` +
    `&select=*&order=pico_em.desc&limit=50`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as TemaMonitorado[];
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
  // Campos por-comentário (Haiku dedicado — Tarefa 5 / backfill)
  tema?: string;
  subtema?: string;
  localidade?: string;
  pedido?: string | null;
  confianca_tema?: number;
  data_comentario_ts?: string | null;
  data_comentario_dia?: string | null;
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

// ── Localidades / Bairros (agregação client-side de comments) ────────────────
export interface BairroStats {
  localidade: string;
  total: number;
  neg: number;
  pos: number;
  neu: number;
  pctNeg: number;
  pctPos: number;
  curtidas: number;
  temaTop: string;
  pedidos: string[];
}

/**
 * Comentários que citam um bairro/local (localidade != nao_identificado),
 * agregados por localidade. PostgREST não agrupa sem view; fazemos client-side.
 * O schema já está migrado, mas não podemos criar views (regra do projeto).
 */
export async function fetchBairros(): Promise<BairroStats[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/comments?tenant=eq.${TENANT}` +
    `&localidade=neq.nao_identificado&localidade=not.is.null` +
    `&select=localidade,sentimento,tema,pedido,curtidas&limit=8000`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const rows = (await res.json()) as Comment[];

  const by: Record<string, BairroStats & { temas: Record<string, number> }> = {};
  for (const c of rows) {
    const loc = (c.localidade || "").trim();
    if (!loc || loc === "nao_identificado") continue;
    const b = (by[loc] ??= {
      localidade: loc, total: 0, neg: 0, pos: 0, neu: 0,
      pctNeg: 0, pctPos: 0, curtidas: 0, temaTop: "", pedidos: [],
      temas: {},
    });
    b.total += 1;
    b.curtidas += Number(c.curtidas ?? 0);
    const s = (c.sentimento || "neutro").toLowerCase();
    if (s === "negativo") b.neg += 1;
    else if (s === "positivo") b.pos += 1;
    else b.neu += 1;
    const t = (c.tema || "").trim();
    if (t && t !== "outro") b.temas[t] = (b.temas[t] ?? 0) + 1;
    const ped = (c.pedido || "").trim();
    if (ped && b.pedidos.length < 5 && !b.pedidos.includes(ped)) b.pedidos.push(ped);
  }
  return Object.values(by)
    .map((b) => {
      const temaTop = Object.entries(b.temas).sort((a, z) => z[1] - a[1])[0]?.[0] ?? "";
      const { temas: _omit, ...rest } = b;
      void _omit;
      return {
        ...rest,
        temaTop,
        pctNeg: b.total ? Math.round((b.neg / b.total) * 100) : 0,
        pctPos: b.total ? Math.round((b.pos / b.total) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total || b.pctNeg - a.pctNeg);
}

// ── Pedidos (demandas concretas do cidadão) ──────────────────────────────────
export interface Pedido {
  pedido: string;
  tema: string;
  subtema: string;
  localidade: string;
  curtidas: number;
  texto: string;
  confianca_tema: number;
  sentimento: string;
  data_comentario: string;
}

/** Comentários com demanda concreta (pedido != null), mais curtidos primeiro. */
export async function fetchPedidos(limit = 2000): Promise<Pedido[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/comments?tenant=eq.${TENANT}` +
    `&pedido=not.is.null&select=pedido,tema,subtema,localidade,curtidas,texto,confianca_tema,sentimento,data_comentario` +
    `&order=curtidas.desc&limit=${limit}`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return ((await res.json()) as Record<string, unknown>[]).map((r) => ({
    pedido: String(r.pedido ?? ""),
    tema: String(r.tema ?? "outro"),
    subtema: String(r.subtema ?? "outro"),
    localidade: String(r.localidade ?? "nao_identificado"),
    curtidas: Number(r.curtidas ?? 0),
    texto: String(r.texto ?? ""),
    confianca_tema: Number(r.confianca_tema ?? 0),
    sentimento: String(r.sentimento ?? "neutro"),
    data_comentario: String(r.data_comentario ?? ""),
  }));
}

// ── Subtemas (drill-down de tema, agregação client-side) ─────────────────────
export interface SubtemaStat {
  tema: string;
  subtema: string;
  total: number;
  neg: number;
  pctNeg: number;
}

/** Distribuição de subtemas por tema, a partir de comments de cidadãos. */
export async function fetchSubtemas(): Promise<SubtemaStat[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/comments?tenant=eq.${TENANT}` +
    `&tipo=eq.cidadao&subtema=neq.outro&subtema=not.is.null` +
    `&select=tema,subtema,sentimento&limit=8000`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const rows = (await res.json()) as Comment[];
  const by: Record<string, SubtemaStat> = {};
  for (const c of rows) {
    const tema = (c.tema || "outro").trim();
    const subtema = (c.subtema || "").trim();
    if (!subtema || subtema === "outro") continue;
    const k = `${tema}|${subtema}`;
    const s = (by[k] ??= { tema, subtema, total: 0, neg: 0, pctNeg: 0 });
    s.total += 1;
    if ((c.sentimento || "").toLowerCase() === "negativo") s.neg += 1;
  }
  return Object.values(by)
    .map((s) => ({ ...s, pctNeg: s.total ? Math.round((s.neg / s.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ── Comentários por tema (drill-down + evidência do alerta) ──────────────────
export interface ComentarioTema {
  texto: string;
  autor: string;
  curtidas: number;
  sentimento: string;
  tema: string;
  subtema: string;
  /** URL do post onde o comentário está — usado pra filtrar por período via
   * join com a data do POST (ver nota abaixo sobre data_comentario_ts). */
  urlPost: string;
}

/**
 * Comentários de cidadãos COM o texto real, para (a) o drill-down "o que
 * exatamente as pessoas falam sobre X", (b) a evidência concreta que vai
 * dentro do alerta ao secretário, e (c) agregações reais de volume por tema
 * (ver `VolumeComentarios` em ClimaPage.tsx). Ordenados por curtidas (os
 * mais endossados primeiro). Uma única fonte alimenta os três usos —
 * cacheada pela query key.
 *
 * `tema` (opcional) filtra por uma categoria fixa (a mesma de comments.tema —
 * ver TEMAS_VALIDOS no agora.py), usado pela evidência de "Ver comentários"
 * nos alertas do Clima.
 *
 * NÃO tem filtro de data aqui: `comments.data_comentario_ts` é de um backfill
 * parcial e só existe em ~8% das linhas (achado em produção) — filtrar por
 * ele sub-representa violentamente qualquer janela. Pra restringir por
 * período, o chamador deve cruzar `urlPost` com o conjunto de posts do
 * período (posts.data_post é sempre preenchida) — mesma abordagem usada em
 * agora.py::contar_comentarios_por_tema.
 */
export async function fetchComentariosPorTema(tema?: string, limit = 4000): Promise<ComentarioTema[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  let q =
    `${SUPABASE_URL}/rest/v1/comments?tenant=eq.${TENANT}` +
    `&tipo=eq.cidadao&texto=not.is.null&tema=not.is.null&tema=neq.outro`;
  if (tema) q += `&tema=eq.${encodeURIComponent(tema)}`;
  q += `&select=texto,username,curtidas,sentimento,tema,subtema,url_post&order=curtidas.desc&limit=${limit}`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return ((await res.json()) as Record<string, unknown>[]).map((r) => ({
    texto: String(r.texto ?? "").trim(),
    autor: String(r.username ?? "").trim(),
    curtidas: Number(r.curtidas ?? 0),
    sentimento: String(r.sentimento ?? "neutro").toLowerCase(),
    tema: String(r.tema ?? "outro").trim(),
    subtema: String(r.subtema ?? "").trim(),
    urlPost: String(r.url_post ?? "").trim(),
  }));
}

// ── Assuntos em alta (subtemas repetidos numa janela recente) ────────────────
export interface SubtemaEmAlta {
  tema: string;
  subtema: string;
  total: number;     // comentários de cidadãos no período
  autores: number;   // contas distintas (mede espontaneidade vs. 1 pessoa insistindo)
  neg: number;       // quantos negativos
  pctNeg: number;
  exemplo: string;   // comentário mais curtido do grupo
}

/**
 * Conta comentários de cidadãos por subtema numa janela recente (default 24h).
 * É o "3+ pessoas falaram de buraco" do áudio: mede quando uma mesma ideia se
 * repete — sinal de sensação popular, não de comentário isolado. Filtra por
 * `data_comentario_ts` no servidor; linhas sem timestamp ficam de fora (só
 * comentários datados entram na janela).
 */
export async function fetchSubtemasRecentes(horas = 24): Promise<SubtemaEmAlta[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const desde = new Date(Date.now() - horas * 36e5).toISOString();
  const q =
    `${SUPABASE_URL}/rest/v1/comments?tenant=eq.${TENANT}` +
    `&tipo=eq.cidadao&subtema=neq.outro&subtema=not.is.null` +
    `&data_comentario_ts=gte.${desde}` +
    `&select=tema,subtema,sentimento,texto,username,curtidas&order=curtidas.desc&limit=8000`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const rows = (await res.json()) as Comment[];

  const by: Record<string, SubtemaEmAlta & { autoresSet: Set<string> }> = {};
  for (const c of rows) {
    const tema = (c.tema || "outro").trim();
    const subtema = (c.subtema || "").trim();
    if (!subtema || subtema === "outro") continue;
    const k = `${tema}|${subtema}`;
    const s = (by[k] ??= {
      tema, subtema, total: 0, autores: 0, neg: 0, pctNeg: 0, exemplo: "",
      autoresSet: new Set<string>(),
    });
    s.total += 1;
    if (c.username) s.autoresSet.add(c.username.toLowerCase());
    if ((c.sentimento || "").toLowerCase() === "negativo") s.neg += 1;
    if (!s.exemplo && c.texto) s.exemplo = c.texto.trim(); // rows vêm por curtidas desc
  }
  return Object.values(by)
    .map(({ autoresSet, ...s }) => ({
      ...s,
      autores: autoresSet.size,
      pctNeg: s.total ? Math.round((s.neg / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || b.pctNeg - a.pctNeg);
}

export interface PipelineHealth {
  tenant: string;
  executado_em: string;
  duracao_s: number;
  posts_coletados: number;
  posts_analisados: number;
  alertas_enviados: number;
  status: string;
}

export interface AlertaHistorico {
  id?: number;
  tenant_id: string;
  tipo: string;
  valor?: number;
  mensagem: string;
  canal: string;
  criado_em: string;
}

export async function fetchPipelineHealth(): Promise<PipelineHealth | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const q = `${SUPABASE_URL}/rest/v1/pipeline_health?tenant=eq.${TENANT}&order=executado_em.desc&limit=1`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = (await res.json()) as PipelineHealth[];
  return rows[0] ?? null;
}

export interface ServiceStatus {
  tenant: string;
  servico: string;
  uso_pct: number;
  uso_usd: number;
  teto_usd: number;
  atualizado_em: string;
}

export async function fetchServiceStatus(servico: string): Promise<ServiceStatus | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const q = `${SUPABASE_URL}/rest/v1/service_status?tenant=eq.${TENANT}&servico=eq.${servico}&limit=1`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = (await res.json()) as ServiceStatus[];
  return rows[0] ?? null;
}

export async function fetchAlertHistory(limit = 100): Promise<AlertaHistorico[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q =
    `${SUPABASE_URL}/rest/v1/alerta_historico?tenant_id=eq.${TENANT}` +
    `&order=criado_em.desc&limit=${limit}`;
  const res = await fetch(q, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  return (await res.json()) as AlertaHistorico[];
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

/** Retorna o período atual e o período anterior de mesmo comprimento, para calcular deltas. */
export function filtrarDoisPeriodos(
  posts: Post[],
  dias: number
): { atual: Post[]; anterior: Post[] } {
  const cutoffAtual = new Date();
  cutoffAtual.setDate(cutoffAtual.getDate() - dias);
  cutoffAtual.setHours(0, 0, 0, 0);
  const cutoffAnterior = new Date(cutoffAtual);
  cutoffAnterior.setDate(cutoffAnterior.getDate() - dias);
  return {
    atual: posts.filter((p) => {
      const d = parseData(p.data_post);
      return d ? d >= cutoffAtual : false;
    }),
    anterior: posts.filter((p) => {
      const d = parseData(p.data_post);
      return d ? d >= cutoffAnterior && d < cutoffAtual : false;
    }),
  };
}
