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

export function NarrativesPage() {
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
    </div>
  );
}
