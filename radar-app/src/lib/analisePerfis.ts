/**
 * Análise por perfil sob o critério da tela Relevância (pedido de 27/07).
 *
 * O recorte deixou de ser "todos os posts do perfil" e passou a ser "os posts
 * do perfil que citam as palavras cadastradas em Relevância" — as mesmas
 * palavras que o `agora.py` usa para decidir o que entra na base. Sem isso, o
 * perfil de um veículo local aparecia com dezenas de publicações, das quais
 * boa parte não falava de prefeito, prefeitura ou gestão.
 *
 * ## Os dois eixos, e por que são dois campos diferentes
 *
 * **O que o perfil FAZ** vem de `posts.tom_publicacao` (migration 010): o tom
 * da própria publicação sobre a gestão, classificado a partir do texto
 * publicado, sem olhar para os comentários.
 *
 * **O que o perfil RECEBE** vem dos comentários de cidadãos nessas
 * publicações, com os mesmos critérios que formam o clima (lib/sentimento.ts).
 *
 * `posts.sentimento_post` não entra em nenhum dos dois: ele é, pelo próprio
 * prompt do agora.py, "o IMPACTO na imagem do prefeito pela REAÇÃO dos
 * comentários, NÃO o tom da caption". Usá-lo como fala do perfil faria um post
 * elogioso da prefeitura que tomou uma enxurrada de críticas ser contabilizado
 * como uma crítica feita pela prefeitura contra ela mesma.
 *
 * Publicação com `confianca_tom` abaixo de `CONFIANCA_MIN_TOM` conta no total
 * mas não entra em nenhum dos lados, mesma política da confiança dos
 * comentários: quando o classificador declarou que não decidiu, contar como
 * certeza infla o lado maior.
 */
import type { ComentarioLeve, Post } from "@/lib/data";
import { casaRelevancia } from "@/lib/relevancia";

/**
 * Confiança mínima para o tom de uma publicação contar como crítica ou elogio.
 * Gêmeo de `CONFIANCA_MIN_TOM` no agora.py: se mudar aqui, mude lá.
 *
 * AO MEXER, rodar `python agora.py --teste-tom` antes e ver quantas publicações
 * saem de cada lado com o corte novo: o valor certo vem da distribuição de
 * confiança na base, não de arredondar para um número redondo.
 */
export const CONFIANCA_MIN_TOM = 60;

export function tomConfiavel(p: Pick<Post, "tom_publicacao" | "confianca_tom">): boolean {
  if (p.tom_publicacao === "nao_classificado") return false;
  const c = Number(p.confianca_tom ?? 0);
  // Confiança 0 vem de post anterior ao campo: a confiança nunca foi medida,
  // então o valor é mantido em vez de reprovado à toa (mesma regra de
  // sentimentoConfiavel para comentários).
  return c === 0 || c >= CONFIANCA_MIN_TOM;
}

export interface PerfilAnalise {
  autor: string;
  categoria: string;
  /** Publicações do perfil no período. */
  posts: number;
  /** Quantas delas citam as palavras cadastradas em Relevância. */
  postsGestao: number;
  /** Publicações do perfil que criticam a gestão (tom_publicacao). */
  fazCritica: number;
  /** Publicações do perfil que elogiam ou defendem a gestão. */
  fazElogio: number;
  /** Publicações sobre a gestão sem juízo, ou com confiança baixa demais. */
  fazNeutro: number;
  /** % de críticas entre as publicações que tomam partido (neutras fora). */
  pctFazCritica: number;
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
 *  disso "quem tem menos críticas" seria só quem teve dois comentários.
 *
 *  AO MEXER, contar antes quantos perfis da base sobrevivem ao piso novo: um
 *  ranking que exclui quase todo mundo mente tanto quanto um que aceita quem
 *  teve dois comentários. */
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
      fazCritica: 0,
      fazElogio: 0,
      fazNeutro: 0,
      pctFazCritica: 0,
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
      // Tom sem confiança suficiente cai em "neutro" da contagem, e não num
      // dos lados: a publicação existiu, mas o classificador não decidiu.
      if (!tomConfiavel(p)) e.fazNeutro += 1;
      else if (p.tom_publicacao === "critico") e.fazCritica += 1;
      else if (p.tom_publicacao === "favoravel") e.fazElogio += 1;
      else e.fazNeutro += 1;
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
      const ladoFaz = e.fazCritica + e.fazElogio;
      return {
        ...e,
        pctContra: lado ? Math.round((e.contra / lado) * 100) : 0,
        pctFazCritica: ladoFaz ? Math.round((e.fazCritica / ladoFaz) * 100) : 0,
        saldo: e.favor - e.contra,
      };
    })
    .sort(
      (a, b) =>
        b.fazCritica + b.fazElogio - (a.fazCritica + a.fazElogio) ||
        b.postsGestao - a.postsGestao
    );
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
