import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchNarratives,
  fetchCoordinationGroups,
  type CoordinationGroup,
} from "@/lib/data";
import { IconRadar } from "@/components/icons";

const SENT_COR_G: Record<string, string> = {
  positivo: "#22C55E",
  negativo: "#EF4444",
  neutro: "#9FB0CC",
};

function CoordinationPanel({ grupos }: { grupos: CoordinationGroup[] }) {
  if (grupos.length === 0) return null;
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "rgba(220,74,74,0.28)", background: "rgba(220,74,74,0.07)" }}>
      <div className="mb-1 flex items-center gap-2">
        <IconRadar size={18} className="shrink-0" style={{ color: "#DC4A4A" }} />
        <h2 className="text-base font-extrabold" style={{ color: "#DC4A4A" }}>
          {grupos.length} campanha(s) coordenada(s) detectada(s)
        </h2>
      </div>
      <p className="mb-3 text-xs text-txt-2">
        Grupos de contas diferentes que postaram comentários quase idênticos — indício de mobilização organizada (bot, militância ou disparo coordenado).
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {grupos.map((g) => {
          const cor = SENT_COR_G[g.sentimento] ?? "#9FB0CC";
          return (
            <div key={g.id} className="rounded-lg border border-line bg-bg-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                  style={{ background: `${cor}1A`, color: cor }}
                >
                  {g.sentimento}
                </span>
                <span className="tnum text-sm font-bold" style={{ color: "#DC4A4A" }}>
                  {g.n_comentarios} contas
                </span>
              </div>
              <p className="mt-2 text-[13px] italic text-txt-1">"{g.texto_representativo}"</p>
              <div className="mt-2 text-[11px] text-txt-3">
                <span className="font-semibold text-txt-2">Contas: </span>
                {g.usernames.slice(0, 6).map((u) => `@${u}`).join(", ")}
                {g.usernames.length > 6 && ` +${g.usernames.length - 6}`}
              </div>
              {g.autor_posts.length > 0 && (
                <div className="mt-1 text-[10px] text-txt-3">
                  em: {g.autor_posts.map((a) => `@${a}`).join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Filtro = "ativa" | "todas";

export function NarrativesPage() {
  const [filtro, setFiltro] = useState<Filtro>("ativa");
  const { data, isLoading } = useQuery({
    queryKey: ["narratives"],
    queryFn: fetchNarratives,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const { data: gruposData } = useQuery({
    queryKey: ["coordination-groups"],
    queryFn: fetchCoordinationGroups,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const grupos = gruposData ?? [];

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

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Narrativas</h1>
        <p className="text-sm text-txt-2">
          Temas em circulação · origem, amplificação e tom dominante
        </p>
      </div>

      {/* Painel de campanhas coordenadas (detecção global) */}
      <CoordinationPanel grupos={grupos} />

      {/* Resumo */}
      <div className="grid grid-cols-4 gap-3">
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-low">Ativas</div>
          <div className="tnum mt-1 text-2xl font-extrabold text-risk-low">{ativas.length}</div>
          <div className="text-[11px] text-txt-3">últimas 24h</div>
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#EAB308" }}>
            Esfriando
          </div>
          <div className="tnum mt-1 text-2xl font-extrabold" style={{ color: "#EAB308" }}>
            {esfriando.length}
          </div>
          <div className="text-[11px] text-txt-3">24-72h</div>
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-low">Positivas</div>
          <div className="tnum mt-1 text-2xl font-extrabold text-risk-low">{positivas}</div>
          <div className="text-[11px] text-txt-3">elogio dominante</div>
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
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
    </div>
  );
}
