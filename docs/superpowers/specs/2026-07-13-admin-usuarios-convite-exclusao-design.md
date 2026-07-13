# Admin → Usuários: convite por e-mail + exclusão de usuário — Design Spec

**Data:** 2026-07-13
**Status:** Aprovado
**Escopo:** aba "Usuários" da página Administração (`radar-app`)
**Usuário primário:** administrador do tenant (hoje: robermed@gmail.com, Alagoinhas)
**Contexto:** a aba Usuários já permite convidar (com senha definida manualmente pelo admin) e trocar papel. Faltam duas coisas: (1) excluir usuário e (2) uma confirmação real de que o convite foi recebido — hoje nenhum e-mail é enviado ao convidado, a comunicação da senha é 100% manual e fora do sistema.

---

## Diagnóstico do estado atual

- `supabase/functions/manage-users/index.ts` só tem as ações `invite` (via `admin.auth.admin.createUser` com senha escolhida pelo admin) e `set_role`. Não existe ação de exclusão.
- O e-mail nunca é usado no fluxo — a senha inicial é digitada pelo admin no formulário e repassada ao convidado por fora (WhatsApp, telefone etc.), sem nenhum registro de que o convite chegou.
- SMTP customizado está desativado no projeto (plano Free do Supabase) — o e-mail padrão do Supabase será usado (limite de envios por hora, aceitável para o volume atual de convites).
- Não há coluna de soft-delete em `profiles`; `profiles.id` e `tenants_users.user_id` referenciam `auth.users(id) ON DELETE CASCADE`.
- O app não usa router — `App.tsx` controla a página ativa via state local, e `RequireAuth` (em `ProtectedRoute.tsx`) decide entre `LoginPage` e o app com base apenas na presença de `session`.

---

## Seção A — Convite por e-mail (substitui o fluxo de senha manual)

**Backend (`manage-users/index.ts`, ação `invite`):**
- Troca `admin.auth.admin.createUser({ email, password, ... })` por `admin.auth.admin.inviteUserByEmail(email, { data: { full_name, role, tenant_id: tenant }, redirectTo })`.
- `redirectTo` vem no corpo da requisição, enviado pelo frontend como `window.location.origin` — necessário para funcionar em qualquer domínio de tenant (hoje Alagoinhas, no futuro outros clientes com subdomínios `*.surge.sh` distintos).
- O trigger `handle_new_user` (já corrigido nesta sessão para qualificar `public.profiles`/`public.tenants_users`) continua criando o profile automaticamente na inserção em `auth.users` — nenhuma mudança necessária ali.
- Validação de senha (`password.length < 6`) sai da função, já que a senha deixa de ser informada pelo admin.

**Frontend (`radar-app/src/lib/admin.ts`):**
- `inviteUser` perde o campo `password` da assinatura; passa a enviar `redirectTo: window.location.origin`.

**Frontend (`radar-app/src/pages/AdminPage.tsx`, `UsersSection`):**
- Campo "Senha inicial" removido do formulário "Convidar usuário" — sobram e-mail, nome completo e papel.
- Mensagem de sucesso: "✔ Convite enviado por e-mail" (em vez de "✔ Usuário convidado").

---

## Seção B — Tela "Definir senha" (nova) + configuração no Supabase

Ao clicar no link do e-mail, o Supabase autentica o usuário temporariamente e redireciona de volta ao app — mas nenhuma senha foi definida ainda. Sem uma tela dedicada, o usuário cairia direto no painel principal e nunca criaria uma senha (ficando sem conseguir logar depois).

**Nova página `radar-app/src/pages/AceitarConvitePage.tsx`:**
- Detectada via o parâmetro `type=invite` que o Supabase inclui na URL de retorno do convite (checado antes do `supabase-js` processar/limpar a URL).
- Formulário simples: "Bem-vindo(a) ao Radar Político — defina sua senha para continuar", com campo de senha + confirmação (mínimo 6 caracteres, consistente com a política atual do Supabase Auth).
- Ao confirmar, chama `supabase.auth.updateUser({ password })`; só então o usuário é liberado para o painel normal (mesmo `RequireAuth`/`App.tsx`).
- Esse ato de definir a senha **é** a confirmação de recebimento do convite — evidência de que o usuário abriu o e-mail e completou o cadastro. Não há necessidade de rastrear "aberto/lido" via pixel ou webhook de e-mail (não confiável e desnecessariamente complexo para o objetivo real).

**Roteamento (`App.tsx` / novo wrapper):**
- Antes de `RequireAuth` decidir entre `LoginPage` e o app, checar se a URL atual indica uma sessão de convite pendente; se sim, renderizar `AceitarConvitePage` em vez do fluxo normal.

**Configuração no Supabase Dashboard (feita manualmente, uma vez, via painel):**
- Authentication → URL Configuration → Redirect URLs: adicionar `https://*.surge.sh` (cobre Alagoinhas e futuros tenants no mesmo domínio compartilhado da Surge). Sem isso, o Supabase ignora `redirectTo` fora da allow-list e cai silenciosamente no Site URL padrão.
- Authentication → Emails → Templates → Invite user: traduzir o template padrão (hoje em inglês) para PT-BR, mantendo a variável de link de ação.

---

## Seção C — Exclusão de usuário

**Comportamento:** exclusão definitiva (hard delete), com confirmação antes de executar.

**Backend (`manage-users/index.ts`), nova ação `delete`:**
```ts
if (action === "delete") {
  const user_id = String(body.user_id ?? "");
  if (!user_id) return json({ error: "user_id é obrigatório" }, 400);
  if (user_id === caller.id) {
    return json({ error: "Você não pode excluir a própria conta" }, 400);
  }

  // Confere que o alvo pertence ao mesmo tenant antes de excluir.
  const { data: target } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", user_id)
    .single();
  if (!target || target.tenant_id !== tenant) {
    return json({ error: "Usuário não encontrado" }, 404);
  }

  const { error } = await admin.auth.admin.deleteUser(user_id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
```
- `admin.auth.admin.deleteUser` remove o registro em `auth.users`; `profiles` e `tenants_users` somem junto via `ON DELETE CASCADE` — sem necessidade de limpeza manual adicional.
- Bloqueia auto-exclusão, no mesmo padrão já usado por `set_role` para impedir que o admin remova o próprio acesso.
- Confirma que o usuário-alvo é do mesmo tenant do admin chamador antes de excluir (mesmo padrão de isolamento usado em `set_role`).

**Frontend (`radar-app/src/lib/admin.ts`):**
- Nova função `deleteUser(user_id: string): Promise<string | null>`, reaproveitando o helper `extractFunctionError` (já adicionado nesta sessão) para repassar mensagens de erro reais da função.

**Frontend (`radar-app/src/pages/AdminPage.tsx`, `UsersSection`):**
- Botão "Excluir" (vermelho, mesmo estilo dos botões "Remover" já usados em Palavras-chave/Fontes) ao lado do seletor de papel de cada linha em "Usuários do tenant".
- Ao clicar: `window.confirm("Excluir <nome ou e-mail>? Essa ação não pode ser desfeita.")` antes de chamar `deleteUser` — diferente do padrão "clique único" usado em Palavras-chave/Fontes, por se tratar de uma ação com consequência maior (perda total de acesso da pessoa).

---

## Tratamento de erros

- Convite: e-mail duplicado, `redirectTo` fora da allow-list, falha de envio do Supabase — todos devem chegar como mensagem legível ao admin via `extractFunctionError`.
- Exclusão: usuário não encontrado, tentativa de auto-exclusão, usuário de outro tenant — mensagens claras, sem erro genérico.

## Verificação (manual — não há testes automatizados no `radar-app` hoje)

1. Convidar um e-mail de teste real → confirmar que o e-mail chega (template em PT-BR) e que o link leva à tela "Definir senha".
2. Definir a senha na tela nova → confirmar que o login funciona normalmente depois com a senha escolhida.
3. Excluir um usuário de teste → confirmar que some da lista "Usuários do tenant" e que o login dele passa a falhar.
4. Confirmar que auto-exclusão é bloqueada (tentar excluir a própria conta logada).
5. Confirmar que um admin não consegue excluir usuário de outro tenant (se houver mais de um tenant configurado para teste).

## Fora de escopo (adiado, por decisão explícita)

- Configuração de SMTP customizado (ex.: Resend) — usuário optou por manter o e-mail padrão do Supabase por enquanto.
- Soft-delete / reativação de usuário — usuário optou por exclusão definitiva; reconvite é o caminho para restaurar acesso.
