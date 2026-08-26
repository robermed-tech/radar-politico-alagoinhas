import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPedidos, fetchRadar, filtrarPorPeriodo, type Pedido } from "@/lib/data";
import { IconHeart, IconInbox, IconWarningTriangle } from "@/components/icons";
import { PeriodoFilter, periodoLabel, periodoFrase, type Dias } from "@/components/PeriodoFilter";
import { labelBairro } from "@/lib/format";
import { ComentarioBox, ComentarioTexto } from "@/components/ComentarioBox";
// Superfície chumbo quente — a barra da régua de temas é dado neutro; o
// laranja fica reservado ao tema SELECIONADO (laranja = interação).
import { FUNDO_ESCUTA } from "@/components/superficieRadio";
import { EsqueletoPagina } from "@/components/EsqueletoPagina";

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

  if (isLoading) return <EsqueletoPagina titulo="Pedidos do Povo" />;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-semibold leading-tight tracking-tight">Pedidos do Povo</h1>
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
                soRevisar ? "border-transparent bg-brand text-brand-ink" : "border-line bg-bg-1 text-txt-2 hover:text-txt-1"
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
          <p className="font-semibold text-txt-1">Nenhum pedido {periodoFrase(dias)}</p>
          <p className="mt-1 text-sm text-txt-2">
            O AGORA extrai demandas concretas dos comentários. Amplie o período acima ou
            aguarde a próxima coleta processar comentários com pedidos.
          </p>
        </div>
      ) : (
        <>
          {/* Prévia aprovada em 04/08 — O COLORIDO SAIU (substitui a revisão
              de 01/08, dos botões grandes coloridos): os temas viram uma
              RÉGUA DE VOLUME — nome, contagem e barra proporcional em chumbo.
              A régua é o próprio gráfico: compara-se os temas de relance, sem
              precisar de uma cor por categoria. O laranja fica reservado ao
              tema SELECIONADO (laranja = interação, a regra da paleta).
              A regra de 29/07 segue: sem chip "Todos", padrão = lista inteira,
              e clicar de novo no tema aceso volta para ela. */}
          <div className="rounded-[20px] border border-line bg-bg-1 p-5">
            <div className="section-label">Temas · clique para filtrar</div>
            <div className="mt-2">
              {porTema.map(([tema, n]) => {
                const ativo = temaSel === tema;
                const larg = Math.max(4, Math.round((n / (porTema[0]?.[1] || 1)) * 100));
                return (
                  <button
                    key={tema}
                    onClick={() => setTemaSel(ativo ? "todos" : tema)}
                    aria-pressed={ativo}
                    className="grid w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-left transition"
                    style={{
                      gridTemplateColumns: "150px 1fr 70px",
                      borderColor: ativo ? "rgba(98,194,202,0.35)" : "transparent",
                      background: ativo ? "rgba(98,194,202,0.10)" : undefined,
                    }}
                    title={`Ver só os pedidos de ${labelTema(tema)}`}
                  >
                    <span
                      className="truncate text-[15px] font-bold"
                      style={ativo ? { color: "var(--brand-text)" } : undefined}
                    >
                      {labelTema(tema)}
                    </span>
                    <span className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--quote-bg)", border: "1px solid var(--quote-border)" }}>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${larg}%`, background: ativo ? "var(--brand)" : FUNDO_ESCUTA }}
                      />
                    </span>
                    <span className="tnum text-right font-display text-base font-bold text-txt-2">
                      {n}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <ListaPedidos pedidos={pedidos} />
        </>
      )}
    </div>
  );
}

/** Cards de pedido — o mesmo desenho de sempre, usado solto na página (sem
 *  filtro) ou dentro do box do tema selecionado. */
function ListaPedidos({ pedidos, className = "" }: { pedidos: Pedido[]; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
            {pedidos.map((p, i) => {
              const revisar = (p.confianca_tema ?? 0) < CONF_REVISAR;
              return (
                // Card neutro (prévia de 04/08): a borda colorida e o chip na
                // cor do tema saíram junto com os botões coloridos — o tema
                // vira chip neutro, e a cor da página fica com o dado que tem
                // semântica (sentimento, marca, risco).
                <div key={i} className="card-hover rounded-xl border border-line bg-bg-1 p-4">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 font-display text-base font-bold text-txt-1">{p.pedido}</p>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-txt-3">
                      <IconHeart size={13} />
                      <span className="tnum">{p.curtidas}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="rounded border border-line bg-bg-2 px-1.5 py-0.5 font-bold text-txt-2">
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
                        style={{ background: "rgba(180,83,9,0.12)", color: "var(--warning)" }}
                        title={`Confiança ${p.confianca_tema ?? 0}/100 — texto ambíguo ou irônico`}
                      >
                        <IconWarningTriangle size={11} /> revisar
                      </span>
                    )}
                  </div>
                  {/* Comentário em destaque maior e mais pesado (pedido de
                      27/07) — é a evidência bruta atrás do pedido resumido.
                      Desde 29/07 no ComentarioBox comum ao painel. */}
                  {p.texto && (
                    <ComentarioBox className="mt-2">
                      <ComentarioTexto>{p.texto}</ComentarioTexto>
                    </ComentarioBox>
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
  );
}
