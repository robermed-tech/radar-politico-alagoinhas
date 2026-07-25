/**
 * Critérios de sentimento compartilhados pelo painel.
 *
 * O que o clima mede é o sentimento que o CIDADÃO expressou sobre a atual
 * gestão municipal. Duas consequências disso valem para toda leitura de
 * comentário no frontend, e espelham o que o agora.py aplica na origem:
 *
 *   1. Só comentário de cidadão entra na conta. Perfil político (assessoria,
 *      vereador, portal) não é população e nunca foi classificado de fato.
 *   2. Comentário que o classificador marcou com confiança abaixo de
 *      CONFIANCA_MIN não conta como crítica nem como elogio. O modelo declarou
 *      que não conseguiu decidir; contar como certeza inflava o lado maior.
 *
 * O valor gêmeo no backend é `CONFIANCA_MIN_SENTIMENTO` (agora.py). Se mudar
 * aqui, mude lá: os dois calculam o mesmo percentual por caminhos diferentes.
 */
export const CONFIANCA_MIN = 50;

/**
 * A classificação deste comentário pode contar como crítica ou elogio?
 *
 * Confiança ausente ou 0 vem de comentário anterior ao campo: a confiança
 * nunca foi medida, então o valor é mantido em vez de reprovado à toa.
 */
export function sentimentoConfiavel(c: { confianca_tema?: number }): boolean {
  const conf = Number(c.confianca_tema ?? 0);
  if (!Number.isFinite(conf)) return true;
  return conf === 0 || conf >= CONFIANCA_MIN;
}

/**
 * Rebaixa para "neutro" o sentimento que o classificador não conseguiu
 * decidir. Aplicado na camada de dados, e não em cada tela, para que nenhuma
 * contagem nova volte a somar chute como se fosse crítica: quem consome
 * `comments` já recebe o dado com essa política aplicada.
 *
 * O texto do comentário continua intacto e visível no drill-down. O que muda
 * é só o peso dele na conta, que passa a ser zero em vez de um voto.
 */
export function comSentimentoConfiavel<T extends { sentimento?: string; confianca_tema?: number }>(
  c: T
): T {
  return sentimentoConfiavel(c) ? c : { ...c, sentimento: "neutro" };
}
