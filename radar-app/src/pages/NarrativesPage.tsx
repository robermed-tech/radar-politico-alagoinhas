import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNarratives, type Narrative } from "@/lib/data";
import { fmtInt } from "@/lib/format";

type Filtro = "ativa" | "todas";

const SENT_COR: Record<string, string> = {
  positivo: "#22C55E",
  negativo: "#EF4444",
  neutro: "#9FB0CC",
};

const STATUS_COR: Record<string, string> = {
  ativa: "#22C55E",
  esfriando: "#EAB308",
  encerrada: "#5F6E8C",
};

function tempoRelativo(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const horas = (Date.now() - d.getTime()) / 36e5;
  if (horas < 1) return `${Math.round(horas * 60)}min atrás`;
  if (horas < 24) return `${Math.round(horas)}h atrás`;
  return `${Math.round(horas / 24)}d atrás`;
}

function Card({ n, maxAmp }: { n: Narrative; maxAmp: number }) {
  const corSent = SENT_COR[n.sentimento] ?? "#9FB0CC";
  const corStatus = STATUS_COR[n.status] ?? "#9FB0CC";
  const pctAmp = maxAmp > 0 ? (n.amplificacao / maxAmp) * 100 : 0;

  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4 transition hover:border-line-strong">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: corSent }} />
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: corSent }}>
              {n.sentimento}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{ background: `${corStatus}1A`, color: corStatus }}
            >
              {n.status}
            </span>
            {(n.coordenacao_score ?? 0) >= 40 && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: "rgba(168,85,247,0.15)",
                  color: "#A855F7",
                  border: "1px solid rgba(168,85,247,0.4)",
                }}
                title={(n.coordenacao_sinais ?? []).join(" · ")}
              >
                ⚠ Coordenação {Math.round(n.coordenacao_score!)}
              </span>
            )}
          </div>
          <h3 className="mt-1 text-base font-bold text-txt-1">{n.rotulo}</h3>
        </div>
        <div className="text-right">
          <div className="tnum text-lg font-extrabold text-txt-1">{fmtInt(n.amplificacao)}</div>
          <div className="text-[10px] uppercase tracking-wide text-txt-3">curtidas</div>
        </div>
      </div>

      {/* Barra de amplificação */}
      <div className="mt-2 h-1 w-full rounded-full bg-bg-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pctAmp}%`, background: corSent }} />
      </div>

      {/* Origem + cronologia */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="text-txt-3">Origem</div>
          <div className="truncate font-semibold text-txt-1" title={n.origem_handle}>
            @{n.origem_handle}
          </div>
          <div className="text-txt-3">{tempoRelativo(n.primeiro_visto)}</div>
        </div>
        <div>
          <div className="text-txt-3">Última atividade</div>
          <div className="tnum font-semibold text-txt-1">{tempoRelativo(n.ultimo_visto)}</div>
          <div className="text-txt-3">
            {n.volume_posts} posts · {n.perfis_distintos} perfis
          </div>
        </div>
      </div>

      {/* Queixa/elogio dominante */}
      {(n.queixa_top || n.elogio_top) && (
        <div className="mt-3 space-y-1.5 text-[12px]">
          {n.queixa_top && (
            <div className="rounded border border-risk-crit/20 bg-risk-crit/5 px-2 py-1.5 text-txt-2">
              <span className="font-semibold text-risk-crit">🔥 </span>
              {n.queixa_top}
            </div>
          )}
          {n.elogio_top && (
            <div className="rounded border border-risk-low/20 bg-risk-low/5 px-2 py-1.5 text-txt-2">
              <span className="font-semibold text-risk-low">👏 </span>
              {n.elogio_top}
            </div>
          )}
        </div>
      )}

      {/* Comentário mais curtido do cluster */}
      {n.comentario_top && (
        <div className="mt-3 rounded border-l-2 border-brand bg-brand/5 px-3 py-2 text-[12px] italic text-txt-1">
          "{n.comentario_top}"
          <div className="mt-1 not-italic">
            <span className="tnum text-[11px] font-bold text-risk-crit">
              ❤ {fmtInt(n.comentario_top_curtidas)}
            </span>
          </div>
        </div>
      )}

      {/* Painel de coordenação detalhada */}
      {(n.coordenacao_score ?? 0) >= 40 && (
        <div className="mt-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "#A855F7" }}>
            ⚠ Possível campanha coordenada
          </div>
          <div className="space-y-0.5">
            {(n.coordenacao_sinais ?? []).map((s, i) => (
              <div key={i} className="text-[12px] text-txt-2">
                • {s}
              </div>
            ))}
          </div>
          {(n.suspeitos_usernames ?? []).length > 0 && (
            <div className="mt-1.5 text-[10px] text-txt-3">
              Suspeitos: {(n.suspeitos_usernames ?? []).slice(0, 5).map((u) => `@${u}`).join(", ")}
              {(n.suspeitos_usernames ?? []).length > 5 && ` +${n.suspeitos_usernames!.length - 5}`}
            </div>
          )}
        </div>
      )}

      {n.origem_url && (
        <a
          href={n.origem_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-[11px] font-semibold text-brand hover:underline"
        >
          Ver post de origem ↗
        </a>
      )}
    </div>
  );
}

export function NarrativesPage() {
  const [filtro, setFiltro] = useState<Filtro>("ativa");
  const { data, isLoading } = useQuery({
    queryKey: ["narratives"],
    queryFn: fetchNarratives,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  if (isLoading) return <div className="p-8 text-txt-2">Carregando narrativas…</div>;
  const lista = data ?? [];

  if (lista.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Narrativas</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Sem narrativas mapeadas ainda. Crie a tabela <code>narratives</code> no
          Supabase (<code>supabase/narratives.sql</code>) e rode o AGORA.
        </div>
      </div>
    );

  const ativas = lista.filter((n) => n.status === "ativa");
  const esfriando = lista.filter((n) => n.status === "esfriando");
  const positivas = lista.filter((n) => n.sentimento === "positivo").length;
  const negativas = lista.filter((n) => n.sentimento === "negativo").length;
  const coordenadas = lista.filter((n) => (n.coordenacao_score ?? 0) >= 40);

  const filtrada = filtro === "ativa" ? ativas : lista;
  const maxAmp = Math.max(...filtrada.map((n) => n.amplificacao), 1);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Narrativas</h1>
        <p className="text-sm text-txt-2">
          Temas em circulação · origem, amplificação e tom dominante
        </p>
      </div>

      {/* Alerta de coordenação (destaque) */}
      {coordenadas.length > 0 && (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{
            background: "rgba(168,85,247,0.08)",
            borderColor: "rgba(168,85,247,0.4)",
            color: "#A855F7",
          }}
        >
          <span className="font-bold">⚠ {coordenadas.length} narrativa(s) com sinais de coordenação detectados.</span>{" "}
          <span className="text-txt-2">
            Possível campanha organizada (texto duplicado, contas suspeitas ou burst temporal). Veja o detalhe nos cards abaixo.
          </span>
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-low">Ativas</div>
          <div className="tnum mt-1 text-2xl font-extrabold text-risk-low">{ativas.length}</div>
          <div className="text-[11px] text-txt-3">últimas 24h</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#EAB308" }}>
            Esfriando
          </div>
          <div className="tnum mt-1 text-2xl font-extrabold" style={{ color: "#EAB308" }}>
            {esfriando.length}
          </div>
          <div className="text-[11px] text-txt-3">24-72h</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-low">Positivas</div>
          <div className="tnum mt-1 text-2xl font-extrabold text-risk-low">{positivas}</div>
          <div className="text-[11px] text-txt-3">elogio dominante</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-crit">Negativas</div>
          <div className="tnum mt-1 text-2xl font-extrabold text-risk-crit">{negativas}</div>
          <div className="text-[11px] text-txt-3">crítica dominante</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {(
          [
            { id: "ativa", label: `Ativas (${ativas.length})` },
            { id: "todas", label: `Todas (${lista.length})` },
          ] as { id: Filtro; label: string }[]
        ).map((p) => (
          <button
            key={p.id}
            onClick={() => setFiltro(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              filtro === p.id
                ? "border-brand bg-brand text-white"
                : "border-line bg-bg-1 text-txt-2 hover:text-txt-1"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Grid de narrativas */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtrada.map((n) => (
          <Card key={n.id} n={n} maxAmp={maxAmp} />
        ))}
      </div>
    </div>
  );
}
