# Radar Político — Roadmap Frontend + SaaS: Design Spec

**Data:** 2026-06-25  
**Status:** Aprovado  
**Escopo:** 3 sprints sequenciais — Frontend Demo → Features Críticas → Infra SaaS  
**Usuário primário:** Secretário de comunicação / assessor de imprensa  
**Contexto:** Produto evoluindo de projeto interno (Alagoinhas/BA) para SaaS vendável a prefeituras brasileiras. Sem concorrente direto no nicho municipal brasileiro com IA de crise.

---

## Diagnóstico Competitivo

Concorrentes globais (Brandwatch, Meltwater, Zignal Labs, Stilingue) existem mas nenhum atende o nicho municipal brasileiro com:
- Análise nativa em PT-BR via LLM
- Framework SCCT de crise integrado
- IAD (índice proprietário de aprovação digital)
- Preço acessível a prefeituras de médio porte (R$800–2.000/mês)

O Radar compete indiretamente com clipping genérico e assessorias de imprensa. Na maioria das prefeituras-alvo, o produto seria o **primeiro sistema de monitoramento** — baseline inexistente.

**Gaps identificados vs concorrentes:**
- 🔴 Críticos: alertas push por limiar, comparação de períodos, export PDF, multi-tenant
- 🟡 Importantes: feed de menções, mobile PWA, nuvem de keywords
- 🟢 Diferenciais únicos a preservar: IAD, SCCT, briefing WhatsApp, PT-BR nativo

**Custo por município/mês:** ~R$185–310 (Apify + Claude Haiku/Sonnet + Supabase).  
**Margem bruta estimada:** ~80% a R$1.500/mês. Potencial de mercado: 5.570 municípios no Brasil.

---

## Sprint 1 — Frontend Demo (2–3 semanas)

**Objetivo:** fortalecer a demo para secretários. Nenhuma mudança no backend.

### 1.1 Deltas nos KPIs

Cada card de indicador (IAD, Positivo, Negativo) ganha uma linha de comparação automática vs o período anterior de mesmo comprimento.

**Comportamento:**
- Período 7 dias selecionado → compara com os 7 dias anteriores
- Delta positivo em IAD = verde (melhora); negativo = vermelho (piora)
- Para Negativo, delta invertido: subir é ruim (vermelho), cair é bom (verde)
- Formato: `↑ +4 pp vs semana passada` / `↓ −4 pp vs semana passada` / `= igual`
- Se não houver dados no período anterior, delta fica oculto (sem erro)

**Implementação:**
- `lib/indices.ts` — `calcIndices()` passa a receber dois arrays: `postsAtual` e `postsAnterior`
- `lib/data.ts` — `filtrarPorPeriodo()` ganha variante que retorna dois períodos consecutivos
- `CommandCenter.tsx` — lê `view.delta` e renderiza linha abaixo de cada KPI value
- Zero nova coleta; dados já estão no Supabase

**Arquivos modificados:** `CommandCenter.tsx`, `lib/indices.ts`, `lib/data.ts`

### 1.2 Feed de Menções

Nova aba "Feed" na navegação principal com lista cronológica dos posts coletados.

**Conteúdo de cada item:**
- Avatar (inicial do perfil ou emoji de categoria: 📰 imprensa, 🏛 prefeitura, 👤 oposição)
- Nome do perfil (`@handle`)
- Texto truncado do post (140 chars com reticências)
- Chips: sentimento (verde/vermelho/azul), tema (roxo), urgência se aplicável (laranja)
- Timestamp relativo ("há 2h", "ontem")

**Filtros:** todos / positivos / negativos / urgentes (toggle no topo)

**Implementação:**
- Nova página `FeedPage.tsx` — lista os posts da query `["radar"]` já em cache, sem nova request
- `App.tsx` — adicionar rota `/feed` e tab "Feed" na navegação
- `components/PostChips.tsx` — componente de chips reutilizável (também usado no Sprint 2)

**Arquivos novos:** `FeedPage.tsx`, `components/PostChips.tsx`  
**Arquivos modificados:** `App.tsx`

### 1.3 Mobile PWA

Corrigir layout responsivo e habilitar instalação como app no celular.

**Mudanças de layout:**
- Telas <400px: grids colapsam para 1 coluna, fontes dos KPIs reduzem para `text-4xl`
- Navegação: scroll horizontal nos tabs (já existe) revisado para funcionar bem no Safari/iOS
- Botões e chips com `min-height: 44px` para toque preciso

**PWA:**
- `public/manifest.json` — nome "Radar Político", ícones 192×192 e 512×512 (SVG escalado), `display: standalone`, `theme_color: #0d1117`
- `index.html` — `<link rel="manifest">` e meta `apple-mobile-web-app-capable`
- Sem service worker por ora (dados em tempo real tornam cache offline problemático)

**Arquivos novos:** `public/manifest.json`, `public/icons/icon-192.png`, `public/icons/icon-512.png`  
**Arquivos modificados:** `index.html`, `App.tsx` (breakpoints), `CommandCenter.tsx` (breakpoints)

**Critério de sucesso Sprint 1:** secretário abre o dashboard, vê em <10s se IAD melhorou ou piorou vs semana passada, consegue rolar o feed de posts no celular e instalar como app.

---

## Sprint 2 — Features Críticas (3–4 semanas)

**Objetivo:** fechar os gaps críticos vs concorrentes para tornar o produto defensável em demo comparativa.

### 2.1 Alertas por Limiar

Sistema de notificação automática quando indicadores ultrapassam thresholds configurados pelo usuário.

**Gatilhos disponíveis:**
| Gatilho | Condição padrão | Canal |
|---------|----------------|-------|
| IAD abaixo do limiar | IAD < 40% | WhatsApp + Email |
| Negativos disparam | % negativo > 60% | WhatsApp |
| Tema entra em crise | tema com pNeg > limiar "Alto" | WhatsApp |

**Configuração:** nova aba "Alertas" nas Configurações do dashboard. Secretário ajusta limiares via sliders e ativa/desativa por toggle. Configuração salva na tabela `alerta_config` do Supabase.

**Pipeline (backend):**
- Ao final de cada execução, `agora.py` chama `verificar_alertas(tenant_id, ind)` 
- Função lê `alerta_config` do tenant, compara com índices calculados
- Se threshold ultrapassado: chama Evolution API (WhatsApp já integrado) e/ou SMTP
- Salva ocorrência em `alerta_historico` com timestamp, tipo, valor e canal

**Recuperação:** quando indicador volta ao normal, envia alerta de "recuperação" (configurável).

**Novas tabelas Supabase:**
```sql
alerta_config (tenant_id, tipo, limiar, canal_whats, canal_email, ativo)
alerta_historico (id, tenant_id, tipo, valor, mensagem, canal, criado_em)
```

**Arquivos novos:** `SettingsPage.tsx`, `components/AlertaConfig.tsx`  
**Arquivos modificados:** `agora.py` (função `verificar_alertas`), `App.tsx` (rota settings)

### 2.2 Export PDF

Botão "Exportar Relatório" que gera um briefing A4 para reuniões de secretaria.

**Conteúdo do PDF:**
- Cabeçalho: logo Radar Político, município, data, período
- 3 KPI cards: IAD com delta, % Positivo com delta, % Negativo com delta
- Tabela de temas em atenção com barra de progresso de % negativo
- Até 3 comentários em destaque (os de maior engajamento com sentimento negativo)
- Rodapé: "Gerado pelo Radar Político · Não substitui pesquisa eleitoral"

**Implementação:**
- `CommandCenter.tsx` — botão "⬇ Exportar Relatório" acima dos KPIs
- `styles/print.css` — folha `@media print` que: oculta navegação, filtros e gráficos; formata a página como A4; ajusta cores para fundo branco
- Fluxo: `onClick` → `window.print()` → navegador abre diálogo de impressão/salvar PDF
- Upgrade futuro (Sprint 4+): `html2canvas` + `jsPDF` para PDF sem diálogo do sistema

**Arquivos novos:** `styles/print.css`  
**Arquivos modificados:** `CommandCenter.tsx`, `index.html` (link para print.css)

### 2.3 Nuvem de Keywords

Visualização das palavras mais frequentes nos comentários coletados, coloridas pelo sentimento dominante do contexto em que aparecem.

**Pipeline (backend):**
- Novo passo em `agora.py`: após gravar posts, contar frequência de tokens em `comentario_texto`
- Stopwords PT-BR: lista local (~200 palavras), sem dependência externa
- Para cada token, calcular sentimento dominante (positivo/negativo/neutro) dos posts que o contêm
- Salvar top 100 tokens em `keywords_dia (tenant_id, data, palavra, contagem, sentimento_dom)`

**Frontend:**
- `wordcloud2.js` (2KB, CDN ou bundle) renderiza num `<canvas>`
- Tamanho proporcional à contagem, cor pelo `sentimento_dom`
- Tabela lateral: top 5 negativos e top 5 positivos por contagem
- Integrado na página `TrendsPage.tsx` como nova seção abaixo do gráfico existente

**Nova tabela Supabase:** `keywords_dia (tenant_id, data, palavra, contagem, sentimento_dom)`

**Arquivos modificados:** `agora.py`, `TrendsPage.tsx`  
**Arquivos novos:** nenhum (wordcloud2 via CDN)

**Critério de sucesso Sprint 2:** secretário recebe WhatsApp quando IAD cai, consegue imprimir um relatório para a reunião de segunda-feira, e vê quais palavras a cidade mais associa ao prefeito.

---

## Sprint 3 — Infra SaaS (3–4 semanas)

**Objetivo:** habilitar múltiplos clientes simultâneos sem tocar em código por novo cliente. Onboarding completo em 30 minutos.

### 3.1 Autenticação (Supabase Auth + Magic Link)

Tela de login substitui o fluxo atual de "Conectar fonte de dados" (ConfigUrl).

**Fluxo:**
1. Usuário acessa o dashboard → redireciona para `/login` se não autenticado
2. Digita email institucional → clica "Receber link de acesso"
3. Supabase Auth envia magic link com expiração de 15 minutos
4. Clique no link → sessão criada → dashboard carrega dados do tenant automaticamente
5. Sessão persiste 7 dias; renovação transparente

**Vinculação tenant:** tabela `tenants_users (user_id, tenant_id)`. Após login, `auth.uid()` é resolvido para `tenant_id` via função RPC `get_user_tenant(uid)`.

**Proteção de rotas:** `ProtectedRoute` wrapper que verifica `supabase.auth.getSession()` antes de renderizar qualquer página.

**Arquivos novos:** `pages/LoginPage.tsx`, `components/ProtectedRoute.tsx`, `lib/auth.ts`  
**Arquivos modificados:** `App.tsx` (wrapping de rotas), `lib/data.ts` (passar tenant_id em todas as queries)

### 3.2 Pipeline Multi-Tenant (VPS + Cron)

**Mudança em `agora.py`:**
```python
# Antes: hardcoded para Alagoinhas
# Depois: itera por todos os tenants ativos
tenants = supabase.table("tenants").select("*").eq("ativo", True).execute()
for tenant in tenants.data:
    processar_tenant(tenant)
```

Cada tenant tem na tabela `tenants`:
- `tenant_id`, `municipio`, `estado`
- `perfis_json` — lista de perfis Instagram a monitorar (substitui `clientes/alagoinhas.json`)
- `apify_token` — token Apify do tenant (ou token compartilhado do admin)
- `whatsapp_destinatarios` — lista de números para briefing e alertas
- `ativo`, `plano` (mensal/anual/trial)

**Hospedagem:**
- VPS Ubuntu 22.04 — DigitalOcean Droplet 1GB RAM (USD 6/mês)
- `crontab`: `0 8,14,19 * * * cd /opt/radar && python agora.py >> logs/agora.log 2>&1`
- Logs rotacionados por `logrotate`

**Arquivos modificados:** `agora.py` (loop multi-tenant, leitura de config do Supabase)  
**Nova tabela Supabase:** `tenants (tenant_id, municipio, estado, perfis_json, apify_token, whatsapp_destinatarios, ativo, plano, criado_em)`

### 3.3 Isolamento Multi-Tenant (RLS)

Todas as tabelas existentes ganham coluna `tenant_id TEXT NOT NULL`. RLS habilitado em todas.

**Tabelas afetadas:** `posts`, `narrativas`, `influenciadores`, `temas_diarios`, `keywords_dia`, `alerta_config`, `alerta_historico`

**Policy padrão (replicada em todas as tabelas):**
```sql
CREATE POLICY "tenant_isolation" ON posts
  FOR ALL USING (tenant_id = get_user_tenant(auth.uid()));
```

**Migração de dados existentes (Alagoinhas):**
```sql
UPDATE posts SET tenant_id = 'ten_alagoinhas' WHERE tenant_id IS NULL;
```

**Frontend:** `lib/data.ts` remove `VITE_TENANT` hardcoded; tenant_id passa a vir de `supabase.auth.getUser()` resolvido via RPC.

**Fluxo de onboarding pós-Sprint 3:**
1. Contrato assinado → inserir linha em `tenants` (5 min)
2. Preencher `perfis_json` com handles do Instagram (10 min)
3. Rodar `agora.py --tenant ten_novo` para validar (15 min)
4. Cadastrar email do secretário no Supabase Auth vinculado ao tenant (2 min)
5. Pipeline automático assume na próxima janela de coleta

**Critério de sucesso Sprint 3:** adicionar novo município em 30 minutos sem tocar em código. Dois secretários de municípios diferentes podem fazer login simultâneo e ver apenas os dados do próprio município.

---

## Resumo de Arquivos por Sprint

### Sprint 1
| Arquivo | Ação |
|---------|------|
| `radar-app/src/pages/FeedPage.tsx` | Criar |
| `radar-app/src/components/PostChips.tsx` | Criar |
| `radar-app/public/manifest.json` | Criar |
| `radar-app/public/icons/icon-192.png` | Criar |
| `radar-app/public/icons/icon-512.png` | Criar |
| `radar-app/index.html` | Modificar (manifest link) |
| `radar-app/src/App.tsx` | Modificar (rota Feed, breakpoints) |
| `radar-app/src/pages/CommandCenter.tsx` | Modificar (deltas nos KPIs) |
| `radar-app/src/lib/indices.ts` | Modificar (calcIndices com período anterior) |
| `radar-app/src/lib/data.ts` | Modificar (dois períodos consecutivos) |

### Sprint 2
| Arquivo | Ação |
|---------|------|
| `radar-app/src/pages/SettingsPage.tsx` | Criar |
| `radar-app/src/components/AlertaConfig.tsx` | Criar |
| `radar-app/src/styles/print.css` | Criar |
| `agora.py` | Modificar (verificar_alertas, keywords) |
| `radar-app/src/pages/CommandCenter.tsx` | Modificar (botão export) |
| `radar-app/src/pages/TrendsPage.tsx` | Modificar (word cloud) |
| `radar-app/src/App.tsx` | Modificar (rota settings) |
| `radar-app/index.html` | Modificar (link print.css, wordcloud2 CDN) |

### Sprint 3
| Arquivo | Ação |
|---------|------|
| `radar-app/src/pages/LoginPage.tsx` | Criar |
| `radar-app/src/components/ProtectedRoute.tsx` | Criar |
| `radar-app/src/lib/auth.ts` | Criar |
| `agora.py` | Modificar (loop multi-tenant) |
| `radar-app/src/App.tsx` | Modificar (ProtectedRoute wrapping) |
| `radar-app/src/lib/data.ts` | Modificar (tenant_id dinâmico) |

---

## Novas Tabelas Supabase (acumulativo)

| Tabela | Sprint | Propósito |
|--------|--------|-----------|
| `alerta_config` | 2 | Limiares configurados por tenant |
| `alerta_historico` | 2 | Log de alertas disparados |
| `keywords_dia` | 2 | Top keywords por dia por tenant |
| `tenants` | 3 | Config e status de cada município-cliente |
| `tenants_users` | 3 | Vínculo usuário ↔ tenant |

---

## Decisões Técnicas

- **Magic link vs senha:** magic link escolhido pela simplicidade para secretários não-técnicos
- **VPS vs GitHub Actions:** VPS preferido para pipeline — mais confiável, sem limite de minutos, suporta múltiplos tenants em série
- **window.print() vs jsPDF:** `window.print()` para MVP; `jsPDF` como upgrade futuro quando houver demanda por PDF programático
- **wordcloud2.js vs D3-cloud:** wordcloud2 por ser mais leve e sem dependências — suficiente para o caso de uso
- **Service Worker:** explicitamente excluído neste roadmap — dados em tempo real tornam estratégia de cache offline arriscada para v1
