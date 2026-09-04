# Canvas da barra lateral (Viratempo)

Fontes do canvas de design da barra lateral, publicado em
<https://claude.ai/code/artifact/4f024796-989e-4815-b839-f532b1643d43>.

Cada `.dc.html` é uma prancheta (Design Component); `canvas.json` posiciona as
três no plano e carrega as notas. O arquivo publicado (~2 MB, o editor inteiro
embutido) **não** entra no repo: ele é regerado a partir destes fontes pela
ferramenta `/design` do Claude Code.

| Arquivo             | O que é                                        |
| ------------------- | ---------------------------------------------- |
| `Main.dc.html`      | Barra lateral, tema claro (a entrada do canvas) |
| `Escura.dc.html`    | A mesma barra no tema escuro                   |
| `NavMobile.dc.html` | A faixa de navegação do celular, nos dois temas |
| `canvas.json`       | Posição das pranchetas, notas e vista de abertura |

## O que está reproduzido

Base: o que `radar-app/src/App.tsx` renderiza sobre os tokens de
`radar-app/src/index.css` — `aside` de 224px (`w-56`) com `p-3`, itens com
`gap-1.5` e `tracking-wide`, pílula ativa em `var(--brand)` com o `NAV_GLOW` e
tinta `#04242F`, wordmark de 34px em teal pelo `currentColor` do contêiner. É a
vista de **admin** (13 itens); usuário comum vê 10, sem Divisão da Conversa,
Rádio Escuta e Configuração.

As pranchetas da lateral têm 1120px de altura de propósito: na coluna de 224px
os rótulos longos quebram em duas linhas, e uma moldura de 960px cortava o
rodapé com o Sair e o carimbo de atualização.

## O que ainda diverge do app

O canvas é editado direto na tela, então ele anda na frente do `App.tsx`. Duas
coisas que saíram daqui **já foram aplicadas** ao app: a wordmark de 34px e o
peso dos rótulos (400 no item comum, 600 no aceso). O que sobra de diferença:

- **Posição da wordmark**: as pranchetas empurram a marca 16px (17 no escuro)
  para baixo por `position: relative`; no app ela encosta no topo do contêiner
  `mb-6 px-2`. Os dois valores diferentes entre claro e escuro sugerem ajuste
  de mão na tela, não medida escolhida.
- **Peso da linha do usuário no rodapé**: 600 na prancheta clara e 400 na
  escura. No app é um componente só, renderizado nos dois temas, então esse par
  é impossível de reproduzir — a divergência entre as duas pranchetas é que
  precisa ser resolvida antes de virar pedido.

## Regras que a réplica carrega

- A wordmark recebe a cor pelo contêiner (`var(--brand)`), nunca pela classe
  `.text-brand` — ela resolve por `--brand-text`, escuro no tema claro.
- Tinta sobre o teal é `#04242F`, nunca branco (branco mede 2,08:1 e reprova o
  AA; a tinta escura mede 7,77:1).
- Marca sozinha: sem tagline e sem anel de varredura, decisão de 26/08.

O canvas **não escreve no app** — é onde se propõe a mudança; o que sair dele
vira pedido de edição em `App.tsx`.
