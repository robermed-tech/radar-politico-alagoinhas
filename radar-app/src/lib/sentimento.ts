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
 *
 * AO MEXER, medir antes: quantos comentários da base saem da contagem e como
 * o IAD do período se move com o corte novo. Limiar que descarta quase tudo e
 * limiar que não descarta nada falham igual — os dois anulam a checagem.
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

/**
 * Piso de confiança para DESTACAR um comentário como voz individual ("Vozes
 * que aprovam"/"que reprovam" da Aprovação). Mais alto que o CONFIANCA_MIN
 * da contagem de propósito: no agregado, um comentário fronteiriço é 1 voto
 * em centenas; em destaque, ele vira UMA citação com a chancela da tela.
 *
 * O caso que originou o piso (01/08): dois elogios a um vereador de oposição
 * ("vcs tem que virar prefeito e vice urgente") gravados como positivo com
 * confiança exatamente 50 — o limiar mínimo — apareceram em "Vozes que
 * aprovam" como se elogiassem a gestão. Fronteira de 50 é palpite; palpite
 * não vira vitrine.
 *
 * Diferença deliberada do sentimentoConfiavel: confiança 0/ausente (comentário
 * anterior ao campo) NÃO passa aqui. Na contagem esse escape evita descartar a
 * base antiga; numa citação individual, "nunca medido" não é credencial.
 *
 * AO MEXER, contar antes quantas vozes sobram para a vitrine na base real: um
 * piso alto demais deixa a seção vazia em período normal, e vitrine vazia é
 * defeito tão visível quanto citação mal classificada.
 */
export const CONFIANCA_MIN_DESTAQUE = 70;

export function vozDestacavel(c: { confianca_tema?: number }): boolean {
  const conf = Number(c.confianca_tema ?? 0);
  return Number.isFinite(conf) && conf >= CONFIANCA_MIN_DESTAQUE;
}
