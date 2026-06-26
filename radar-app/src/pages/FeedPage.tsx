import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, parseData, type Post } from "@/lib/data";
import { PostChips } from "@/components/PostChips";

type Filtro = "todos" | "negativos" | "positivos" | "urgentes";

const FILTRO_LABELS: Record<Filtro, string> = {
  todos: "Todos",
  negativos: "Críticos",
  positivos: "Favoráveis",
  urgentes: "Urgentes",
};

function avatarEmoji(categoria: string): string {
  const cat = categoria.toLowerCase();
  if (cat.includes("imprensa")) return "📰";
  if (cat.includes("oposi")) return "⚔";
  if (cat.includes("prefeitura")) return "🏛";
  if (cat.includes("prefeito")) return "👤";
  return "📄";
}

function tempoRelativo(dataStr: string): string {
  const d = parseData(dataStr);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const horas = Math.floor(diff / 36e5);
  if (horas < 1) return "agora";
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

function PostCard({ p }: { p: Post }) {
  const resumo = p.resumo || p.queixa_dominante || p.elogio_dominante || "";
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-2 text-base">
          {avatarEmoji(p.categoria)}
        </span>
        <div className="min-w-0">
          <span className="text-sm font-bold text-txt-1">@{p.autor}</span>
          {p.categoria && (
            <span className="ml-2 text-xs text-txt-3">{p.categoria}</span>
          )}
        </div>
        <span className="ml-auto shrink-0 text-xs text-txt-3">{tempoRelativo(p.data_post)}</span>
      </div>
      {resumo && (
        <p className="mb-2.5 line-clamp-2 text-sm text-txt-2">{resumo}</p>
      )}
      {p.comentarios_destaque && (
        <div className="mb-2.5 rounded-lg bg-bg-2 px-3 py-2">
          <div className="text-xs font-semibold text-txt-3">Comentário mais curtido</div>
          <p className="mt-0.5 line-clamp-2 text-sm italic text-txt-1">"{p.comentarios_destaque}"</p>
          {p.comentarios_destaque_autor && (
            <span className="text-xs text-txt-3">— @{p.comentarios_destaque_autor}</span>
          )}
        </div>
      )}
      <PostChips
        sentimento={p.sentimento_post}
        tema={p.tema}
        urgencia={p.urgencia}
        risco_crise={p.risco_crise}
      />
    </div>
  );
}

export function FeedPage() {
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const { data, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const posts = useMemo<Post[]>(() => {
    const all = [...(data?.data ?? [])].sort((a, b) => {
      const da = parseData(a.data_post)?.getTime() ?? 0;
      const db = parseData(b.data_post)?.getTime() ?? 0;
      return db - da;
    });
    if (filtro === "negativos") return all.filter((p) => p.sentimento_post === "negativo");
    if (filtro === "positivos") return all.filter((p) => p.sentimento_post === "positivo");
    if (filtro === "urgentes") {
      const urg = new Set(["alta", "crítica", "critica"]);
      return all.filter((p) => urg.has(p.urgencia?.toLowerCase() ?? ""));
    }
    return all;
  }, [data, filtro]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando feed…</div>;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">O que o povo diz</h1>
          <p className="text-sm text-txt-2">{posts.length} publicação{posts.length !== 1 ? "ões" : ""} coletada{posts.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex rounded-lg border border-line bg-bg-1 p-1">
          {(Object.keys(FILTRO_LABELS) as Filtro[]).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                filtro === f ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
              }`}
            >
              {FILTRO_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-bg-1 p-8 text-center">
          <p className="text-txt-2">Nenhuma publicação para este filtro.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p, i) => (
            <PostCard key={p.url || i} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
