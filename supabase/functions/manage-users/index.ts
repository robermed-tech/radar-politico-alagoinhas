// Edge Function: manage-users
// Convidar usuário (criar com senha) e alterar papel. Só admin pode chamar.
// Deploy: supabase functions deploy manage-users
// Secrets necessários (já existem por padrão no projeto):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Chamada (frontend usa supabase.functions.invoke('manage-users', { body })):
//   { action: 'invite',   email, password, full_name?, role? }
//   { action: 'set_role', user_id, role }

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
    const password = String(body.password ?? "");
    const full_name = String(body.full_name ?? "");
    const role = body.role === "admin" ? "admin" : "user";
    if (!email || password.length < 6) {
      return json({ error: "E-mail e senha (mín. 6 caracteres) são obrigatórios" }, 400);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, tenant_id: tenant },
    });
    if (error) {
      const msg = /already.*registered|exists/i.test(error.message)
        ? "Este e-mail já está cadastrado"
        : error.message;
      return json({ error: msg }, 400);
    }
    // O trigger handle_new_user cria o profile; garantimos papel/tenant aqui também.
    if (data.user) {
      await admin.from("profiles").upsert({
        id: data.user.id,
        email,
        full_name,
        role,
        tenant_id: tenant,
      });
    }
    return json({ ok: true, user_id: data.user?.id });
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

  return json({ error: "Ação desconhecida" }, 400);
});
