import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchBairros, type BairroStats } from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";
import { IconWarningTriangle, IconInbox } from "@/components/icons";

type Ordem = "volume" | "negativo";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
};

function labelTema(t: string): string {
  return TEMA_LABEL[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "—");
}

function corPct(pctNeg: number): string {
  if (pctNeg >= 60) return "#EF4444";
  if (pctNeg >= 35) return "#F97316";
  return "#22C55E";
}

export function BairrosPage() {
  const [ordem, setOrdem] = useState<Ordem>("volume");
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data = [], isLoading } = useQuery({
    queryKey: ["bairros"],
    queryFn: fetchBairros,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const bairros = useMemo<BairroStats[]>(() => {
    const arr = [...data];
    if (ordem === "negativo") arr.sort((a, b) => b.pctNeg - a.pctNeg || b.total - a.total);
    else arr.sort((a, b) => b.total - a.total || b.pctNeg - a.pctNeg);
    return arr;
  }, [data, ordem]);

  const totalMencoes = useMemo(() => bairros.reduce((s, b) => s + b.total, 0), [bairros]);

  const chartOption = useMemo(() => {
    const top = bairros.slice(0, 12).reverse();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: ink.tooltipBg,
        borderColor: ink.tooltipBorder,
        textStyle: { color: ink.tooltipText },
        formatter: (ps: { name: string; value: number; dataIndex: number }[]) => {
          const b = top[ps[0].dataIndex];
          return `<b>${b.localidade}</b><br/>${b.total} menções · ${b.pctNeg}% negativas`;
        },
      },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: ink.grid } },
        axisLabel: { color: ink.axis, fontSize: 10 },
      },
      yAxis: {
        type: "category",
        data: top.map((b) => b.localidade),
        axisLine: { lineStyle: { color: ink.axisLine } },
        axisLabel: { color: ink.axis, fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 18,
          data: top.map((b) => ({
            value: b.total,
            itemStyle: glassBar(corPct(b.pctNeg), { horizontal: true, radius: [0, 6, 6, 0] }),
          })),
        },
      ],
    };
  }, [bairros, ink]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando bairros…</div>;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Mapa da Cidade</h1>
          <p className="text-sm text-txt-2">
            Onde a conversa se concentra — bairros e locais citados nos comentários
          </p>
        </div>
        <div className="flex rounded-lg border border-line bg-bg-1 p-1">
          {([["volume", "Mais citados"], ["negativo", "Mais críticos"]] as [Ordem, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                onClick={() => setOrdem(id)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  ordem === id ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>

      {bairros.length === 0 ? (
        <div className="rounded-2xl border border-line bg-bg-1 p-8 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-bg-2 text-txt-3">
            <IconInbox size={20} />
          </div>
          <p className="font-semibold text-txt-1">Nenhum bairro identificado ainda</p>
          <p className="mt-1 text-sm text-txt-2">
            Os locais são extraídos dos comentários pelo AGORA. Assim que uma coleta
            processar comentários citando bairros, eles aparecem aqui.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-txt-3">Locais citados</div>
              <div className="tnum mt-1 text-2xl font-extrabold text-txt-1">{bairros.length}</div>
            </div>
            <div className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-txt-3">Menções com local</div>
              <div className="tnum mt-1 text-2xl font-extrabold text-txt-1">{totalMencoes}</div>
            </div>
            <div className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-txt-3">Bairro mais crítico</div>
              <div className="mt-1 truncate text-lg font-extrabold" style={{ color: "#EF4444" }}>
                {[...bairros].sort((a, b) => b.pctNeg - a.pctNeg)[0]?.localidade ?? "—"}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-bg-1 p-4">
            <div className="mb-2 text-sm font-bold">Menções por local (cor = % negativo)</div>
            <ReactECharts option={chartOption} style={{ height: Math.max(220, Math.min(12, bairros.length) * 30) }} notMerge />
          </div>

          <div className="space-y-2">
            {bairros.map((b) => (
              <div key={b.localidade} className="card-hover rounded-xl border border-line bg-bg-1 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-txt-1">{b.localidade}</span>
                  {b.temaTop && (
                    <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[11px] font-semibold text-txt-2">
                      {labelTema(b.temaTop)}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-xs text-txt-3">
                    <span className="tnum">{b.total} menções</span>
                    {b.pctNeg >= 50 && <IconWarningTriangle size={13} />}
                    <span className="tnum font-bold" style={{ color: corPct(b.pctNeg) }}>
                      {b.pctNeg}% neg
                    </span>
                  </span>
                </div>
                <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-bg-2">
                  <div style={{ width: `${b.pctPos}%`, background: "#22C55E" }} />
                  <div style={{ width: `${b.pctNeg}%`, background: "#EF4444" }} />
                </div>
                {b.pedidos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {b.pedidos.map((p, i) => (
                      <span key={i} className="rounded-md bg-bg-2 px-2 py-0.5 text-[11px] text-txt-2">
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
