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

## Divergências com o app

**Nenhuma em 04/09/26.** O canvas volta a ser retrato do `App.tsx`, e não
proposta pendente. A rodada daquele dia fechou assim:

| O que | Onde nasceu | Desfecho |
| ----- | ----------- | -------- |
| Wordmark 34px (era 30) | canvas | aplicado no app |
| Rótulos em 400, aceso em 600 (eram 800) | canvas | aplicado no app |
| Rodapé em 600 (a prancheta escura tinha 400) | conferência | corrigido no canvas |
| Marca empurrada 16px, 17px na escura | edição em tela | removido do canvas |

Os dois últimos eram ajuste de mão, não medida escolhida: os valores diferiam
entre as duas pranchetas, e no app cada um deles é um componente só, renderizado
nos dois temas. Divergência entre as pranchetas se resolve aqui, não em código.

Quando o canvas voltar a andar na frente do app, é esta seção que registra o
que está pendente.

## Regras que a réplica carrega

- A wordmark recebe a cor pelo contêiner (`var(--brand)`), nunca pela classe
  `.text-brand` — ela resolve por `--brand-text`, escuro no tema claro.
- Tinta sobre o teal é `#04242F`, nunca branco (branco mede 2,08:1 e reprova o
  AA; a tinta escura mede 7,77:1).
- Marca sozinha: sem tagline e sem anel de varredura, decisão de 26/08.

O canvas **não escreve no app** — é onde se propõe a mudança; o que sair dele
vira pedido de edição em `App.tsx`.
