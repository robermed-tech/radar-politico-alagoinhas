import { useQuery } from "@tanstack/react-query";
import { fetchAlertHistory, type AlertaHistorico } from "@/lib/data";
import { IconAlertBell } from "@/components/icons";

function fmtDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const CANAL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
};

const TIPO_COR: Record<string, string> = {
  auto: "#F97316",
  manual: "#3B82F6",
};

function BadgeCanal({ canal }: { canal: string }) {
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: "#1E293B", color: "#94A3B8", border: "1px solid #334155" }}
    >
      {CANAL_LABEL[canal] ?? canal}
    </span>
  );
}

function BadgeTipo({ tipo }: { tipo: string }) {
  const cor = TIPO_COR[tipo] ?? "#6B7280";
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
    >
      {tipo}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-10 text-center">
      <IconAlertBell size={28} className="mx-auto mb-2 text-txt-3" />
      <div className="font-semibold text-txt-1">Nenhum alerta registrado</div>
      <div className="mt-1 text-sm text-txt-3">
        Os alertas automáticos aparecem aqui quando o AGORA os dispara via WhatsApp.
      </div>
    </div>
  );
}

export function AlertasHistPage() {
  const { data: alertas = [], isLoading } = useQuery<AlertaHistorico[]>({
    queryKey: ["alerta-historico"],
    queryFn: () => fetchAlertHistory(200),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div className="p-8 text-txt-2">Carregando histórico de alertas…</div>;

  const total = alertas.length;
  const totalWhats = alertas.filter((a) => a.canal === "whatsapp").length;
  const totalAuto  = alertas.filter((a) => a.tipo === "auto").length;

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Histórico de Alertas</h1>
        <p className="text-sm text-txt-2">
          Alertas automáticos disparados pelo AGORA via WhatsApp
        </p>
      </div>

      {/* Contadores rápidos */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total de alertas", value: total, cor: "#F97316" },
          { label: "Via WhatsApp",     value: totalWhats, cor: "#22C55E" },
          { label: "Automáticos",      value: totalAuto,  cor: "#3B82F6" },
        ].map(({ label, value, cor }) => (
          <div key={label} className="rounded-xl border border-line bg-bg-1 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-txt-3">{label}</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums" style={{ color: cor }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      {alertas.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-txt-3">
                <tr>
                  <th className="py-2 text-left font-semibold">Data / Hora</th>
                  <th className="py-2 text-left font-semibold">Tipo</th>
                  <th className="py-2 text-left font-semibold">Canal</th>
                  <th className="py-2 text-right font-semibold">IAD</th>
                  <th className="py-2 text-left font-semibold pl-4">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {alertas.map((a, i) => (
                  <tr key={a.id ?? i} className="border-b border-line/40 hover:bg-bg-2/60 transition-colors">
                    <td className="py-2.5 tabular-nums text-txt-2 whitespace-nowrap">
                      {fmtDt(a.criado_em)}
                    </td>
                    <td className="py-2.5">
                      <BadgeTipo tipo={a.tipo} />
                    </td>
                    <td className="py-2.5">
                      <BadgeCanal canal={a.canal} />
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-semibold text-txt-2">
                      {a.valor != null ? `${a.valor}%` : "—"}
                    </td>
                    <td className="py-2.5 pl-4 text-txt-1 max-w-md">
                      <span className="line-clamp-2">{a.mensagem}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
