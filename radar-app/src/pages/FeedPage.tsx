import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, parseData, filtrarPorPeriodo, sentimentoReacao, type Post } from "@/lib/data";
import { resumoProsaPost } from "@/lib/resumo";
import { limparTravessoes } from "@/lib/format";
import { PostChips } from "@/components/PostChips";
import { IconNewspaper, IconSwords, IconBuilding, IconPerson, IconDocument } from "@/components/icons";

// A aba "Urgentes" saiu junto com o chip de urgência (revisão de 25/07):
// sem a marcação no post, o filtro ficava sem explicação visível.
type Filtro = "todos" | "negativos" | "positivos";
type Periodo = 1 | 7 | 30;

const FILTRO_LABELS: Record<Filtro, string> = {
  todos: "Todos",
  negativos: "Críticos",
  positivos: "Favoráveis",
};

const PERIODOS: { dias: Periodo; label: string }[] = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

const SENT_BORDER: Record<string, string> = {
  positivo: "#22C55E",
  negativo: "#EF4444",
  neutro: "#64748B",
};

function AvatarIcone({ categoria }: { categoria: string }) {
  const cat = categoria.toLowerCase();
  if (cat.includes("imprensa")) return <IconNewspaper size={16} />;
  if (cat.includes("oposi")) return <IconSwords size={16} />;
  if (cat.includes("prefeitura")) return <IconBuilding size={16} />;
  if (cat.includes("prefeito")) return <IconPerson size={16} />;
  return <IconDocument size={16} />;
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
  const resumo = resumoProsaPost(p) || p.queixa_dominante || p.elogio_dominante || "";
  const reacao = sentimentoReacao(p);
  const borderColor = SENT_BORDER[reacao] ?? "#64748B";
  return (
    <div
      className="card-hover rounded-xl border border-line bg-bg-1 p-4"
      style={{ borderLeftColor: borderColor, borderLeftWidth: 3 }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-2 text-txt-2">
          <AvatarIcone categoria={p.categoria} />
        </span>
        <div className="min-w-0">
          <span className="text-sm font-bold text-txt-1">@{p.autor}</span>
          {p.categoria && (
            <span className="ml-2 text-xs text-txt-3">{p.categoria}</span>
          )}
        </div>
        <span className="ml-auto shrink-0 text-xs text-txt-3">{tempoRelativo(p.data_post)}</span>
      </div>
      {p.comentarios_destaque && (
        <div className="quote-box mb-2.5 rounded-lg px-3 py-2">
          <div className="text-xs font-semibold text-txt-3">Comentário mais curtido</div>
          <p
            className="mt-0.5 line-clamp-2 text-sm italic text-txt-1"
            style={{ fontWeight: 600 }}
          >
            "{p.comentarios_destaque}"
          </p>
          {p.comentarios_destaque_autor && (
            <span className="text-xs text-txt-3">— @{p.comentarios_destaque_autor}</span>
          )}
        </div>
      )}
      {resumo && (
        <p className="mb-2.5 line-clamp-2 text-sm text-txt-2">{limparTravessoes(resumo)}</p>
      )}
      {/* A camada SCCT (cluster de crise, nível de responsabilização e resposta
          recomendada) saiu do feed na revisão de 25/07 — o cliente não quer a
          análise de responsabilidade exposta na leitura dos posts. */}
      <PostChips
        sentimento={reacao}
        tema={p.tema}
        risco_crise={p.risco_crise}
      />
    </div>
  );
}

export function FeedPage() {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [periodo, setPeriodo] = useState<Periodo>(7);

  const { data, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const posts = useMemo<Post[]>(() => {
    const periodPosts = filtrarPorPeriodo(data?.data ?? [], periodo);
    // resumoProsaPost já monta um resumo só a partir dos percentuais de
    // comentários (sem precisar de queixa/elogio/resumo brutos) — sem isso
    // aqui, posts positivos (que raramente geram "queixa" ou "destaque", já
    // que não há do que reclamar nem comentário polêmico) ficavam fora do
    // feed inteiro, antes mesmo do filtro de sentimento rodar — fazendo
    // "Favoráveis" parecer sempre vazio mesmo havendo posts positivos reais.
    const comConteudo = periodPosts.filter(
      (p) => resumoProsaPost(p) || p.queixa_dominante || p.elogio_dominante || p.comentarios_destaque
    );
    const all = [...comConteudo].sort((a, b) => {
      const da = parseData(a.data_post)?.getTime() ?? 0;
      const db = parseData(b.data_post)?.getTime() ?? 0;
      return db - da;
    });
    if (filtro === "negativos") return all.filter((p) => sentimentoReacao(p) === "negativo");
    if (filtro === "positivos") return all.filter((p) => sentimentoReacao(p) === "positivo");
    return all;
  }, [data, filtro, periodo]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando feed…</div>;

  const periodoLabel = periodo === 1 ? "24 horas" : `${periodo} dias`;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">O que o povo diz</h1>
          <p className="text-sm text-txt-2">
            {posts.length} publicaç{posts.length === 1 ? "ão" : "ões"} · últimas {periodoLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg p-1 glass-btn">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                onClick={() => setPeriodo(p.dias)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  periodo === p.dias ? "bg-white/20 text-txt-1" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {p.label}
              </button>
            ))}
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
