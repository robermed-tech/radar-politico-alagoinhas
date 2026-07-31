// Edge Function: testar-alerta-suporte
//
// Botão "Enviar teste" da aba Configurações > Alerta de Suporte. Só admin
// pode chamar.
//
// Por que uma Edge Function, e não um fetch direto do navegador para o
// GitHub: disparar o teste aciona o workflow `heartbeat.yml` (mesmo caminho
// que o alerta de verdade usa, então o teste prova o mecanismo real, não uma
// simulação à parte), e isso exige um token com permissão de escrita em
// Actions. Esse token não pode viver no bundle do front pelo mesmo motivo já
// documentado em gravar-radio: qualquer visitante do painel teria como
// disparar runs à vontade.
//
// Reusa o MESMO secret GH_DISPATCH_TOKEN já cadastrado para gravar-radio —
// é o mesmo PAT (Actions: read and write), sem escopo adicional.
//
// Deploy:  supabase functions deploy testar-alerta-suporte
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (já
//          existem por padrão) mais GH_DISPATCH_TOKEN (já existe, ver
//          gravar-radio/index.ts)

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GH_TOKEN = Deno.env.get("GH_DISPATCH_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GH_REPO") ?? "robermed-tech/radar-politico-alagoinhas";
const WORKFLOW = "heartbeat.yml";
const BRANCH = Deno.env.get("GH_REF") ?? "main";

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

  // 1) Identifica o chamador pelo JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: "Não autenticado" }, 401);

  // 2) Só admin — mesmo motivo do gravar-radio: aciona um workflow real.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: perfil } = await admin
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();
  if (!perfil || perfil.role !== "admin") {
    return json({ error: "Sem permissão (apenas admin)" }, 403);
  }

  if (!GH_TOKEN) {
    return json({
      error:
        "TESTE INDISPONÍVEL: o secret GH_DISPATCH_TOKEN não está configurado " +
        "nesta função. Cadastre um PAT com permissão de Actions (read and write) " +
        "com `supabase secrets set GH_DISPATCH_TOKEN=...`.",
    }, 503);
  }

  // 3) Dispara o heartbeat.yml em modo teste — mesmo código de envio que o
  //    alerta de verdade usa (heartbeat_check.py -> alerta_suporte.py), só
  //    que forçado (ignora dedup e limiar de horas).
  const resp = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: BRANCH,
        inputs: { teste_alerta: "true" },
      }),
    },
  );

  if (!resp.ok) {
    const detalhe = await resp.text();
    return json({ error: `GitHub recusou o disparo (${resp.status}): ${detalhe}` }, 502);
  }

  return json({ ok: true });
});
