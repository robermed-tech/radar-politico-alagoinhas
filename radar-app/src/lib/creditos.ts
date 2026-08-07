/**
 * Fonte ÚNICA de como o painel escreve consumo de serviço externo (créditos da
 * Apify, uso da API Anthropic).
 *
 * Por que existe (06/08/26): o mesmo dado aparecia em dois lugares com duas
 * grafias. O banner de saúde dizia "US$ 29,33 de US$ 29,00" e a Configuração
 * dizia "$29.33 de $29.00 · 101% do limite mensal" — mesma linha de
 * `service_status`, ponto decimal contra vírgula, "$" contra "US$", e um
 * percentual arredondado para 101% quando o valor medido é 101,1%. Em
 * português "US$ 29.33" se lê como outro número, então quem olhava as duas
 * telas via dois estados do mesmo serviço. Pior: a 101% a Configuração ainda
 * chamava de "quase esgotados", contradizendo a barra cheia ao lado e o banner
 * que já dizia "esgotados".
 *
 * A correção não foi acertar os dois textos à mão (foi assim que eles
 * divergiram): número, percentual, nível e rótulo saem daqui, e as telas só
 * consomem.
 */

export type NivelCredito = "ok" | "atencao" | "critico" | "estourado";

/** Limiares de nível. O de 80% é o do alerta de WhatsApp no backend
 *  (agora.py::verificar_creditos_apify e registrar_uso_anthropic); os daqui
 *  governam só a cor, e o "atenção" abre antes de propósito para a tela
 *  acender antes de a mensagem sair. */
export const PCT_ATENCAO = 70;
export const PCT_CRITICO = 90;
/** Percentual a partir do qual o backend dispara o aviso por WhatsApp. */
export const PCT_ALERTA_WHATSAPP = 80;

export function nivelCredito(pct: number): NivelCredito {
  if (pct >= 100) return "estourado";
  if (pct >= PCT_CRITICO) return "critico";
  if (pct >= PCT_ATENCAO) return "atencao";
  return "ok";
}

export interface CorNivel {
  cor: string;
  bg: string;
  borda: string;
}

/* Vermelho/verde aqui NÃO são sentimento: são o mesmo sistema paralelo de
   risco já usado por NIVEL_COLOR e pelas bandeiras de alerta. */
export const COR_CREDITO: Record<NivelCredito, CorNivel> = {
  ok:        { cor: "#22C55E", bg: "rgba(34,197,94,0.06)",  borda: "rgba(34,197,94,0.22)" },
  atencao:   { cor: "#F97316", bg: "rgba(249,115,22,0.08)", borda: "rgba(249,115,22,0.30)" },
  critico:   { cor: "#EF4444", bg: "rgba(239,68,68,0.08)",  borda: "rgba(239,68,68,0.30)" },
  estourado: { cor: "#EF4444", bg: "rgba(239,68,68,0.12)",  borda: "rgba(239,68,68,0.42)" },
};

/** Valor em dólar como se escreve em português: "US$ 29,33". */
export function fmtUSD(v: number): string {
  return `US$ ${(Number.isFinite(v) ? v : 0).toFixed(2).replace(".", ",")}`;
}

/** Percentual com UMA casa, sempre — é a precisão com que o backend grava
 *  (`round(pct, 1)`), e arredondar para inteiro numa tela e não na outra foi
 *  metade da divergência original. */
export function fmtPctCredito(pct: number): string {
  return `${(Number.isFinite(pct) ? pct : 0).toFixed(1).replace(".", ",")}%`;
}

/** "US$ 29,33 de US$ 29,00 · 101,1% do limite mensal" — a frase inteira, para
 *  nenhuma tela montar a sua própria. */
export function frasePctConsumo(uso: number, teto: number, pct: number): string {
  return `${fmtUSD(uso)} de ${fmtUSD(teto)} consumidos · ${fmtPctCredito(pct)} do limite mensal`;
}

/** Título do cartão por nível. "Esgotados" a partir de 100%: acima do teto
 *  não é "quase". */
export function tituloCredito(nome: string, nivel: NivelCredito): string {
  if (nivel === "estourado") return `Créditos ${nome} esgotados`;
  if (nivel === "critico") return `Créditos ${nome} quase esgotados`;
  if (nivel === "atencao") return `Créditos ${nome} em atenção`;
  return `Créditos ${nome}`;
}

export function fmtQuandoCredito(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
