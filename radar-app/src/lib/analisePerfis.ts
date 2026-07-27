/**
 * Análise por perfil sob o critério da tela Relevância (pedido de 27/07).
 *
 * O recorte deixou de ser "todos os posts do perfil" e passou a ser "os posts
 * do perfil que citam as palavras cadastradas em Relevância" — as mesmas
 * palavras que o `agora.py` usa para decidir o que entra na base. Sem isso, o
 * perfil de um veículo local aparecia com dezenas de publicações, das quais
 * boa parte não falava de prefeito, prefeitura ou gestão.
 *
 * ## O que é medido, e o que deliberadamente não é
 *
 * A polaridade ("crítica contrária" x "manifestação favorável") vem dos
 * **comentários de cidadãos** nesses posts — a mesma fonte, com os mesmos
 * critérios, que forma o clima (ver lib/sentimento.ts).
 *
 * O tom da **própria publicação** do perfil NÃO é medido, e não é por
 * esquecimento: o pipeline não classifica isso hoje. `posts.sentimento_post`
 * parece servir, mas não serve — o prompt do agora.py diz explicitamente que
 * ele é "o IMPACTO na imagem do prefeito pela REAÇÃO dos comentários, NÃO o
 * tom da caption". Usá-lo como se fosse a opinião do perfil transformaria a
 * reação do público na fala de quem publicou. A outra tentação, deduzir o tom
 * pela categoria do perfil (oposição = crítica), é o atalho de polaridade por
 * lado que a revisão de 25/07 removeu de todos os prompts.
 *
 * Então o eixo "quem fala mais e quem fala menos da gestão" é medido por
 * VOLUME de publicações sobre a gestão, que é um número real e auditável, e o
 * eixo de polaridade é medido onde a polaridade de fato existe: nos
 * comentários. Classificar o tom do post exige mudança no backend.
 */
import type { ComentarioLeve, Post } from "@/lib/data";
import { casaRelevancia } from "@/lib/relevancia";

export interface PerfilAnalise {
  autor: string;
  categoria: string;
  /** Publicações do perfil no período. */
  posts: number;
  /** Quantas delas citam as palavras cadastradas em Relevância. */
  postsGestao: number;
  /** Comentários de cidadãos nessas publicações. */
  comentarios: number;
  /** Comentários contrários à gestão. */
  contra: number;
  /** Comentários favoráveis à gestão. */
  favor: number;
  /** Sem lado: neutros e os que o classificador não decidiu com confiança. */
  indefinido: number;
  /** % de contrários entre os que tomam partido (neutros fora da conta). */
  pctContra: number;
  /** favor − contra: positivo = a gestão sai ganhando neste perfil. */
  saldo: number;
}

/** Amostra mínima para um perfil entrar nos rankings de polaridade. Abaixo
 *  disso "quem tem menos críticas" seria só quem teve dois comentários. */
export const MIN_AMOSTRA = 10;

export function analisarPerfis(
  posts: Post[],
  comentarios: ComentarioLeve[],
  keywordsNormalizadas: string[]
): PerfilAnalise[] {
  const by: Record<string, PerfilAnalise> = {};
  /** url do post relevante → autor, para atribuir cada comentário. */
  const donoDoPost = new Map<string, string>();

  for (const p of posts) {
    const autor = (p.autor || "").trim();
    if (!autor) continue;
    const e = (by[autor] ??= {
      autor,
      categoria: p.categoria || "",
      posts: 0,
      postsGestao: 0,
      comentarios: 0,
      contra: 0,
      favor: 0,
      indefinido: 0,
      pctContra: 0,
      saldo: 0,
    });
    e.posts += 1;
    if (!e.categoria && p.categoria) e.categoria = p.categoria;
    if (casaRelevancia(p, keywordsNormalizadas)) {
      e.postsGestao += 1;
      const url = (p.url || "").trim();
      if (url) donoDoPost.set(url, autor);
    }
  }

  for (const c of comentarios) {
    const autor = donoDoPost.get(c.urlPost);
    if (!autor) continue;
    const e = by[autor];
    if (!e) continue;
    e.comentarios += 1;
    if (c.sentimento === "negativo") e.contra += 1;
    else if (c.sentimento === "positivo") e.favor += 1;
    else e.indefinido += 1;
  }

  return Object.values(by)
    .map((e) => {
      const lado = e.contra + e.favor;
      return {
        ...e,
        pctContra: lado ? Math.round((e.contra / lado) * 100) : 0,
        saldo: e.favor - e.contra,
      };
    })
    .sort((a, b) => b.postsGestao - a.postsGestao || b.comentarios - a.comentarios);
}

/** Extremos de um ranking: quem lidera e quem fica na ponta oposta. */
export interface Extremos {
  maior: PerfilAnalise | null;
  menor: PerfilAnalise | null;
}

/**
 * Pega o maior e o menor de uma métrica entre os perfis elegíveis. `elegivel`
 * existe porque "quem menos" só faz sentido entre quem participa: um perfil
 * sem nenhuma publicação sobre a gestão não é "o que menos critica", é um
 * perfil fora do assunto.
 */
export function extremos(
  perfis: PerfilAnalise[],
  metrica: (p: PerfilAnalise) => number,
  elegivel: (p: PerfilAnalise) => boolean
): Extremos {
  const aptos = perfis.filter(elegivel);
  if (aptos.length === 0) return { maior: null, menor: null };
  const ordenado = [...aptos].sort((a, b) => metrica(b) - metrica(a));
  return {
    maior: ordenado[0] ?? null,
    menor: ordenado.length > 1 ? ordenado[ordenado.length - 1] : null,
  };
}
