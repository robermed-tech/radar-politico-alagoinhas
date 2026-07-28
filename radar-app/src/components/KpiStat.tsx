import { type ReactNode } from "react";

interface KpiStatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: { v: number; dir: "up" | "down" | "flat" };
  invertDelta?: boolean; // para métricas onde "subir" é ruim (ex: negativo)
}

export function KpiStat({ label, value, sub, delta, invertDelta }: KpiStatProps) {
  const good = delta
    ? invertDelta
      ? delta.dir === "down"
      : delta.dir === "up"
    : true;
  return (
    <div className="card-hover rounded-2xl border border-line bg-bg-1 px-4 py-3.5">
      <div className="section-label">{label}</div>
      {/* Número em destaque maior (revisão de 27/07: 2rem -> 2.75rem) e peso
          semibold em vez de light — o pedido foi "aumente o tamanho dos
          números", e um número grande em traço fino continuava discreto. */}
      <div className="mt-1.5 flex items-end gap-2">
        <span className="tnum text-[2.75rem] font-semibold leading-none tracking-tight text-txt-1">{value}</span>
        {delta && delta.dir !== "flat" && (
          <span
            className={`tnum mb-1.5 text-sm font-bold ${good ? "text-risk-low" : "text-risk-crit"}`}
          >
            {delta.dir === "up" ? "▲" : "▼"} {Math.abs(delta.v)}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-sm font-semibold text-txt-2">{sub}</div>}
    </div>
  );
}
