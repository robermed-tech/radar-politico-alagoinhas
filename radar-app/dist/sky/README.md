# Imagens de céu do hero do Clima Político

As 6 imagens estão otimizadas em `.webp` (geradas a partir dos `.jpg` enviados,
~98% menores: 12 MB → 236 KB). Para trocar uma foto: substitua o `.webp`
correspondente (largura ~1600px, qualidade 80). Cada uma corresponde a um clima:

| Arquivo        | Imagem enviada                              | Quando aparece (IAD) |
|----------------|---------------------------------------------|----------------------|
| `sunny.jpg`    | Céu azul com nuvens brancas fofas           | 75-100 (Céu Aberto)  |
| `partly.jpg`   | Céu dramático azul com nuvens e sol furando | 60-74 (Parc. Nublado)|
| `cloudy.jpg`   | Céu totalmente encoberto, cinza uniforme    | 45-59 (Nublado)      |
| `rain.jpg`     | Chuva caindo das nuvens (riscos de chuva)   | 30-44 (Chuva)        |
| `storm.jpg`    | Tempestade em espiral com raio              | 15-29 (Tempestade)   |
| `severe.jpg`   | Tempestade com raio (a mais dramática)      | 0-14 (Severíssimo)   |

> `severe.jpg` pode ser uma cópia de `storm.jpg` (a foto do raio) — ou outra
> mais escura, se preferir.

## Como salvar (passo a passo)
1. Abra esta pasta no Explorer:
   `C:\Users\rober\radar-politico\radar-app\public\sky\`
2. Salve cada imagem com o nome da tabela acima.
3. Rode o deploy do app novo (radar-app\deploy.bat) ou peça para eu publicar.

## Dicas
- Formato `.jpg` (ou troque a extensão no weather.ts se usar `.webp`/`.png`).
- Ideal: até ~400 KB cada (a foto fica atrás de um overlay escuro, não precisa
  de altíssima resolução). Largura ~1600px é suficiente.
- Se algum arquivo faltar, o hero usa automaticamente o gradiente de cor
  daquele clima (não quebra).
