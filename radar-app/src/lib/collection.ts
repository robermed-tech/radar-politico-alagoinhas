/**
 * Camada de dados do MONITOR DE COLETA. Lê `collection_logs` com join em
 * `sources` (via embed do PostgREST) e deriva KPIs/agregações do dia.
 *
 * Leitura para qualquer autenticado (RLS: SELECT liberado). No começo não há
 * nenhum registro — e isso é o esperado: as telas tratam o vazio como estado
 * normal, não como erro.
 */
import { supabase } from "@/lib/auth";
import type { Platform } from "@/lib/sources";

export interface CollectionLog {
  id: string;
  source_id: string | null;
  platform: string;
  data_type: string;
  items_count: number;
  status: string;
  collected_at: string;
  /** Embed da fonte (join). Pode ser null se a fonte foi removida. */
  source: { handle: string; label: string | null; platform: string } | null;
}

export interface SourceLite {
  id: string;
  platform: string;
  handle: string;
  label: string | null;
  active: boolean;
}

/** Início do dia local (00:00) em ISO — recorte "hoje" das consultas. */
function inicioDoDiaISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Logs de coleta de hoje, mais recentes primeiro, com a fonte embutida. */
export async function fetchCollectionLogsHoje(): Promise<CollectionLog[]> {
  const { data } = await supabase
    .from("collection_logs")
    .select("id, source_id, platform, data_type, items_count, status, collected_at, source:sources(handle, label, platform)")
    .gte("collected_at", inicioDoDiaISO())
    .order("collected_at", { ascending: false });
  // O embed source:sources(...) é uma relação 1:1 (source_id → sources.id), mas
  // o supabase-js a infere como array — cast via unknown para o tipo real.
  return (data as unknown as CollectionLog[]) ?? [];
}

const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";

/**
 * Fontes UNIFICADAS para o monitor: mescla o subsistema novo (`sources`,
 * multi-plataforma) com o legado do Instagram (`monitored_sources`, que ainda
 * alimenta o pipeline atual). Sem isto o Instagram apareceria como "0 fontes /
 * aguardando configuração" mesmo estando ativamente monitorado pelo caminho
 * antigo. Dedup por platform+handle (caso o mesmo handle exista nas duas).
 */
export async function fetchFontesUnificadas(): Promise<SourceLite[]> {
  const [novas, legadoIg] = await Promise.all([
    supabase.from("sources").select("id, platform, handle, label, active"),
    supabase
      .from("monitored_sources")
      .select("id, platform, handle, active")
      .eq("tenant_id", TENANT)
      .eq("platform", "instagram"),
  ]);

  const unificadas: SourceLite[] = [...((novas.data as SourceLite[]) ?? [])];
  const vistos = new Set(unificadas.map((s) => `${s.platform}/${s.handle}`));

  for (const m of (legadoIg.data as { id: number; platform: string; handle: string; active: boolean }[]) ?? []) {
    const chave = `${m.platform}/${m.handle}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unificadas.push({
      id: `ms-${m.id}`, platform: m.platform, handle: m.handle,
      label: null, active: m.active,
    });
  }
  return unificadas;
}

// ── Agregações derivadas ─────────────────────────────────────

export interface KpiDia {
  itensColetados: number;
  execucoes: number;      // nº de logs registrados hoje
  fontesAtivas: number;
  taxaSucesso: number;    // % de logs com status 'ok' (0 se não houve execução)
}

export function calcKpis(logs: CollectionLog[], sources: SourceLite[]): KpiDia {
  const itensColetados = logs.reduce((acc, l) => acc + (l.items_count || 0), 0);
  const execucoes = logs.length;
  const fontesAtivas = sources.filter((s) => s.active).length;
  const ok = logs.filter((l) => l.status === "ok").length;
  const taxaSucesso = execucoes ? Math.round((ok / execucoes) * 100) : 0;
  return { itensColetados, execucoes, fontesAtivas, taxaSucesso };
}

export interface RedeResumo {
  platform: Platform;
  fontesConfiguradas: number;
  fontesAtivas: number;
  itensHoje: number;
  ultimaColeta: string | null;   // ISO da coleta mais recente hoje, ou null
}

/** Um resumo por rede social. Redes conhecidas sempre aparecem (mesmo sem
 * fonte), para o card mostrar "aguardando configuração" em vez de sumir. */
export function resumoPorRede(logs: CollectionLog[], sources: SourceLite[]): RedeResumo[] {
  const REDES: Platform[] = ["instagram", "youtube"];
  return REDES.map((platform) => {
    const fontesRede = sources.filter((s) => s.platform === platform);
    const logsRede = logs.filter((l) => l.platform === platform);
    const ultima = logsRede.reduce<string | null>((acc, l) => {
      return !acc || l.collected_at > acc ? l.collected_at : acc;
    }, null);
    return {
      platform,
      fontesConfiguradas: fontesRede.length,
      fontesAtivas: fontesRede.filter((s) => s.active).length,
      itensHoje: logsRede.reduce((acc, l) => acc + (l.items_count || 0), 0),
      ultimaColeta: ultima,
    };
  });
}

/** Volume coletado por hora do dia (0–23), somando todos os logs. Para o
 * gráfico de barras do monitor. */
export function volumePorHora(logs: CollectionLog[]): number[] {
  const horas = new Array(24).fill(0);
  for (const l of logs) {
    const h = new Date(l.collected_at).getHours();
    horas[h] += l.items_count || 0;
  }
  return horas;
}
