import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPedidos, fetchRadar, filtrarPorPeriodo, type Pedido } from "@/lib/data";
import { IconHeart, IconInbox, IconWarningTriangle } from "@/components/icons";
import { corTema } from "@/lib/temaColors";
import { PeriodoFilter, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { labelBairro } from "@/lib/format";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
  outro: "Outros",
};
function labelTema(t: string): string {
  return TEMA_LABEL[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Outros");
}

// Confiança baixa = ironia/ambiguidade → sinalizar para revisão humana (Tarefa 5).
const CONF_REVISAR = 70;

export function PedidosPage() {
  const [temaSel, setTemaSel] = useState<string>("todos");
  const [soRevisar, setSoRevisar] = useState(false);
  const [dias, setDias] = useState<Dias>(30);

  const { data: todos = [], isLoading } = useQuery({
    queryKey: ["pedidos"],
    queryFn: () => fetchPedidos(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: radar } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });

  // A janela vem do POST em que o pedido foi comentado: `data_comentario_ts`
  // só existe em ~8% das linhas (backfill parcial), então filtrar por ele
  // sub-representaria violentamente qualquer período (ver lib/data.ts).
  const data = useMemo<Pedido[]>(() => {
    const urls = new Set(filtrarPorPeriodo(radar?.data ?? [], dias).map((p) => p.url));
    if (urls.size === 0) return [];
    return todos.filter((p) => urls.has(p.urlPost));
  }, [todos, radar, dias]);

  const porTema = useMemo(() => {
    const by: Record<string, number> = {};
    for (const p of data) by[p.tema] = (by[p.tema] ?? 0) + 1;
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const pedidos = useMemo<Pedido[]>(() => {
    let arr = data;
    if (temaSel !== "todos") arr = arr.filter((p) => p.tema === temaSel);
    if (soRevisar) arr = arr.filter((p) => (p.confianca_tema ?? 0) < CONF_REVISAR);
    return arr;
  }, [data, temaSel, soRevisar]);

  const nRevisar = useMemo(
    () => data.filter((p) => (p.confianca_tema ?? 0) < CONF_REVISAR).length,
    [data]
  );

  if (isLoading) return <div className="p-8 text-txt-2">Carregando pedidos…</div>;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Pedidos do Povo</h1>
          <p className="text-base text-txt-2">
            Demandas concretas extraídas dos comentários · {periodoLabel(dias)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoFilter dias={dias} onChange={setDias} />
          {nRevisar > 0 && (
            <button
              onClick={() => setSoRevisar((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                soRevisar ? "border-transparent bg-brand text-white" : "border-line bg-bg-1 text-txt-2 hover:text-txt-1"
              }`}
              title="Comentários com baixa confiança (ironia/ambiguidade) — vale conferência humana"
            >
              <IconWarningTriangle size={14} />
              {soRevisar ? "Mostrando a revisar" : `${nRevisar} a revisar`}
            </button>
          )}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-2xl border border-line bg-bg-1 p-8 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-bg-2 text-txt-3">
            <IconInbox size={20} />
          </div>
          <p className="font-semibold text-txt-1">Nenhum pedido nos {periodoLabel(dias)}</p>
          <p className="mt-1 text-sm text-txt-2">
            O AGORA extrai demandas concretas dos comentários. Amplie o período acima ou
            aguarde a próxima coleta processar comentários com pedidos.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setTemaSel("todos")}
              className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${
                temaSel === "todos" ? "bg-brand text-white" : "border border-line bg-bg-1 text-txt-2 hover:text-txt-1"
              }`}
            >
              Todos ({data.length})
            </button>
            {porTema.map(([tema, n]) => {
              const cor = corTema(tema);
              const ativo = temaSel === tema;
              return (
                <button
                  key={tema}
                  onClick={() => setTemaSel(tema)}
                  className="rounded-lg px-3 py-1 text-sm font-semibold transition"
                  style={
                    ativo
                      ? { background: cor, color: "#0B0B0B" }
                      : { border: `1px solid ${cor}55`, background: `${cor}14`, color: cor }
                  }
                >
                  {labelTema(tema)} ({n})
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {pedidos.map((p, i) => {
              const revisar = (p.confianca_tema ?? 0) < CONF_REVISAR;
              const cor = corTema(p.tema);
              return (
                <div
                  key={i}
                  className="card-hover rounded-xl border border-line bg-bg-1 p-4"
                  style={{ borderLeftColor: cor, borderLeftWidth: 3 }}
                >
                  <div className="flex items-start gap-2">
                    <p className="flex-1 text-base font-bold text-txt-1">{p.pedido}</p>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-txt-3">
                      <IconHeart size={13} />
                      <span className="tnum">{p.curtidas}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                    <span
                      className="rounded px-1.5 py-0.5 font-bold"
                      style={{ background: `${cor}24`, color: cor, border: `1px solid ${cor}3d` }}
                    >
                      {labelTema(p.tema)}
                    </span>
                    {p.localidade && p.localidade !== "nao_identificado" && (
                      <span className="rounded bg-bg-2 px-1.5 py-0.5 font-semibold text-txt-2">
                        📍 {labelBairro(p.localidade)}
                      </span>
                    )}
                    {revisar && (
                      <span
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 font-bold"
                        style={{ background: "rgba(234,179,8,0.14)", color: "#CA8A04" }}
                        title={`Confiança ${p.confianca_tema ?? 0}/100 — texto ambíguo ou irônico`}
                      >
                        <IconWarningTriangle size={11} /> revisar
                      </span>
                    )}
                  </div>
                  {/* Comentário em destaque maior e mais pesado (pedido de
                      27/07) — é a evidência bruta atrás do pedido resumido. */}
                  {p.texto && (
                    <p
                      className="mt-2 line-clamp-2 text-sm italic text-txt-2"
                      style={{ fontWeight: 600 }}
                    >
                      "{p.texto}"
                    </p>
                  )}
                </div>
              );
            })}
            {pedidos.length === 0 && (
              <div className="rounded-xl border border-line bg-bg-1 p-6 text-center text-sm text-txt-2">
                Nenhum pedido neste filtro.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
