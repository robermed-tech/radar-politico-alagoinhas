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
//   { acao?: 'iniciar' | 'estado' | 'parar', estacoes?: string[], duracao?: number }
//     iniciar (default) — dispara o radio.yml
//     estado            — o que está gravando agora, direto da Apify
//     parar             — aborta o run na Apify e cancela o job que esperava
//   O secret APIFY_API_TOKEN é o que habilita 'estado' e 'parar'.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GH_TOKEN = Deno.env.get("GH_DISPATCH_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GH_REPO") ?? "robermed-tech/radar-politico-alagoinhas";
const WORKFLOW = "radio.yml";
const BRANCH = Deno.env.get("GH_REF") ?? "main";

// A Apify é a fonte da verdade sobre o que está GRAVANDO: o ator grava em tempo
// real na infraestrutura dela, e cancelar o job do GitHub não o interrompe (foi
// o caso já medido em que o coletor desistiu e o run terminou SUCCEEDED 102s
// depois, com o crédito gasto). Por isso "estado" e "parar" falam com a Apify, e
// o GitHub só entra no fim, para o runner não ficar esperando à toa.
const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN") ?? "";
const APIFY_BASE = "https://api.apify.com/v2";
const ATOR_RADIO = Deno.env.get("RADIO_ACTOR_ID") ?? "radarp_traffic~radio-transcriber";

// Teto de minutos por gravação. O ator da Apify grava em TEMPO REAL, então cada
// minuto pedido é um minuto pago de run. O teto tem que caber no timeout do step
// do radio.yml (130 min): subir aqui sem subir lá faria o job ser abortado no
// meio, com a captação inteira virando crédito gasto sem transcrição. O front
// oferece 15/30/45/90/120, mas quem valida é aqui — um body forjado não pode
// pedir um dia inteiro de captura.
const DURACAO_MAX = 120;
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

interface RunEmCurso {
  id: string;
  desde: string | null;
  duracaoMin: number | null;
  estacoes: string[];
}

/**
 * Runs do ator de rádio que estão gravando AGORA.
 *
 * O `INPUT` do run é lido aqui e NUNCA devolvido inteiro: saem só a duração
 * pedida e o nome das estações. Ele carrega o campo `groqApiKey` — que a Apify
 * guarda cifrado (`ENCRYPTED_VALUE:…`), então o risco não é chave em claro — e
 * o resto da configuração do run, que o navegador não precisa ver para
 * desenhar um contador.
 */
async function runsEmCurso(): Promise<RunEmCurso[]> {
  const resp = await fetch(
    `${APIFY_BASE}/acts/${ATOR_RADIO}/runs?status=RUNNING&desc=1&limit=10`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
  );
  if (!resp.ok) throw new Error(`Apify recusou a consulta (${resp.status})`);
  const corpo = await resp.json();
  const itens: Array<Record<string, unknown>> = corpo?.data?.items ?? [];

  return await Promise.all(itens.map(async (r) => {
    const run: RunEmCurso = {
      id: String(r.id ?? ""),
      desde: (r.startedAt as string) ?? null,
      duracaoMin: null,
      estacoes: [],
    };
    const loja = r.defaultKeyValueStoreId as string | undefined;
    if (!loja) return run;
    try {
      const inp = await fetch(
        `${APIFY_BASE}/key-value-stores/${loja}/records/INPUT`,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
      );
      if (!inp.ok) return run;
      const dados = await inp.json();
      const d = Number(dados?.durationMinutes);
      if (Number.isFinite(d) && d > 0) run.duracaoMin = d;
      const radios: Array<Record<string, unknown>> = dados?.radios ?? [];
      run.estacoes = radios
        .map((x) => String(x?.name ?? "").trim())
        .filter((x) => x.length > 0);
    } catch {
      /* sem o INPUT o contador fica sem duração; o estado continua verdadeiro */
    }
    return run;
  }));
}

/** Aborta um run na Apify. Imediato, não "gracefully": o objetivo é parar de
 *  pagar agora, e o ator só transcreve no fim do bloco de qualquer jeito. */
async function abortarRun(id: string): Promise<boolean> {
  const resp = await fetch(`${APIFY_BASE}/actor-runs/${id}/abort`, {
    method: "POST",
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  });
  return resp.ok;
}

/** Cancela os jobs do `radio.yml` que ficaram esperando o run que acabou de ser
 *  abortado. É o passo secundário e best-effort: sem ele o runner continuaria
 *  parado até o timeout, gastando minuto de Actions sem gravar nada. */
async function cancelarJobsDoRadio(): Promise<number> {
  if (!GH_TOKEN) return 0;
  const cab = {
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const lista = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/runs?status=in_progress&per_page=10`,
      { headers: cab },
    );
    if (!lista.ok) return 0;
    const corpo = await lista.json();
    const runs: Array<{ id: number }> = corpo?.workflow_runs ?? [];
    let n = 0;
    for (const r of runs) {
      const c = await fetch(
        `https://api.github.com/repos/${GH_REPO}/actions/runs/${r.id}/cancel`,
        { method: "POST", headers: cab },
      );
      if (c.ok) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
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

  let body: { acao?: unknown; estacoes?: unknown; duracao?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  // 3) Três ações no mesmo endpoint, porque as três dependem da MESMA checagem
  //    de admin acima. "iniciar" é o default para não quebrar chamada antiga.
  const acao = String(body.acao ?? "iniciar");

  if (acao === "estado" || acao === "parar") {
    if (!APIFY_TOKEN) {
      // Estado degrada em silêncio: sem saber o que está gravando, o painel
      // simplesmente não oferece PARAR — melhor que um botão que não cumpre.
      // Já o PARAR pedido explicitamente devolve erro acionável.
      if (acao === "estado") {
        return json({ gravando: false, runs: [], indisponivel: true });
      }
      return json({
        error:
          "PARAR INDISPONÍVEL: o secret APIFY_API_TOKEN não está configurado " +
          "nesta função. Sem ele não há como abortar o run que está gravando. " +
          "Cadastre com `supabase secrets set APIFY_API_TOKEN=...`.",
      }, 503);
    }

    let emCurso: RunEmCurso[];
    try {
      emCurso = await runsEmCurso();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Falha de consulta NÃO é "nada gravando" — a mesma distinção que já vale
      // para o cadastro de rádios logo abaixo. Dizer "nada gravando" aqui
      // esconderia uma captação paga em curso.
      return json({ error: `Falha ao consultar a Apify: ${msg}` }, 502);
    }

    if (acao === "estado") {
      return json({ gravando: emCurso.length > 0, runs: emCurso });
    }

    if (emCurso.length === 0) {
      return json({ ok: true, abortados: 0, jobsCancelados: 0, nada: true });
    }
    let abortados = 0;
    for (const r of emCurso) {
      if (await abortarRun(r.id)) abortados += 1;
    }
    const jobsCancelados = await cancelarJobsDoRadio();
    return json({ ok: true, abortados, jobsCancelados });
  }

  if (acao !== "iniciar") {
    return json({ error: `Ação desconhecida: ${acao}` }, 400);
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

  const pedidas = Array.isArray(body.estacoes)
    ? body.estacoes.map(String).filter((s) => s.trim().length > 0)
    : [];
  if (pedidas.length === 0) {
    return json({ error: "Escolha ao menos uma rádio para gravar" }, 400);
  }

  // 4) Confere que os ids pedidos são mesmo rádios do cadastro. Sem isso um
  //    body forjado mandaria gravar qualquer fonte — o RLS protege a LEITURA,
  //    não o que a chave de serviço faz.
  //
  //    NÃO existe filtro por tenant aqui: `sources` não tem coluna `tenant_id`
  //    (só `profiles` tem). O isolamento entre clientes neste produto é por
  //    PROJETO do Supabase, não por coluna nesta tabela. A primeira versão
  //    filtrava por `tenant_id` e o PostgREST devolvia 42703 (coluna
  //    inexistente) — o que fazia o botão acusar "nenhuma das rádios existe no
  //    cadastro" com quatro rádios cadastradas na tela ao lado.
  //
  //    `active` também não entra no filtro, de propósito: essa coluna governa a
  //    captação automática no horário do programa, e o painel oferece o cadastro
  //    inteiro para gravar sob demanda. Recusar uma estação cadastrada por estar
  //    pausada seria negar um pedido explícito de gravar agora.
  const { data: fontes, error: erroFontes } = await admin
    .from("sources")
    .select("id, label, handle")
    .eq("platform", "radio")
    .in("id", pedidas);

  // Falha de consulta NÃO é "nenhuma encontrada". Confundir as duas foi
  // exatamente o que mandou o usuário procurar o problema no cadastro, que
  // estava certo, em vez de na consulta, que estava errada.
  if (erroFontes) {
    return json({ error: `Falha ao ler o cadastro de rádios: ${erroFontes.message}` }, 500);
  }

  const validas = (fontes ?? []).map((f) => String(f.id));
  if (validas.length === 0) {
    return json({ error: "Nenhuma das rádios escolhidas existe neste cadastro" }, 400);
  }

  const duracao = Math.max(
    1,
    Math.min(DURACAO_MAX, Number(body.duracao) || DURACAO_PADRAO),
  );

  // 5) Dispara o workflow. `estacoes` já implica ignorar a janela horária no
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
