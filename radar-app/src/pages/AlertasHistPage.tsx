import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEnviosManuais, type EnvioManual } from "@/lib/admin";
import { IconAlertBell } from "@/components/icons";

/**
 * Histórico de Alertas — decisão da reunião de 24/07: em vez dos disparos
 * automáticos do agente (removidos para reduzir risco de alucinação), esta
 * página registra os envios MANUAIS feitos no card "Alertar Secretário":
 * o quê foi enviado, para quem, por qual canal e quando — para o gestor poder
 * comprovar "eu enviei sim, aqui, tal hora".
 */

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

const CANAL_COR: Record<string, string> = {
  whatsapp: "#16A34A",
  email: "#2563EB",
};

function BadgeCanal({ canal }: { canal: string }) {
  const cor = CANAL_COR[canal] ?? "#64748B";
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide"
      style={{ background: `${cor}1A`, color: cor, border: `1px solid ${cor}44` }}
    >
      {CANAL_LABEL[canal] ?? canal}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-10 text-center">
      <IconAlertBell size={28} className="mx-auto mb-2 text-txt-3" />
      <div className="font-semibold text-txt-1">Nenhum envio registrado</div>
      <div className="mt-1 text-sm text-txt-3">
        Cada alerta enviado pelo botão "Alertar Secretário" fica registrado aqui:
        quem enviou, para quem, por qual canal e quando.
      </div>
    </div>
  );
}

function LinhaEnvio({ e }: { e: EnvioManual }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-bg-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="tnum text-xs text-txt-3">{fmtDt(e.created_at)}</span>
        <BadgeCanal canal={e.channel} />
        {e.tema && (
          <span className="rounded bg-bg-1 px-2 py-0.5 text-[13px] font-bold frase-cap text-txt-1">
            {e.tema}
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-txt-2">
          {e.sent_by_nome ? <>por <b className="text-txt-1">{e.sent_by_nome}</b></> : null}
          {e.recipient ? <> · para <b className="text-txt-1">{e.recipient}</b></> : null}
        </span>
        {e.mensagem && (
          <button
            onClick={() => setAberto((v) => !v)}
            className="ml-auto shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold text-white transition hover:opacity-90"
            style={{ background: "#334155" }}
          >
            {aberto ? "Ocultar mensagem" : "Ver mensagem"}
          </button>
        )}
      </div>
      {aberto && e.mensagem && (
        <pre
          className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-bg-1 p-3 text-xs leading-relaxed text-txt-1"
          style={{ fontFamily: "inherit" }}
        >
          {e.mensagem}
        </pre>
      )}
    </div>
  );
}

export function AlertasHistPage() {
  const { data: envios = [], isLoading } = useQuery<EnvioManual[]>({
    queryKey: ["envios-manuais"],
    queryFn: () => fetchEnviosManuais(200),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div className="p-8 text-txt-2">Carregando histórico de alertas…</div>;

  const total = envios.length;
  const totalWhats = envios.filter((e) => e.channel === "whatsapp").length;
  const totalEmail = envios.filter((e) => e.channel === "email").length;

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Histórico de Alertas</h1>
        <p className="text-sm text-txt-2">
          Alertas enviados manualmente aos secretários pelo botão "Alertar Secretário"
        </p>
      </div>

      {/* Contadores rápidos */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total de envios", value: total, cor: "var(--txt1)" },
          { label: "Via WhatsApp", value: totalWhats, cor: "#16A34A" },
          { label: "Via E-mail", value: totalEmail, cor: "#2563EB" },
        ].map(({ label, value, cor }) => (
          <div key={label} className="card-hover rounded-xl border border-line bg-bg-1 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-txt-3">{label}</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums" style={{ color: cor }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {envios.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {envios.map((e) => (
            <LinhaEnvio key={e.id} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}
