/**
 * Superfície dos cards escuros da Rádio Escuta.
 *
 * Existia só dentro do `GravarAgora`. Quando o cliente pediu o card "Rádios
 * monitoradas" com o MESMO layout do "Gravar agora" (30/07), copiar as
 * constantes para o segundo arquivo criaria duas receitas que só ficam iguais
 * enquanto ninguém mexe numa delas — o mesmo tipo de divergência que o
 * `PeriodoFilter` e o `ComentarioBox` já resolveram virando componente único.
 * "Igual" aqui quer dizer o mesmo degradê, as mesmas superfícies internas e a
 * mesma tinta, não um parecido.
 *
 * Os valores vêm medidos: tinta quase preta sobre `var(--brand)` mede 8,44:1;
 * as superfícies internas são quase sólidas de propósito, porque o degradê
 * chumbo por baixo varia demais para um alpha baixo compensar.
 */

/** Degradê chumbo→quase-preto: o mesmo do radar de coleta e do painel da antena. */
export const FUNDO_ESCUTA = "linear-gradient(165deg, #475569 0%, #0F172A 100%)";
/**
 * Laranja da marca, chapado. Até 31/07 era um degradê de dois tons — a mesma
 * receita do antigo card "Engajamento no período". Com `--brand` virando um
 * hex único nos dois temas (revisão de 31/07, pedido do cliente para não
 * haver diferença de tom entre botões), o degradê deixou de ter função: ele
 * mesmo introduzia variação de tom dentro de um único botão. Preenchimento
 * chapado com `var(--brand)` garante que este botão case, pixel a pixel, com
 * qualquer outro botão de marca do painel.
 */
export const FUNDO_LARANJA = "var(--brand)";
/** Tinta sobre o laranja. Sólida, nunca preto com alpha: o alpha passa numa
 *  ponta do degradê e reprova na outra. */
export const TINTA_PRETA = "#1A0F02";
export const TINTA_CLARA = "#F8FAFC";
export const TINTA_CLARA_2 = "#CBD5E1";
/** Caixa interna (lista, formulário) sobre o degradê. */
export const FUNDO_LISTA = "rgba(2,6,23,0.55)";
/** Item/campo dentro da caixa interna. */
export const FUNDO_ITEM = "rgba(2,6,23,0.72)";
export const BORDA = "1px solid rgba(148,163,184,0.30)";
/** Sombra de assentamento comum aos dois cards. */
export const SOMBRA = "0 18px 40px -18px rgba(15,23,42,0.65)";
/** Altura mínima da linha de topo — mantém a proporção quadrada do "Gravar
 *  agora" mesmo com o cadastro vazio. */
export const ALTURA_MIN = 340;
/**
 * Teto da linha de topo, aplicado aos DOIS cards escuros.
 *
 * Existe porque as listas crescem com o cadastro. Os dois cards já diziam, em
 * comentário, que a lista rola por dentro "para o card não crescer com o número
 * de estações" — mas `flex-1` sem teto não faz isso: com quatro rádios a linha
 * já ia a 565px e empurrava indicadores e pautas para fora da dobra, que é
 * justamente o defeito que tirou o "Gravar agora" da faixa de largura cheia.
 *
 * O valor é o mesmo nos dois de propósito: com tetos diferentes, o card mais
 * baixo sobra uma faixa vazia embaixo, porque o grid dimensiona a linha pelo
 * item mais alto. 470px é a altura que a linha tinha com as quatro estações
 * cadastradas hoje — o desenho que o cliente aprovou.
 */
export const ALTURA_MAX = 470;
