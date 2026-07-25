/**
 * "Assuntos em alta" — subtemas que se repetem numa janela de 24h.
 *
 * Materializa o pedido do áudio de 03/07: uma mesma ideia repetida por várias
 * pessoas vira sensação popular; um comentário isolado, não. O limiar (nº mínimo
 * de comentários) vem de `tenant_settings.notification_config.subtema_limiar`, o
 * MESMO valor que arma o alerta de WhatsApp no agora.py — aqui é a face visível
 * dele. A pílula indica se o disparo automático está ligado.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchSubtemasRecentes, type SubtemaEmAlta } from "@/lib/data";
import { useNotificationConfig } from "@/lib/settings";
import { IconTrendUp, IconWarningTriangle } from "@/components/icons";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
};
const labelTema = (t: string) => TEMA_LABEL[t] ?? (t ? t[0].toUpperCase() + t.slice(1) : "—");
const labelSub = (s: string) => s.replace(/_/g, " ");

function corSeveridade(pctNeg: number): string {
  if (pctNeg >= 60) return "#EF4444";
  if (pctNeg >= 35) return "#F97316";
  return "#EAB308";
}

function LinhaAlta({ s, limiar }: { s: SubtemaEmAlta; limiar: number }) {
  const cor = corSeveridade(s.pctNeg);
  return (
    <div
      className="rounded-lg border bg-bg-2 p-3"
      style={{ borderColor: `${cor}44`, borderLeftColor: cor, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-txt-1 capitalize">{labelSub(s.subtema)}</span>
        <span className="text-[13px] text-txt-3">{labelTema(s.tema)}</span>
        <span
          className="ml-auto tnum shrink-0 rounded-md px-2 py-0.5 text-[13px] font-bold"
          style={{ background: `${cor}1A`, color: cor }}
        >
          {s.total} comentários
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-txt-3">
        <span className="tnum">{s.autores} {s.autores === 1 ? "pessoa" : "pessoas diferentes"}</span>
        <span className="tnum" style={{ color: cor }}>{s.pctNeg}% negativos</span>
        <span className="tnum text-txt-3">limiar {limiar}</span>
      </div>
      {s.exemplo && (
        <p className="mt-1.5 line-clamp-2 text-[13px] italic text-txt-2">"{s.exemplo}"</p>
      )}
    </div>
  );
}

export function AssuntosEmAlta() {
  const cfg = useNotificationConfig();
  const limiar = Math.max(2, cfg.subtema_limiar || 3);

  const { data = [], isLoading } = useQuery({
    queryKey: ["subtemas-recentes"],
    queryFn: () => fetchSubtemasRecentes(24),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) return null;

  const emAlta = data.filter((s) => s.total >= limiar);
  const aproximando = data.filter((s) => s.total >= limiar - 1 && s.total < limiar).slice(0, 4);

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-1 flex items-center gap-2">
        <IconTrendUp size={16} style={{ color: "#F97316" }} />
        <h3 className="text-sm font-bold text-txt-1">Assuntos em alta · 24h</h3>
        <span
          className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide"
          style={
            cfg.subtema_ativo
              ? { background: "rgba(34,197,94,0.14)", color: "#22C55E" }
              : { background: "var(--g3)", color: "var(--txt3)" }
          }
          title={
            cfg.subtema_ativo
              ? "O agora.py dispara alerta de WhatsApp quando um subtema cruza o limiar"
              : "Alerta automático desligado — ligue na aba Notificações da Configuração"
          }
        >
          {cfg.subtema_ativo ? "Alerta ligado" : "Alerta desligado"}
        </span>
      </div>
      <p className="mb-3 text-[12px] text-txt-3">
        Quando um mesmo assunto aparece em {limiar}+ comentários no dia, deixa de ser voz isolada
        e vira pauta — independente do risco de cada post.
      </p>

      {emAlta.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-[14px] text-txt-2">
          <IconWarningTriangle size={14} className="shrink-0 text-txt-3" />
          Nenhum assunto cruzou {limiar} comentários nas últimas 24h.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {emAlta.map((s) => (
            <LinhaAlta key={`${s.tema}|${s.subtema}`} s={s} limiar={limiar} />
          ))}
        </div>
      )}

      {aproximando.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-txt-3">
            Se aproximando do limiar
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {aproximando.map((s) => (
              <span
                key={`${s.tema}|${s.subtema}`}
                className="rounded-md border border-line bg-bg-2 px-2 py-1 text-[13px] text-txt-2"
              >
                <span className="capitalize">{labelSub(s.subtema)}</span>
                <span className="tnum ml-1.5 text-txt-3">{s.total}/{limiar}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
