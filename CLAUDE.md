# Radar Político Alagoinhas — instruções para Claude Code

Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão neste repositório. Ele existe para reduzir o número de idas e voltas com o Robério durante depuração.

## Contexto do projeto (resumo)

- Sistema de monitoramento político via Instagram para a SECOM de Alagoinhas/BA (prefeito Gustavo Carmo).
- Pipeline ativo: Apify (scraping) → `agora.py` (Python) → Claude Haiku API → Google Sheets (abas Radar/Perfis) + Supabase (dual-write) → dashboard HTML + Radar Comando (Vite/React).
- **`agora.py` é o agente ativo.** `radar_agente.py` está descontinuado — nunca editar esse arquivo.
- GitHub Actions (`radar.yml`) roda o pipeline 2x/dia (06h e 17h BRT) para poupar créditos Apify.
- Frontend admin: `radar-comando.surge.sh` (Supabase, projeto `radar-politico`, tenant `alagoinhas`).
- **Pendência conhecida**: pesos de score e limiares de clima estão hardcoded em `agora.py`. A UI do admin só terá efeito real quando o backend passar a ler de `tenant_settings` no Supabase.

## Protocolo de depuração autônoma

Ao investigar um bug, siga esta ordem sem esperar aprovação a cada passo:

1. **Formule uma hipótese antes de editar código.** Se a causa não está clara, adicione instrumentação (log) primeiro — não altere lógica "no escuro".
2. **Rode você mesmo.** Execute `python agora.py` (ou a flag relevante) e leia o output diretamente. Não peça para o Robério colar prints a menos que o comando dependa de algo que só ele tem acesso (ex: conta do Google, WhatsApp, aprovação visual do dashboard).
3. **Isole antes de tocar produção.** Use ou crie uma flag de teste (`--teste-filtro`, `--reprocessar` ou similar) em vez de rodar contra o pipeline de produção ou gastar créditos Apify desnecessariamente. Se não existir uma flag adequada para o teste que você precisa fazer, crie uma.
4. **Descarte hipóteses uma a uma.** Se o log esperado não aparecer, isso já é informação — não repita o mesmo teste, ajuste a hipótese (ex: o pipeline pode estar saindo antes mesmo de chegar na etapa que você está logando, como aconteceu com a deduplicação mascarando o bug do filtro de relevância).
5. **Depois de confirmar a causa raiz, limpe.** Remova logs de debug temporários ou coloque-os atrás de uma flag `--debug` — não deixe `print()` soltos no código de produção.
6. **Reporte de forma concisa**: o que quebrou, por que, o que foi mudado. Sem narrar todo o processo de tentativa e erro.

## Quando escalar para o Robério

Só pare e pergunte quando:
- A correção exige uma decisão de produto (ex: qual deve ser o comportamento correto, não só o bug técnico).
- Falta uma credencial, secret ou acesso que você não tem.
- O teste isolado já confirma o fix, mas rodar contra produção vai consumir créditos Apify de forma não trivial — aí sim, confirme antes de rodar contra produção real.

Fora isso, resolva e implemente diretamente, sem pausar para aprovação passo a passo.

## Referências

- Pegadinhas de ambiente conhecidas: ver `GOTCHAS.md` neste mesmo diretório.
- Spec de arquitetura do admin: `2026-06-28-radar-comando-admin-rbac-design.md`.
