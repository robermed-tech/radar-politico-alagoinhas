/**
 * Match das palavras cadastradas na tela Relevância contra o texto de um post.
 *
 * Espelha o que o `agora.py::_motivo_relevancia` faz na origem, e pelos mesmos
 * motivos:
 *
 *   • **Match por substring, não por palavra inteira.** `@prefeituraalagoinhas`
 *     e `@gustavoascarmo` vêm colados na menção e são o sinal mais forte de que
 *     o post é daqui. Trocar por palavra inteira já quebrou isso uma vez.
 *   • **Sem acento e em minúscula dos dois lados.** O cliente cadastra "gestao"
 *     e "gestão"; o texto do Instagram traz as duas grafias.
 *
 * A lista é do cliente: nada é acrescentado, removido ou "melhorado" aqui.
 * Quando não há nenhuma palavra ativa cadastrada, `casaRelevancia` devolve
 * `true` para tudo — a tela mostra o agregado inteiro e avisa que o recorte
 * não está configurado, em vez de exibir zero sem explicação.
 */
import type { Post } from "@/lib/data";

/** minúscula + sem acento — mesma normalização dos dois lados do match. */
export function normalizar(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Palavras ativas, normalizadas e sem vazios/duplicatas. */
export function prepararKeywords(keywords: { keyword: string; active: boolean }[]): string[] {
  const set = new Set<string>();
  for (const k of keywords) {
    if (!k.active) continue;
    const n = normalizar(k.keyword).trim();
    if (n) set.add(n);
  }
  return [...set];
}

/**
 * Texto do post que entra no match: legenda original primeiro (é o que a
 * pessoa escreveu), com o resumo da IA e as sínteses de queixa/elogio como
 * rede de segurança para posts sem legenda capturada.
 */
export function textoDoPost(p: Post): string {
  return [p.caption, p.resumo, p.queixa_dominante, p.elogio_dominante]
    .filter(Boolean)
    .join(" ");
}

/** O post cita alguma das palavras cadastradas? */
export function casaRelevancia(p: Post, keywordsNormalizadas: string[]): boolean {
  if (keywordsNormalizadas.length === 0) return true;
  const texto = normalizar(textoDoPost(p));
  if (!texto) return false;
  return keywordsNormalizadas.some((k) => texto.includes(k));
}

/** Quais palavras cadastradas o post cita — usado para explicar o recorte. */
export function keywordsDoPost(p: Post, keywordsNormalizadas: string[]): string[] {
  const texto = normalizar(textoDoPost(p));
  return keywordsNormalizadas.filter((k) => texto.includes(k));
}
