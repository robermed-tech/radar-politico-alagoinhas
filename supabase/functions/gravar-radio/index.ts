// Edge Function: gravar-radio
//
// Dispara uma captação sob demanda das rádios escolhidas no painel (botão
// GRAVAR da tela Escuta do Rádio). Só admin pode chamar.
//
// Por que uma Edge Function, e não um fetch direto do navegador para o GitHub:
// iniciar a gravação é acionar o workflow `radio.yml`, e isso exige um token
// com permissão de escrita em Actions. Esse token não pode viver no bundle do
// front — qualquer pessoa com o painel aberto teria como disparar runs pagos
// da Apify. Aqui ele fica do lado do servidor, e o navegador só apresenta o
// JWT do usuário logado, que a função confere contra `profiles.role`.
//
// Deploy:  supabase functions deploy gravar-radio
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (já
//          existem por padrão) mais:
//            GH_DISPATCH_TOKEN — PAT fine-grained com "Actions: read and write"
//                                no repositório, e nada além disso
//            GH_REPO           — opcional, "owner/repo" (default abaixo)
//          supabase secrets set GH_DISPATCH_TOKEN=...
//
// Chamada (frontend usa supabase.functions.invoke('gravar-radio', { body })):
//   { estacoes: string[], duracao?: number }

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GH_TOKEN = Deno.env.get("GH_DISPATCH_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GH_REPO") ?? "robermed-tech/radar-politico-alagoinhas";
const WORKFLOW = "radio.yml";
const BRANCH = Deno.env.get("GH_REF") ?? "main";

// Teto de minutos por gravação. O ator da Apify grava em TEMPO REAL, então cada
// minuto pedido é um minuto pago de run — e o step do radio.yml tem timeout de
// 65 min. O front oferece 15/30/45, mas quem valida é aqui: um body forjado não
// pode pedir três horas de captura.
const DURACAO_MAX = 60;
const DURACAO_PADRAO = 30;

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

  // 2) Escuta do Rádio é admin-only nos dois lados (migration 011). Gravar
  //    gasta crédito da Apify, então aqui a checagem é obrigatória.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: perfil } = await admin
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", caller.id)
    .single();
  if (!perfil || perfil.role !== "admin") {
    return json({ error: "Sem permissão (apenas admin)" }, 403);
  }

  if (!GH_TOKEN) {
    // Falha explícita e acionável: sem o secret, o botão não tem como iniciar
    // nada, e dizer "erro inesperado" mandaria alguém procurar no lugar errado.
    return json({
      error:
        "GRAVAÇÃO INDISPONÍVEL: o secret GH_DISPATCH_TOKEN não está configurado " +
        "nesta função. Cadastre um PAT com permissão de Actions (read and write) " +
        "com `supabase secrets set GH_DISPATCH_TOKEN=...`.",
    }, 503);
  }

  let body: { estacoes?: unknown; duracao?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const pedidas = Array.isArray(body.estacoes)
    ? body.estacoes.map(String).filter((s) => s.trim().length > 0)
    : [];
  if (pedidas.length === 0) {
    return json({ error: "Escolha ao menos uma rádio para gravar" }, 400);
  }

  // 3) Confere que as estações são do tenant do chamador, estão ativas e são
  //    mesmo rádios. Sem isso um body forjado mandaria gravar a fonte de outro
  //    tenant — o RLS protege a LEITURA, não o que a função de serviço faz.
  const { data: fontes } = await admin
    .from("sources")
    .select("id, label, handle")
    .eq("platform", "radio")
    .eq("active", true)
    .eq("tenant_id", perfil.tenant_id)
    .in("id", pedidas);

  const validas = (fontes ?? []).map((f) => String(f.id));
  if (validas.length === 0) {
    return json({ error: "Nenhuma das rádios escolhidas está ativa" }, 400);
  }

  const duracao = Math.max(
    1,
    Math.min(DURACAO_MAX, Number(body.duracao) || DURACAO_PADRAO),
  );

  // 4) Dispara o workflow. `estacoes` já implica ignorar a janela horária no
  //    coletor: quem apertou GRAVAR está pedindo agora, não no horário do
  //    programa cadastrado.
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
        inputs: {
          estacoes: validas.join(","),
          duracao: String(duracao),
          ignorar_janela: "true",
          dry_run: "false",
        },
      }),
    },
  );

  if (!resp.ok) {
    const detalhe = await resp.text();
    return json({ error: `GitHub recusou o disparo (${resp.status}): ${detalhe}` }, 502);
  }

  return json({
    ok: true,
    estacoes: (fontes ?? []).map((f) => f.label ?? f.handle),
    duracao,
    ignoradas: pedidas.length - validas.length,
  });
});
