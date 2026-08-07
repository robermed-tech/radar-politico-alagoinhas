/**
 * Cartão de consumo de um serviço externo (Apify, Anthropic).
 *
 * Um componente só para os dois serviços de propósito: eram duas caixas
 * parecidas escritas separadamente, e foi assim que o mesmo número passou a
 * ser exibido de dois jeitos (ver o cabeçalho de lib/creditos.ts). Título,
 * frase de consumo, cor e percentual vêm todos de `lib/creditos.ts`.
 */
import type { ServiceStatus } from "@/lib/data";
import {
  COR_CREDITO, fmtQuandoCredito, frasePctConsumo, nivelCredito, tituloCredito,
} from "@/lib/creditos";
import { IconWarningTriangle } from "@/components/icons";

interface Props {
  /** Nome do serviço como aparece no título ("Apify", "Anthropic"). */
  nome: string;
  status: ServiceStatus | null | undefined;
  carregando?: boolean;
  /** O que este número mede — uma linha, sempre visível. */
  descricao: string;
  /** Texto do estado sem leitura nenhuma no banco. */
  vazio: string;
  /** O que fazer quando o consumo está no vermelho (recarregar, comprar…). */
  acao?: string;
  /** Conteúdo extra no rodapé do cartão (ex.: estado do alerta de WhatsApp). */
  children?: React.ReactNode;
}

export function CartaoCredito({
  nome, status, carregando, descricao, vazio, acao, children,
}: Props) {
  if (carregando) return null;

  if (!status) {
    return (
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="text-sm font-bold text-txt-1">Créditos {nome}</div>
        <div className="mt-0.5 text-xs text-txt-3">{vazio}</div>
        {children}
      </div>
    );
  }

  const pct = status.uso_pct ?? 0;
  const nivel = nivelCredito(pct);
  const { cor, bg, borda } = COR_CREDITO[nivel];
  const alerta = nivel !== "ok";

  return (
    <div className="rounded-xl border p-4" style={{ background: bg, borderColor: borda }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color: cor }}>
            {alerta && <IconWarningTriangle size={16} />}
            {tituloCredito(nome, nivel)}
          </div>
          <div className="mt-0.5 text-xs text-txt-3">
            {frasePctConsumo(status.uso_usd ?? 0, status.teto_usd ?? 0, pct)}
          </div>
          <div className="mt-0.5 text-xs text-txt-3">{descricao}</div>
          {acao && nivel !== "ok" && (
            <div className="mt-1 text-xs font-semibold" style={{ color: cor }}>{acao}</div>
          )}
        </div>
        <div className="text-[13px] text-txt-3">
          Atualizado {fmtQuandoCredito(status.atualizado_em)}
        </div>
      </div>
      {/* A barra satura em 100%: acima do teto ela não tem para onde crescer, e
          quem diz o quanto passou é o percentual da frase acima. */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: cor }}
        />
      </div>
      {nivel === "estourado" && (
        <div className="mt-1.5 text-[12px] font-semibold" style={{ color: cor }}>
          Consumo acima do teto contratado.
        </div>
      )}
      {children}
    </div>
  );
}
