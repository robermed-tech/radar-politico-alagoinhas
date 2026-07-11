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
      <div className="mt-1.5 flex items-end gap-2">
        <span className="tnum text-[2rem] font-light leading-none tracking-tight text-txt-1">{value}</span>
        {delta && delta.dir !== "flat" && (
          <span
            className={`tnum mb-1 text-sm font-medium ${good ? "text-risk-low" : "text-risk-crit"}`}
          >
            {delta.dir === "up" ? "▲" : "▼"} {Math.abs(delta.v)}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-txt-2">{sub}</div>}
    </div>
  );
}
