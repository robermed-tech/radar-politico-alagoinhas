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
    <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-txt-3">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="tnum text-3xl font-extrabold text-txt-1">{value}</span>
        {delta && delta.dir !== "flat" && (
          <span
            className={`tnum mb-1 text-sm font-bold ${good ? "text-risk-low" : "text-risk-crit"}`}
          >
            {delta.dir === "up" ? "▲" : "▼"} {Math.abs(delta.v)}
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-txt-2">{sub}</div>}
    </div>
  );
}
