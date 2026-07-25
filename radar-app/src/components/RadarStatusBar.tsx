import { useQuery } from "@tanstack/react-query";
import { fetchCollectionLogsHoje, fetchFontesUnificadas, calcKpis } from "@/lib/collection";
import { fmtInt } from "@/lib/format";

/**
 * Barra compacta do "radar de coleta" na página principal (decisão da reunião
 * de 24/07: o status do monitor precisa aparecer no topo do dashboard, logo
 * abaixo do clima, para passar a sensação de sistema ativo). A versão completa
 * continua na aba Monitor de coleta da Configuração.
 */
function MiniRadarSweep({ ativo, size = 34 }: { ativo: boolean; size?: number }) {
  const cor = ativo ? "#22C55E" : "#F59E0B";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <style>{`
        @keyframes radar-mini-spin { to { transform: rotate(360deg); } }
        .radar-mini-sweep { animation: radar-mini-spin 3.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .radar-mini-sweep { animation: none; } }
      `}</style>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" style={{ color: cor }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.30" strokeWidth="3" />
        <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
      </svg>
      <div
        className="radar-mini-sweep absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, ${cor}00 0deg, ${cor}00 290deg, ${cor}55 350deg, ${cor}AA 360deg)`,
          WebkitMaskImage: "radial-gradient(circle, #000 60%, transparent 61%)",
          maskImage: "radial-gradient(circle, #000 60%, transparent 61%)",
        }}
      />
      <span
        className="absolute rounded-full"
        style={{ width: 5, height: 5, background: cor, boxShadow: `0 0 8px ${cor}`, top: "calc(50% - 2.5px)", left: "calc(50% - 2.5px)" }}
      />
    </div>
  );
}

export function RadarStatusBar() {
  const { data: logs } = useQuery({
    queryKey: ["coleta-logs-hoje"],
    queryFn: fetchCollectionLogsHoje,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: sources } = useQuery({
    queryKey: ["coleta-fontes-unificadas"],
    queryFn: fetchFontesUnificadas,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const kpis = calcKpis(logs ?? [], sources ?? []);
  const ativo = kpis.fontesAtivas > 0;
  const cor = ativo ? "#22C55E" : "#F59E0B";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line bg-bg-1 px-4 py-2.5">
      <MiniRadarSweep ativo={ativo} />
      <div className="min-w-0">
        <span className="text-sm font-extrabold text-txt-1">
          {ativo ? "Radar em varredura" : "Radar ocioso"}
        </span>
        <span
          className="ml-2 inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: cor, boxShadow: `0 0 6px ${cor}` }}
        />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[13px] text-txt-2">
        <span>
          <b className="tnum text-txt-1">{fmtInt(kpis.fontesAtivas)}</b> fonte{kpis.fontesAtivas === 1 ? "" : "s"} monitorada{kpis.fontesAtivas === 1 ? "" : "s"}
        </span>
        <span>
          <b className="tnum text-txt-1">{fmtInt(kpis.itensColetados)}</b> item{kpis.itensColetados === 1 ? "" : "s"} coletado{kpis.itensColetados === 1 ? "" : "s"} hoje
        </span>
        <span>
          <b className="tnum text-txt-1">{fmtInt(kpis.execucoes)}</b> execuç{kpis.execucoes === 1 ? "ão" : "ões"}
        </span>
      </div>
    </div>
  );
}
