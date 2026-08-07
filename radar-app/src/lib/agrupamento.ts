/**
 * Agregação de posts por chave (perfil, tema…) com o peso por volume de
 * comentários — a conta que a Análise do Clima usa nos dois gráficos.
 *
 * Saiu da ApprovalPage em 06/08/26 porque o relatório em PDF precisa dos MESMOS
 * números que a tela mostra: duas cópias da fórmula ficariam iguais só até
 * alguém mexer numa delas, e aí o PDF entregue ao cliente contradiria o painel
 * de onde ele saiu.
 */
import type { Post } from "./data";

export interface AprovBucket {
  rotulo: string;
  pPos: number;
  pNeg: number;
  pNeu: number;
  posts: number;
  coments: number;
  cat: string;
}

export function agrupar(
  posts: Post[],
  chave: (p: Post) => string,
  limite = 8
): AprovBucket[] {
  const map: Record<
    string,
    { pos: number; neg: number; neu: number; posts: number; coments: number; cat: string }
  > = {};
  for (const p of posts) {
    const k = chave(p) || "—";
    map[k] ??= { pos: 0, neg: 0, neu: 0, posts: 0, coments: 0, cat: "" };
    const pPos = (p.comentarios_pct_pos || 0) / 100;
    const pNeg = (p.comentarios_pct_neg || 0) / 100;
    const pNeu = Math.max(0, 1 - pPos - pNeg);
    const w = 1 + Math.log10(1 + (p.comentarios_total || 0));
    map[k].pos += w * pPos;
    map[k].neg += w * pNeg;
    map[k].neu += w * pNeu;
    map[k].posts += 1;
    map[k].coments += p.comentarios_total || 0;
    if (p.categoria) map[k].cat = p.categoria; // categoria do perfil (consistente p/ perfil)
  }
  return Object.entries(map)
    .map(([rotulo, v]) => {
      const tot = v.pos + v.neg + v.neu || 1;
      return {
        rotulo,
        pPos: Math.round((v.pos / tot) * 100),
        pNeg: Math.round((v.neg / tot) * 100),
        pNeu: Math.round((v.neu / tot) * 100),
        posts: v.posts,
        coments: v.coments,
        cat: v.cat,
      };
    })
    .sort((a, b) => b.pPos - a.pPos || b.coments - a.coments)
    .slice(0, limite);
}
