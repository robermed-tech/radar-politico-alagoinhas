/**
 * Camada de acesso da Escuta do Rádio (tela admin-only).
 *
 * Duas tabelas (migration 011): `radio_transcripts` são os BLOCOS captados de
 * cada estação e `radio_topics` são as PAUTAS extraídas deles. O RLS das duas é
 * admin-only nos dois sentidos — inclusive SELECT — então o usuário comum não
 * lê nada aqui nem por engano. As rádios em si moram em `sources` com
 * `platform='radio'`, e a policy de select de `sources` esconde essas linhas de
 * quem não é admin (senão apareceriam na tela Fontes, que é aberta a todos).
 *
 * O cadastro de rádio vive DENTRO desta tela, e não na tela Fontes, justamente
 * porque a funcionalidade toda é do admin.
 */
import { supabase } from "@/lib/auth";
import { explainError } from "@/lib/admin";

const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";

/**
 * Confiança mínima para uma pauta contar como crítica ou elogio. Gêmeo de
 * radio_analise.py::CONFIANCA_MIN_RADIO — se mudar num, mudar no outro (mesma
 * relação que lib/sentimento.ts tem com o agora.py).
 */
export const CONFIANCA_MIN_RADIO = 60;

export type TomRadio = "critico" | "favoravel" | "neutro" | "nao_classificado";
export type VozRadio = "locutor" | "ouvinte" | "entrevistado" | "reportagem";

/** Um bloco captado de uma estação. */
export interface RadioCaptura {
  id: string;
  estacao: string;
  programa: string | null;
  stream_url: string | null;
  inicio_ts: string;
  duracao_min: number | null;
  /** SUCCESS | RECORDING_FAILED | … — ver o comentário da migration 011. */
  status: string;
  palavras: number;
  janelas_relevantes: number;
  analisado_em: string | null;
  audio_store_key: string | null;
}

/** Uma pauta extraída de um bloco. */
export interface RadioPauta {
  id: string;
  transcript_id: string;
  estacao: string;
  programa: string | null;
  captado_em: string;
  assunto: string;
  resumo: string | null;
  citacao: string | null;
  ts_inicio: number | null;
  ts_fim: number | null;
  tema: string | null;
  localidade: string | null;
  interesse_gestao: boolean;
  motivo_interesse: string | null;
  tom_sobre_gestao: TomRadio;
  voz: VozRadio | null;
  pedido: string | null;
  score_risco: number;
  urgencia: string | null;
  confianca: number;
  /** Caminho do clipe de áudio da citação no bucket privado `radio-clipes`.
   *  NULL = não há áudio para conferir (bloco anterior à migration 012, áudio
   *  já expirado na Apify ou falha no recorte). */
  audio_clip: string | null;
}

/** Rádio cadastrada (linha de `sources` com platform='radio'). */
export interface RadioFonte {
  id: string;
  /** URL do stream — é o `handle` da fonte. */
  handle: string;
  /** Nome da estação. */
  label: string | null;
  active: boolean;
  config: RadioConfig | null;
  created_at: string;
}

export interface RadioConfig {
  programa?: string;
  dias?: string[];
  hora_inicio?: string;
  duracao_min?: number;
  /** Peso de audiência. Nasce 1: sem dado de audiência, ponderar é inventar. */
  peso?: number;
}

function desdeISO(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

// ── Leitura ──────────────────────────────────────────────────

export async function fetchCapturas(dias: number, limit = 500): Promise<RadioCaptura[]> {
  const { data } = await supabase
    .from("radio_transcripts")
    .select("id, estacao, programa, stream_url, inicio_ts, duracao_min, status, palavras, janelas_relevantes, analisado_em, audio_store_key")
    .eq("tenant", TENANT)
    .gte("inicio_ts", desdeISO(dias))
    .order("inicio_ts", { ascending: false })
    .limit(limit);
  return (data as RadioCaptura[]) ?? [];
}

export async function fetchPautas(dias: number, limit = 1000): Promise<RadioPauta[]> {
  const { data } = await supabase
    .from("radio_topics")
    .select("*")
    .eq("tenant", TENANT)
    .gte("captado_em", desdeISO(dias))
    .order("captado_em", { ascending: false })
    .limit(limit);
  return (data as RadioPauta[]) ?? [];
}

/**
 * URL assinada, de vida curta, para ouvir o clipe da citação.
 *
 * O bucket é PRIVADO de propósito: o clipe pode conter a voz de um ouvinte que
 * ligou para a rádio e se identificou no ar — alguém que nunca escolheu falar
 * com este sistema. Uma URL pública ficaria acessível a quem a descobrisse,
 * para sempre; a assinada expira e só é emitida para quem já está autenticado
 * (o RLS do bucket recusa a chave anônima sem sessão).
 */
export async function urlDoClipe(caminho: string, segundos = 600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("radio-clipes")
    .createSignedUrl(caminho, segundos);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function fetchRadios(): Promise<RadioFonte[]> {
  const { data } = await supabase
    .from("sources")
    .select("id, handle, label, active, config, created_at")
    .eq("platform", "radio")
    .order("created_at");
  return (data as RadioFonte[]) ?? [];
}

// ── Cadastro ─────────────────────────────────────────────────

/**
 * Valida a URL do stream. Exige http(s) porque o ator grava de um endereço de
 * áudio: uma página de player (radios.com.br/play/…) não é stream, e foi
 * exatamente o que fez a Rádio Boa voltar `RECORDING_FAILED` no primeiro teste.
 * O aviso é explícito para o admin não repetir o erro sem saber por quê.
 */
export function validarStream(raw: string): { url?: string; error?: string; aviso?: string } {
  const s = raw.trim();
  if (!s) return { error: "Informe a URL do stream da rádio." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "URL inválida. Cole o endereço completo do stream (http:// ou https://)." };
  }
  if (!/^https?:$/.test(u.protocol)) {
    return { error: "O stream precisa ser http:// ou https://." };
  }
  const ehPagina = /radios\.com\.br\/play|\/listen-radio|player/i.test(s);
  const temExtensao = /\.(m3u8|m3u|mp3|aac|pls)(\?|$)|\/stream(\?|$)/i.test(s);
  if (ehPagina && !temExtensao) {
    return {
      url: s,
      aviso: "Isso parece uma página de player, não um stream. A captura pode falhar. " +
             "Procure o endereço direto do áudio (.m3u8, .mp3, .aac ou /stream).",
    };
  }
  return { url: s };
}

export async function addRadio(
  streamRaw: string,
  nome: string,
  config: RadioConfig,
): Promise<string | null> {
  const v = validarStream(streamRaw);
  if (v.error) return v.error;
  if (!nome.trim()) return "Informe o nome da estação.";

  const { error } = await supabase.from("sources").insert({
    platform: "radio",
    handle: v.url,
    label: nome.trim(),
    // Nasce pausada, igual a toda fonte: nada é captado até o admin ativar.
    active: false,
    config: { peso: 1, ...config },
  });
  if (error?.code === "23505") return "Essa rádio já está cadastrada.";
  return explainError(error);
}

export async function toggleRadio(id: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from("sources").update({ active }).eq("id", id);
  return explainError(error);
}

export async function deleteRadio(id: string): Promise<string | null> {
  const { error } = await supabase.from("sources").delete().eq("id", id);
  return explainError(error);
}

// ── Gravação sob demanda ─────────────────────────────────────

export interface GravacaoResultado {
  ok: boolean;
  /** Nomes das estações que entraram na gravação. */
  estacoes: string[];
  duracao: number;
  /** Pedidas que a função descartou (inativas ou de outro tenant). */
  ignoradas: number;
}

/**
 * Pede a captação AGORA das rádios escolhidas (botão GRAVAR do painel).
 *
 * O disparo passa pela Edge Function `gravar-radio`, e não por um fetch direto
 * ao GitHub, porque iniciar a captação é acionar o workflow `radio.yml` — e o
 * token com permissão de Actions não pode viver no bundle do navegador: com ele
 * exposto, qualquer pessoa com o painel aberto dispararia runs pagos da Apify.
 * A função confere o papel de admin antes de disparar.
 */
export async function gravarAgora(
  estacoes: string[],
  duracao: number,
): Promise<{ erro: string | null; resultado: GravacaoResultado | null }> {
  if (estacoes.length === 0) {
    return { erro: "Escolha ao menos uma rádio para gravar.", resultado: null };
  }
  const { data, error } = await supabase.functions.invoke("gravar-radio", {
    body: { estacoes, duracao },
  });

  if (error) {
    // `functions.invoke` embrulha o corpo do erro; a mensagem útil (ex.: secret
    // ausente) está no JSON da resposta, não no `error.message` genérico.
    let detalhe = "";
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try {
      const corpo = await ctx?.json?.();
      detalhe = corpo?.error ?? "";
    } catch {
      /* resposta sem JSON — fica só a mensagem genérica */
    }
    return { erro: detalhe || error.message || "Falha ao iniciar a gravação.", resultado: null };
  }

  const r = data as GravacaoResultado | { error?: string } | null;
  if (r && "error" in r && r.error) return { erro: r.error, resultado: null };
  return { erro: null, resultado: r as GravacaoResultado };
}

// ── Agregações (puras) ───────────────────────────────────────

/** mm:ss do instante da citação, para conferir no áudio. */
export function fmtInstante(seg: number | null): string {
  if (seg === null || seg === undefined || !Number.isFinite(seg)) return "";
  const s = Math.max(0, Math.round(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface PlacarTom {
  critico: number;
  favoravel: number;
  neutro: number;
  /** Pautas que julgaram a gestão mas com confiança abaixo do piso. */
  indeterminado: number;
}

/**
 * Conta o tom das pautas. Pauta abaixo de CONFIANCA_MIN_RADIO conta em
 * `indeterminado`, nunca num dos lados: quando o modelo declara que não
 * conseguiu decidir, tratar como certeza infla o lado maior. Mesma política do
 * tom das publicações.
 */
export function placarTom(pautas: RadioPauta[]): PlacarTom {
  const p: PlacarTom = { critico: 0, favoravel: 0, neutro: 0, indeterminado: 0 };
  for (const t of pautas) {
    if (t.tom_sobre_gestao === "nao_classificado") continue;
    if (t.confianca < CONFIANCA_MIN_RADIO) { p.indeterminado++; continue; }
    p[t.tom_sobre_gestao]++;
  }
  return p;
}

export interface EstacaoResumo {
  estacao: string;
  programa: string | null;
  /** Captura mais recente da estação na janela (inclui as que falharam). */
  ultima: RadioCaptura | null;
  capturas: number;
  /** Capturas que falharam na gravação — "não captada", não "sem assunto". */
  falhas: number;
  minutos: number;
  pautas: RadioPauta[];
  deInteresse: RadioPauta[];
  placar: PlacarTom;
}

/**
 * Agrupa por estação. Recebe capturas E pautas porque as duas perguntas são
 * diferentes: uma estação pode ter sido captada e não ter falado da gestão
 * (capturas > 0, pautas = 0), ou não ter sido captada de jeito nenhum
 * (falhas > 0). A tela precisa dizer qual dos dois aconteceu.
 */
export function resumirPorEstacao(
  capturas: RadioCaptura[],
  pautas: RadioPauta[],
): EstacaoResumo[] {
  const nomes = new Set<string>([
    ...capturas.map((c) => c.estacao),
    ...pautas.map((p) => p.estacao),
  ]);
  const out: EstacaoResumo[] = [];
  for (const estacao of nomes) {
    const cs = capturas.filter((c) => c.estacao === estacao);
    const ps = pautas.filter((p) => p.estacao === estacao);
    const ok = cs.filter((c) => c.status === "SUCCESS");
    out.push({
      estacao,
      programa: cs.find((c) => c.programa)?.programa ?? ps.find((p) => p.programa)?.programa ?? null,
      ultima: cs[0] ?? null,
      capturas: cs.length,
      falhas: cs.length - ok.length,
      minutos: ok.reduce((acc, c) => acc + (Number(c.duracao_min) || 0), 0),
      pautas: ps,
      deInteresse: ps.filter((p) => p.interesse_gestao),
      placar: placarTom(ps),
    });
  }
  // Estação com mais pauta de interesse primeiro: é o que o secretário precisa
  // ver antes. Empate desce para o total de pautas e depois para o nome.
  return out.sort(
    (a, b) =>
      b.deInteresse.length - a.deInteresse.length ||
      b.pautas.length - a.pautas.length ||
      a.estacao.localeCompare(b.estacao),
  );
}

export interface CruzamentoTema {
  tema: string;
  radio: number;
  instagram: number;
}

/**
 * Rádio × Instagram por tema. Responde "o que a rádio pauta e a rede ainda não
 * comenta", que é onde a SECOM ganha tempo: pauta nasce no rádio de manhã e
 * chega às redes depois.
 *
 * Só conta pauta de interesse da gestão — o resto do noticiário de rádio
 * (nacional, esporte, policial) não tem par no Instagram monitorado e só
 * poluiria a comparação.
 */
export function cruzarTemas(
  pautas: RadioPauta[],
  temasInstagram: { tema: string; total: number }[],
): CruzamentoTema[] {
  const noRadio = new Map<string, number>();
  for (const p of pautas) {
    if (!p.tema || !p.interesse_gestao) continue;
    noRadio.set(p.tema, (noRadio.get(p.tema) ?? 0) + 1);
  }
  const noIg = new Map(temasInstagram.map((t) => [t.tema, t.total]));
  const temas = new Set<string>([...noRadio.keys(), ...noIg.keys()]);
  return [...temas]
    .map((tema) => ({
      tema,
      radio: noRadio.get(tema) ?? 0,
      instagram: noIg.get(tema) ?? 0,
    }))
    .filter((t) => t.radio > 0 || t.instagram > 0)
    .sort((a, b) => b.radio - a.radio || b.instagram - a.instagram);
}

/**
 * Assunto que apareceu em várias estações no mesmo dia. Repetição entre
 * estações independentes é sinal muito mais forte que menção isolada: ou o fato
 * é grande, ou a pauta está sendo distribuída.
 */
export interface PautaCoordenada {
  assunto: string;
  estacoes: string[];
  pautas: RadioPauta[];
}

export function pautasCoordenadas(pautas: RadioPauta[], minEstacoes = 2): PautaCoordenada[] {
  const porChave = new Map<string, RadioPauta[]>();
  for (const p of pautas) {
    if (!p.interesse_gestao) continue;
    // Agrupa por tema + dia. Assunto textual não serve como chave: cada
    // estação escreve o título com palavras próprias, e agrupar por string
    // exata nunca casaria nada.
    const dia = p.captado_em.slice(0, 10);
    const chave = `${p.tema ?? "sem_tema"}|${dia}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), p]);
  }
  const out: PautaCoordenada[] = [];
  for (const grupo of porChave.values()) {
    const estacoes = [...new Set(grupo.map((p) => p.estacao))];
    if (estacoes.length < minEstacoes) continue;
    out.push({
      // O título mais frequente do grupo representa o conjunto.
      assunto: grupo[0].assunto,
      estacoes,
      pautas: grupo,
    });
  }
  return out.sort((a, b) => b.estacoes.length - a.estacoes.length);
}
