import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEnviosManuais, type EnvioManual } from "@/lib/admin";
import { IconAlertBell } from "@/components/icons";
import { ContadorAnimado } from "@/components/ContadorAnimado";

/**
 * Histórico de Alertas — decisão da reunião de 24/07: em vez dos disparos
 * automáticos do agente (removidos para reduzir risco de alucinação), esta
 * página registra os envios MANUAIS feitos no card "Alertar Secretário":
 * o quê foi enviado, para quem, por qual canal e quando — para o gestor poder
 * comprovar "eu enviei sim, aqui, tal hora".
 */

function fmtHora(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** Cabecalho do grupo de dia ("Hoje - 04/08/26"). */
function rotuloDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  if (mesmoDia(d, hoje)) return `Hoje · ${data}`;
  if (mesmoDia(d, ontem)) return `Ontem · ${data}`;
  return data;
}

const CANAL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
};

/* Previa 3 de 04/08: o canal perdeu o verde/azul decorativo — canal nao e
   semantica de sentimento. Chip neutro, o dado e o nome. */
function BadgeCanal({ canal }: { canal: string }) {
  return (
    <span className="inline-block rounded-md border border-line bg-bg-2 px-2 py-0.5 text-[12px] font-extrabold uppercase tracking-wide text-txt-2">
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
    // Espinha chumbo a esquerda (previa 3): a linha vira item de linha do
    // tempo, nao mais uma linha de tabela.
    <div className="relative rounded-[14px] border border-line bg-bg-1 px-4 py-3 pl-6" style={{ boxShadow: "var(--shadow-ambient)" }}>
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
        style={{ background: "linear-gradient(165deg, #55534E, #171613)" }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BadgeCanal canal={e.channel} />
        {e.tema && (
          <span
            className="rounded px-2 py-0.5 text-[12.5px] font-bold frase-cap"
            style={{ background: "rgba(247,150,65,0.10)", color: "var(--brand-text)" }}
          >
            {e.tema}
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-txt-2">
          {e.sent_by_nome ? <>por <b className="text-txt-1">{e.sent_by_nome}</b></> : null}
          {e.recipient ? <> · para <b className="text-txt-1">{e.recipient}</b></> : null}
        </span>
        <span className="tnum ml-auto shrink-0 text-[13px] font-semibold text-txt-3">{fmtHora(e.created_at)}</span>
        {e.mensagem && (
          <button
            onClick={() => setAberto((v) => !v)}
            className="shrink-0 rounded-full px-3 py-1 text-[13px] font-bold text-white transition hover:opacity-90"
            style={{ background: "linear-gradient(165deg, #55534E, #171613)" }}
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

  // Agrupa por dia local, preservando a ordem (a query ja vem do mais novo).
  // O useMemo vem ANTES do return antecipado de "carregando" — regra de
  // hooks: com ele depois, a primeira renderizacao registrava 1 hook e a
  // seguinte (dados prontos) registrava 2, e o React derrubava a pagina com
  // "Rendered more hooks than during the previous render". Foi o bug pego
  // pelo cliente em 04/08, logo apos a previa 3 entrar no ar.
  const grupos = useMemo(() => {
    const by = new Map<string, EnvioManual[]>();
    for (const e of envios) {
      const d = new Date(e.created_at);
      const chave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = by.get(chave) ?? [];
      arr.push(e);
      by.set(chave, arr);
    }
    return Array.from(by.entries());
  }, [envios]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando histórico de alertas…</div>;

  const total = envios.length;
  const totalWhats = envios.filter((e) => e.channel === "whatsapp").length;
  const totalEmail = envios.filter((e) => e.channel === "email").length;

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Histórico de Alertas</h1>
        <p className="text-base text-txt-2">
          Alertas enviados manualmente aos secretários pelo botão "Alertar Secretário"
        </p>
      </div>

      {/* Contadores no padrao do painel (previa 3): display + contagem
          animada, sem o verde/azul decorativo — canal nao e sentimento. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Total de envios", value: total, hint: "desde o inicio do registro" },
          { label: "Via WhatsApp", value: totalWhats, hint: "abertos no wa.me do usuario" },
          { label: "Via e-mail", value: totalEmail, hint: "copiados para envio manual" },
        ].map(({ label, value, hint }) => (
          <div key={label} className="card-hover rounded-xl border border-line bg-bg-1 p-4">
            <div className="section-label">{label}</div>
            <div className="tnum mt-1 font-display text-[34px] font-bold leading-none text-txt-1">
              <ContadorAnimado valor={value} />
            </div>
            <div className="mt-1 text-xs text-txt-3">{hint}</div>
          </div>
        ))}
      </div>

      {envios.length === 0 ? (
        <EmptyState />
      ) : (
        // Linha do tempo agrupada por DIA (previa 3): "o que ja foi mandado
        // sobre saude este mes?" sai num relance.
        <div className="space-y-5">
          {grupos.map(([dia, doDia]) => (
            <div key={dia}>
              <div className="mb-2 font-display text-[13px] font-bold uppercase tracking-[0.1em] text-txt-3">
                {rotuloDia(doDia[0].created_at)}
              </div>
              <div className="space-y-2">
                {doDia.map((e) => (
                  <LinhaEnvio key={e.id} e={e} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
