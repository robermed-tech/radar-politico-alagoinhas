import type { PipelineHealth } from "@/lib/data";
import { IconAlertBell, IconWarningTriangle } from "@/components/icons";

/**
 * Hero de saúde do pipeline — visível para qualquer usuário logado (não só
 * admin), em qualquer tela, porque "o radar parou" é informação relevante
 * antes de qualquer índice que ele mostra. Fica silencioso quando tudo está
 * normal (mesmo padrão dos outros banners do produto) e some assim que a
 * próxima execução normalizar — não exige nenhuma ação para "descartar".
 *
 * Limiares espelham heartbeat_check.py (9h) e o antigo banner de App.tsx (8h)
 * — mantidos próximos de propósito para o texto do dashboard nunca contradizer
 * o alerta que já pode ter chegado por WhatsApp.
 */

const LIMIAR_CRITICO_H = 9;

function horasDesde(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function fmtQuando(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function PipelineHealthBanner({ health }: { health: PipelineHealth | null | undefined }) {
  if (!health?.executado_em) return null;

  const horas = horasDesde(health.executado_em);
  const coletaVazia = health.status === "coleta_vazia" || (health.posts_coletados ?? 0) === 0;
  const parado = horas > LIMIAR_CRITICO_H || health.status === "erro";

  if (!parado && !coletaVazia) return null;

  const critico = parado; // parado é sempre o estado mais grave
  const cor = critico ? "#EF4444" : "#F97316";
  const bg = critico ? "rgba(239,68,68,0.10)" : "rgba(249,115,22,0.10)";
  const borda = critico ? "rgba(239,68,68,0.35)" : "rgba(249,115,22,0.35)";

  const titulo = critico
    ? `Radar parado há ${Math.round(horas)}h`
    : "Última coleta não trouxe posts novos";

  const detalhe = critico
    ? "O pipeline não roda ou não grava dados no horário esperado. Os números abaixo podem estar defasados."
    : "O pipeline executou, mas não coletou nenhum post — possível bloqueio do Instagram, token expirado ou limite do Apify.";

  return (
    <div
      className="flex flex-wrap items-start gap-3 border-b px-4 py-3"
      style={{ background: bg, borderColor: borda }}
      role="alert"
    >
      <span className="mt-0.5 shrink-0" style={{ color: cor }}>
        {critico ? <IconAlertBell size={18} /> : <IconWarningTriangle size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold" style={{ color: cor }}>{titulo}</div>
        <div className="text-xs text-txt-2">{detalhe}</div>
      </div>
      <div className="shrink-0 text-[11px] text-txt-3">
        Última execução: {fmtQuando(health.executado_em)}
      </div>
    </div>
  );
}
