# Avaz — Guia de Multi-Tenant (transformar em SaaS)

> Passo a passo para evoluir de **1 cliente (Alagoinhas)** para **plataforma que
> serve vários gabinetes pagantes**, com dados isolados e seguros.
> Mesma filosofia do projeto: **incremental e com risco zero** — cada fase é
> independente e o sistema atual continua funcionando o tempo todo.

---

## Princípio: o que já está pronto

Quando montamos o Postgres, todas as tabelas já nasceram com a coluna `tenant`
(hoje sempre `'alagoinhas'`). Essa é a "chave do apartamento" — a base do
multi-tenant já existe. Falta a **trava de segurança** (RLS), o **login** e a
**cobrança**.

```sql
create table posts (
  tenant text default 'alagoinhas',   -- ← a separação por cliente
  ...
)
```

---

## As 5 fases (em ordem de prioridade)

| Fase | Entrega | Esforço | Risco | Por que |
|------|---------|---------|-------|---------|
| 1 | **Login + RLS** (segurança) | Médio | Médio | Sem isso, multi-tenant é inseguro |
| 2 | **Perfis por cliente** (AGORA multi-tenant) | Médio | Baixo | Cada gabinete monitora seus próprios perfis |
| 3 | **Onboarding + troca de gabinete** | Médio | Baixo | Cadastrar novo cliente sem código |
| 4 | **Cobrança (assinatura)** | Alto | Médio | Transforma em receita |
| 5 | **Polimento** (marca, admin, limites) | Baixo | Baixo | Profissionalização |

---

## FASE 1 — Login + Isolamento de Dados (a mais crítica)

### O que muda
- **Supabase Auth**: cada pessoa do gabinete tem e-mail e senha.
- **Tabela de vínculo**: liga usuários a gabinetes.
- **RLS (Row Level Security)**: regra no banco que garante *"só vejo as linhas do MEU tenant"* — mesmo que alguém tente burlar pela API, o banco bloqueia.

### Modelo de dados (novas tabelas)
```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                  -- "Gabinete Gustavo Carmo"
  slug text unique,                    -- "alagoinhas"
  cidade text, uf text,
  plano text default 'starter',        -- starter | pro | enterprise
  ativo boolean default true,
  criado_em timestamptz default now()
);

create table memberships (
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  papel text default 'analista',       -- owner | gestor | analista | leitor
  primary key (tenant_id, user_id)
);
```

### A trava de segurança (RLS) — aplicada em TODAS as tabelas
```sql
alter table posts enable row level security;

-- Substitui a "leitura pública" atual por: só vejo o tenant ao qual pertenço
drop policy if exists "leitura publica posts" on posts;
create policy "isolamento_tenant" on posts for select
  using (
    tenant in (
      select t.slug from tenants t
      join memberships m on m.tenant_id = t.id
      where m.user_id = auth.uid()
    )
  );
```
> ⚠️ Esta política precisa ser replicada em **todas** as ~10 tabelas. Um descuido
> aqui = vazamento de dados entre clientes. É o ponto mais sensível do projeto.

### App (React)
- Tela de **login** (Supabase Auth UI ou própria).
- Trocar a `publishable key` aberta por sessão autenticada → o RLS filtra sozinho.
- O app não muda quase nada nas telas: o banco já devolve só os dados do tenant logado.

### Resultado da Fase 1
Ainda 1 cliente, mas **seguro e autenticado**. Pré-requisito para vender.

---

## FASE 2 — Perfis monitorados por cliente

### O problema atual
Os 14 perfis monitorados estão **fixos no código** (`agora.py`, dict `PERFIS`).
Cada gabinete monitora perfis diferentes.

### Solução
```sql
create table monitored_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  handle text not null,                -- "gustavoascarmo"
  plataforma text default 'instagram',
  categoria text,                      -- governo | oposicao | imprensa
  alvo boolean default false,          -- é o político-alvo?
  ativo boolean default true,
  unique (tenant, plataforma, handle)
);
```

### AGORA (Python)
- Em vez de rodar 1x para Alagoinhas, **faz um loop** por cada tenant ativo:
  ```python
  for tenant in listar_tenants_ativos():
      perfis = carregar_perfis(tenant)      # da tabela, não do código
      coletar → analisar → gravar (com tenant correto)
  ```
- O alvo da análise (hoje "Gustavo Carmo") vira configurável por tenant.

### Resultado
O AGORA agora alimenta **N gabinetes** automaticamente, cada um com seus perfis.

---

## FASE 3 — Onboarding (cadastrar cliente sem código)

- Tela "Novo gabinete": nome, cidade, perfil-alvo, perfis a monitorar.
- **Seletor de gabinete** no topo (para agências que gerenciam vários).
- Convite de usuários (o owner convida a equipe por e-mail).

---

## FASE 4 — Cobrança (vira receita)

- **Stripe** (ou similar): planos mensais/anuais.
- **Limites por plano** aplicados no código:
  | Plano | Preço/mês | Perfis | Plataformas | Usuários | Histórico |
  |-------|-----------|--------|-------------|----------|-----------|
  | Starter | R$ 297 | 10 | 1 | 2 | 30 dias |
  | Pro | R$ 897 | 40 | 3 | 8 | 180 dias |
  | Enterprise | R$ 2.500+ | ilimitado | todas | ilimitado | tudo |
- Trial de 14 dias; bloqueio/aviso quando excede o plano.

---

## FASE 5 — Polimento
- Logo/cores por gabinete (white-label leve).
- Painel admin (você vê todos os tenants, uso, faturamento).
- Relatórios PDF por cliente.

---

## 💰 Custos (estimativa por mês)

### Custos fixos (independente de nº de clientes)
| Item | Custo |
|------|-------|
| Supabase Free → Pro | $0 (poucos) → **$25/mês** (escala) |
| Hospedagem do app (Surge/Netlify) | **$0** (estático, serve todos) |
| Domínio próprio (opcional) | ~$15/ano |

### Custos por cliente (variáveis — crescem com cada gabinete)
| Item | Custo/cliente/mês | Observação |
|------|-------------------|------------|
| **Apify** (coleta) | ~$10–30 | O maior custo; depende do volume de perfis/posts |
| **Claude Haiku** (análise) | ~$2–5 | Barato; ~10 posts × 4x/dia |
| **Claude Sonnet** (crises/briefing) | ~$1–3 | Condicional (só dispara em crise) |
| **Stripe** (taxa) | 2,9% + R$0,39/transação | Sobre a mensalidade |

**Custo total por cliente: ~R$ 80–200/mês.** Com plano a partir de R$ 297, a
**margem é saudável** (50–70%).

> Exemplo: 10 clientes no plano Pro (R$ 897) = R$ 8.970/mês de receita,
> ~R$ 1.500 de custo → ~R$ 7.000/mês de margem.

---

## ⚠️ Riscos (e como mitigar)

| Risco | Gravidade | Mitigação |
|-------|-----------|-----------|
| **Vazamento entre clientes** (RLS mal feito) | 🔴 Crítico | Testar isolamento exaustivamente; RLS em TODAS as tabelas; auditoria |
| **LGPD** (dados políticos de vários municípios) | 🔴 Alto | Contrato (DPA) por cliente; direito de exclusão; reter mínimo |
| **Custo de IA/Apify escala linear** | 🟡 Médio | Limites por plano; cache; alertas de custo |
| **ToS do Instagram** (scraping em escala) | 🟡 Médio | Apify mitiga; avaliar APIs oficiais; diversificar fontes |
| **Suporte/onboarding** (mais clientes = mais trabalho) | 🟡 Médio | Onboarding self-service; documentação; FAQ |
| **Dependência de fornecedores** (Supabase/Apify/Anthropic) | 🟢 Baixo | Todos têm planos pagos estáveis; dados exportáveis |

---

## 🗺️ Recomendação de caminho

1. **Não comece pela cobrança.** Comece pela **Fase 1 (segurança)** — é a fundação.
2. Faça a **Fase 2** e cadastre 1–2 gabinetes-piloto **de graça** (validação real).
3. Só depois ative a **Fase 4 (cobrança)**, quando o produto já provou valor.
4. Cada fase é reversível e o Alagoinhas continua funcionando o tempo todo.

### Esforço total realista
As fases 1–3 (multi-tenant funcional, sem cobrança) são **semanas de trabalho**,
não horas — é a maior empreitada do projeto até aqui. A cobrança (Fase 4) é mais
um projeto à parte. Mas tudo construído de forma incremental, como sempre fizemos.

---

## Quando faz sentido fazer isso?

✅ **Faça** quando: você validou que o Radar tem valor real para Alagoinhas E
identificou outros gabinetes/candidatos interessados em pagar.

⏸️ **Espere** se: ainda está refinando o produto para Alagoinhas, ou não tem
demanda concreta de outros clientes. Multi-tenant sem clientes é complexidade sem retorno.

> A base já está pronta (coluna `tenant`). Quando a demanda aparecer, o caminho
> está mapeado — e dá para começar pela Fase 1 a qualquer momento.
