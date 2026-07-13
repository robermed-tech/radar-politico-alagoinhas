/**
 * Camada de acesso da Página Admin.
 * Tudo passa pelo cliente autenticado (JWT da sessão) → o RLS do Supabase
 * aplica as regras: SELECT para o tenant, escrita só admin. Erros de RLS
 * voltam como mensagem "sem permissão".
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase, type Role } from "@/lib/auth";

/**
 * supabase-js embrulha respostas não-2xx de Edge Functions num erro genérico
 * ("Edge Function returned a non-2xx status code") — a mensagem real vem no
 * corpo JSON da resposta, acessível só via error.context. Sem isso, o usuário
 * nunca vê o motivo de fato (ex.: "e-mail já cadastrado", "sem permissão").
 */
async function extractFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // corpo não era JSON — cai no fallback abaixo
    }
  }
  return (error as { message?: string })?.message ?? fallback;
}

const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";

/** Traduz erros do PostgREST/RLS em mensagens claras. */
export function explainError(err: { code?: string; message?: string } | null): string | null {
  if (!err) return null;
  if (err.code === "42501" || /row-level security|permission/i.test(err.message ?? "")) {
    return "Sem permissão para esta operação.";
  }
  return err.message ?? "Erro desconhecido.";
}

// ── tenant_settings ──────────────────────────────────────────
export interface ScoreWeights {
  risco_iad: number;
  risco_pct_alto: number;
  risco_velocidade: number;
  risco_amplificacao: number;
  risco_ica: number;
  iad_neutro: number;
}

export interface ClimateThresholds {
  faixas: [number, number, string, string | null][];
  limiar_previsao: number;
  limiar_tempestade_com_alerta: number;
  override_resp_min: number;
}

export interface NotificationConfig {
  iad_limiar: number;
  iad_ativo: boolean;
  neg_limiar: number;
  neg_ativo: boolean;
  tema_limiar: number;
  tema_ativo: boolean;
  /** Nº mínimo de comentários do mesmo subtema em 24h para disparar alerta. */
  subtema_limiar: number;
  subtema_ativo: boolean;
  canal_whats: boolean;
  canal_email: boolean;
}

export interface TenantSettings {
  tenant_id: string;
  score_weights: ScoreWeights;
  climate_thresholds: ClimateThresholds;
  notification_config: NotificationConfig;
}

export async function fetchSettings(): Promise<TenantSettings | null> {
  const { data } = await supabase
    .from("tenant_settings")
    .select("*")
    .eq("tenant_id", TENANT)
    .single();
  return (data as TenantSettings | null) ?? null;
}

export async function saveSettings(
  patch: Partial<Pick<TenantSettings, "score_weights" | "climate_thresholds" | "notification_config">>
): Promise<string | null> {
  const { error } = await supabase
    .from("tenant_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", TENANT);
  return explainError(error);
}

// ── relevance_keywords ───────────────────────────────────────
export interface Keyword {
  id: number;
  tenant_id: string;
  keyword: string;
  active: boolean;
}

export async function fetchKeywords(): Promise<Keyword[]> {
  const { data } = await supabase
    .from("relevance_keywords")
    .select("*")
    .eq("tenant_id", TENANT)
    .order("keyword");
  return (data as Keyword[]) ?? [];
}

export async function addKeyword(keyword: string): Promise<string | null> {
  const { error } = await supabase
    .from("relevance_keywords")
    .insert({ tenant_id: TENANT, keyword: keyword.trim() });
  return explainError(error);
}

export async function toggleKeyword(id: number, active: boolean): Promise<string | null> {
  const { error } = await supabase.from("relevance_keywords").update({ active }).eq("id", id);
  return explainError(error);
}

export async function deleteKeyword(id: number): Promise<string | null> {
  const { error } = await supabase.from("relevance_keywords").delete().eq("id", id);
  return explainError(error);
}

// ── monitored_sources ────────────────────────────────────────
export interface Source {
  id: number;
  tenant_id: string;
  platform: string;
  handle: string;
  categoria: string;
  filtro: string;
  active: boolean;
}

export async function fetchSources(): Promise<Source[]> {
  const { data } = await supabase
    .from("monitored_sources")
    .select("*")
    .eq("tenant_id", TENANT)
    .order("handle");
  return (data as Source[]) ?? [];
}

export async function addSource(
  platform: string,
  handle: string,
  categoria: string,
  filtro: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("monitored_sources")
    .insert({ tenant_id: TENANT, platform, handle: handle.trim(), categoria, filtro });
  return explainError(error);
}

export async function toggleSource(id: number, active: boolean): Promise<string | null> {
  const { error } = await supabase.from("monitored_sources").update({ active }).eq("id", id);
  return explainError(error);
}

export async function deleteSource(id: number): Promise<string | null> {
  const { error } = await supabase.from("monitored_sources").delete().eq("id", id);
  return explainError(error);
}

// ── profiles (gestão de usuários) ────────────────────────────
export interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  created_at: string;
}

export async function fetchUsers(): Promise<UserRow[]> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("tenant_id", TENANT)
    .order("created_at");
  return (data as UserRow[]) ?? [];
}

export interface InviteResult {
  /** Mensagem de erro, se falhou. */
  error?: string;
  /** Link de ativação/definição de senha para o admin copiar e entregar. */
  link?: string | null;
  /** true quando o e-mail já existia (link gerado é de recuperação). */
  existing?: boolean;
}

/**
 * Convida um usuário via Edge Function. A função GERA o link de ativação (não
 * manda e-mail — o e-mail embutido do Supabase é limitado por hora), e o admin
 * entrega o link ao usuário. Retorna o link em `link`.
 */
export async function inviteUser(input: {
  email: string;
  full_name: string;
  role: Role;
}): Promise<InviteResult> {
  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: { action: "invite", ...input, redirectTo: window.location.origin },
  });
  if (error) return { error: await extractFunctionError(error, "Falha ao convidar usuário.") };
  if (data?.error) return { error: data.error as string };
  return { link: (data?.action_link as string | null) ?? null, existing: !!data?.existing };
}

/** Altera o papel de um usuário via Edge Function. */
export async function setUserRole(user_id: string, role: Role): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: { action: "set_role", user_id, role },
  });
  if (error) return extractFunctionError(error, "Falha ao alterar papel.");
  if (data?.error) return data.error as string;
  return null;
}

/** Exclui definitivamente um usuário via Edge Function. */
export async function deleteUser(user_id: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: { action: "delete", user_id },
  });
  if (error) return extractFunctionError(error, "Falha ao excluir usuário.");
  if (data?.error) return data.error as string;
  return null;
}

// ── message_log (auditoria de disparos aos secretários) ──────
/** Registra um disparo. Best-effort: não bloqueia o envio em caso de falha. */
export async function logMessageSend(
  channel: "whatsapp" | "email",
  recipient: string,
  status: "aberto" | "erro" = "aberto"
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("message_log")
    .insert({ tenant_id: TENANT, sent_by: user.id, channel, recipient, status })
    .then(undefined, () => {});
}
