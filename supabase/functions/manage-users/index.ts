// Edge Function: manage-users
// Convidar usuário (por e-mail), alterar papel e excluir. Só admin pode chamar.
// Deploy: supabase functions deploy manage-users
// Secrets necessários (já existem por padrão no projeto):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Chamada (frontend usa supabase.functions.invoke('manage-users', { body })):
//   { action: 'invite',   email, full_name?, role?, redirectTo? }
//   { action: 'set_role', user_id, role }
//   { action: 'delete',   user_id }

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  // 1) Identifica o chamador pelo JWT enviado no header Authorization.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: "Não autenticado" }, 401);

  // 2) Confirma que o chamador é admin e descobre o tenant dele.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", caller.id)
    .single();

  if (!callerProfile || callerProfile.role !== "admin") {
    return json({ error: "Sem permissão (apenas admin)" }, 403);
  }
  const tenant = callerProfile.tenant_id as string;

  // 3) Executa a ação.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const action = String(body.action ?? "");

  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const full_name = String(body.full_name ?? "");
    const role = body.role === "admin" ? "admin" : "user";
    const redirectTo = String(body.redirectTo ?? "") || undefined;
    if (!email) {
      return json({ error: "E-mail é obrigatório" }, 400);
    }

    // GERA o link de convite em vez de MANDAR e-mail. O e-mail embutido do
    // Supabase (GoTrue) é limitado a poucos envios/hora ("email rate limit
    // exceeded"); generate_link NÃO passa pelo mailer, então não tem esse teto.
    // O admin copia o action_link e entrega ao usuário (WhatsApp, e-mail próprio…).
    // O link cai no mesmo fluxo de "definir senha" (lib/inviteFlow.ts).
    let { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name, role, tenant_id: tenant }, redirectTo },
    });

    // Usuário já existe (ex.: convidado antes, mas ainda não definiu a senha):
    // um link de convite falha, então geramos um de recuperação — que também
    // leva à tela de definir senha. Assim dá pra "reenviar" o link a quem ficou
    // preso sem depender do e-mail.
    let existing = false;
    if (error && /already|exists|registered/i.test(error.message)) {
      existing = true;
      ({ data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      }));
    }
    if (error) return json({ error: error.message }, 400);

    // O trigger handle_new_user cria o profile no convite novo; garantimos
    // papel/tenant aqui também. Em usuário já existente não mexemos no papel.
    if (data?.user && !existing) {
      await admin.from("profiles").upsert({
        id: data.user.id,
        email,
        full_name,
        role,
        tenant_id: tenant,
      });
    }
    return json({
      ok: true,
      user_id: data?.user?.id,
      action_link: data?.properties?.action_link ?? null,
      existing,
    });
  }

  if (action === "set_role") {
    const user_id = String(body.user_id ?? "");
    const role = body.role === "admin" ? "admin" : "user";
    if (!user_id) return json({ error: "user_id é obrigatório" }, 400);
    if (user_id === caller.id && role !== "admin") {
      return json({ error: "Você não pode remover o próprio acesso de admin" }, 400);
    }

    const { error } = await admin
      .from("profiles")
      .update({ role })
      .eq("id", user_id)
      .eq("tenant_id", tenant); // só mexe em usuários do próprio tenant
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "delete") {
    const user_id = String(body.user_id ?? "");
    if (!user_id) return json({ error: "user_id é obrigatório" }, 400);
    if (user_id === caller.id) {
      return json({ error: "Você não pode excluir a própria conta" }, 400);
    }

    // Confere que o alvo é do mesmo tenant antes de excluir.
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

  return json({ error: "Ação desconhecida" }, 400);
});
