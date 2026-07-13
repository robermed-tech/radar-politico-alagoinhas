/**
 * Resumo em prosa dos comentários — "termômetro" pedido no áudio de 03/07:
 * uma frase só, no espírito do resumo de avaliações do Mercado Livre, do tipo
 * "70% elogiaram a gestão, com destaque para a organização da festa; 30%
 * criticaram, sobretudo o transporte".
 *
 * Reaproveita campos que a IA JÁ preenche por post (comentarios_pct_pos/neg,
 * queixa_dominante, elogio_dominante) — nenhuma chamada extra ao modelo, custo
 * zero. É montagem determinística no cliente.
 */
import type { Post } from "./data";

/** minúscula na 1ª letra, preservando siglas (SAAE, SUS, UPA…). */
function descapitalizar(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const primeira = t.split(/\s+/)[0];
  if (primeira.length > 1 && primeira === primeira.toUpperCase()) return t; // sigla
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function capitalizar(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export interface ResumoInput {
  pos: number; // % positivos (0-100)
  neg: number; // % negativos (0-100)
  queixa?: string;
  elogio?: string;
}

/**
 * Monta a frase a partir dos percentuais e das queixa/elogio dominantes.
 * Retorna "" quando não há sinal suficiente (deixa o chamador cair no resumo
 * bruto da IA, se houver).
 */
export function resumoProsa({ pos, neg, queixa, elogio }: ResumoInput): string {
  const p = Math.max(0, Math.round(pos));
  const n = Math.max(0, Math.round(neg));
  const neu = Math.max(0, 100 - p - n);
  const q = (queixa || "").trim();
  const e = (elogio || "").trim();

  if (p === 0 && n === 0) {
    if (neu >= 60) return "Comentários majoritariamente neutros — sem elogio nem crítica predominante.";
    return "";
  }

  const fraseElogio =
    `${p}% dos comentários apoiaram a gestão` + (e ? `, com destaque para ${descapitalizar(e)}` : "");
  const fraseQueixa =
    `${n}% criticaram` + (q ? `, sobretudo ${descapitalizar(q)}` : "");

  // Só um lado tem sinal.
  if (p > 0 && n === 0) return capitalizar(fraseElogio) + ".";
  if (n > 0 && p === 0) return capitalizar(fraseQueixa) + ".";

  // Neutro é a maioria clara: lidera com ele e cita o lado mais forte.
  if (neu > p && neu > n) {
    const forte = n >= p ? fraseQueixa : fraseElogio;
    return capitalizar(`a maioria (${neu}%) ficou neutra; ${forte}.`);
  }

  // Dois lados com sinal: lidera pelo dominante.
  const [primeiro, segundo] = p >= n ? [fraseElogio, fraseQueixa] : [fraseQueixa, fraseElogio];
  return capitalizar(`${primeiro}; ${segundo}.`);
}

/** Resumo em prosa de um post, com fallback para o resumo bruto da IA. */
export function resumoProsaPost(post: Post): string {
  const semDados =
    (post.comentarios_total || 0) === 0 ||
    ((post.comentarios_pct_pos || 0) === 0 && (post.comentarios_pct_neg || 0) === 0);
  if (semDados) return (post.resumo || "").trim();

  const frase = resumoProsa({
    pos: post.comentarios_pct_pos || 0,
    neg: post.comentarios_pct_neg || 0,
    queixa: post.queixa_dominante,
    elogio: post.elogio_dominante,
  });
  return frase || (post.resumo || "").trim();
}
