/**
 * Camada de acesso das FONTES DE COLETA (tabela `sources`) — subsistema novo
 * multi-plataforma (Instagram + YouTube), separado do `monitored_sources`
 * antigo (que ainda alimenta o pipeline Instagram e vive na aba "Fontes").
 *
 * Tudo passa pelo cliente autenticado (JWT da sessão) → o RLS aplica: SELECT
 * para qualquer autenticado, escrita só admin. O pipeline Python escreve com
 * a service role key (bypassa RLS).
 *
 * Regra central: toda fonte nasce `active = false`. O sistema fica inerte até
 * o admin ativar — nenhuma coleta roda sozinha.
 */
import { supabase } from "@/lib/auth";
import { explainError } from "@/lib/admin";

export type Platform = "instagram" | "youtube";

export interface Source {
  id: string;
  platform: Platform;
  handle: string;
  label: string | null;
  active: boolean;
  created_at: string;
}

// ── Normalização / validação de handle por rede ──────────────

export interface NormalizeResult {
  /** Handle normalizado, pronto p/ salvar. Presente só quando válido. */
  handle?: string;
  /** Mensagem de erro em pt-BR quando a entrada é inválida. */
  error?: string;
}

/**
 * Instagram: handle sem `@`, minúsculo. Aceita URL de perfil
 * (instagram.com/fulano) e extrai o handle. Regras do IG: letras, números,
 * ponto e underline, até 30 caracteres.
 */
function normalizeInstagram(raw: string): NormalizeResult {
  let h = raw.trim();
  if (!h) return { error: "Informe o @ do perfil." };

  // Extrai de uma URL de perfil, se colada.
  const urlMatch = h.match(/instagram\.com\/([^/?#]+)/i);
  if (urlMatch) h = urlMatch[1];

  h = h.replace(/^@+/, "").toLowerCase().trim();
  h = h.replace(/\/+$/, "");

  if (!h) return { error: "Informe o @ do perfil." };
  if (!/^[a-z0-9._]{1,30}$/.test(h)) {
    return { error: "Handle inválido. Use apenas letras, números, ponto e underline." };
  }
  return { handle: h };
}

/**
 * YouTube: aceita URL de canal ou `@handle`. Normaliza para a forma canônica:
 *   - `@handle`               → "@handle" (minúsculo)
 *   - youtube.com/@handle     → "@handle"
 *   - youtube.com/channel/UC… → "channel/UC…" (preserva o ID como veio)
 *   - youtube.com/c/Nome ou /user/Nome → "c/Nome" / "user/Nome"
 * O ID de canal (UC…) é case-sensitive, então NÃO é convertido para minúsculo.
 */
function normalizeYoutube(raw: string): NormalizeResult {
  const s = raw.trim();
  if (!s) return { error: "Informe o canal (URL ou @handle)." };

  // channel/UC… (o mais estável de resolver na Apify)
  const channelMatch = s.match(/channel\/(UC[\w-]+)/i);
  if (channelMatch) return { handle: `channel/${channelMatch[1]}` };

  // @handle, com ou sem URL em volta
  const handleMatch = s.match(/@([A-Za-z0-9._-]+)/);
  if (handleMatch) return { handle: `@${handleMatch[1].toLowerCase()}` };

  // /c/Nome ou /user/Nome
  const legacyMatch = s.match(/\/(c|user)\/([^/?#]+)/i);
  if (legacyMatch) return { handle: `${legacyMatch[1].toLowerCase()}/${legacyMatch[2]}` };

  // Texto simples sem @ nem URL: trata como handle e prefixa @.
  if (/^[A-Za-z0-9._-]{1,60}$/.test(s)) {
    return { handle: `@${s.toLowerCase()}` };
  }

  return { error: "Canal inválido. Cole a URL do canal ou informe @handle." };
}

/** Normaliza+valida o handle conforme a rede. */
export function normalizeHandle(platform: Platform, raw: string): NormalizeResult {
  return platform === "youtube" ? normalizeYoutube(raw) : normalizeInstagram(raw);
}

// ── CRUD ─────────────────────────────────────────────────────

export async function fetchSources(): Promise<Source[]> {
  const { data } = await supabase
    .from("sources")
    .select("*")
    .order("platform")
    .order("created_at");
  return (data as Source[]) ?? [];
}

/**
 * Cadastra uma fonte. Normaliza o handle, valida e checa duplicata
 * (platform+handle) no cliente antes de inserir — o UNIQUE do banco é a rede
 * de segurança. A fonte nasce SEMPRE pausada (active=false).
 */
export async function addSource(
  platform: Platform,
  handleRaw: string,
  labelRaw: string,
): Promise<string | null> {
  const norm = normalizeHandle(platform, handleRaw);
  if (norm.error) return norm.error;
  const handle = norm.handle!;

  // Dedup no cliente p/ dar mensagem clara (o UNIQUE do banco cobre corridas).
  const existentes = await fetchSources();
  if (existentes.some((s) => s.platform === platform && s.handle === handle)) {
    return "Essa fonte já está cadastrada.";
  }

  const label = labelRaw.trim();
  const { error } = await supabase
    .from("sources")
    .insert({ platform, handle, label: label || null, active: false });

  // 23505 = unique_violation (corrida perdeu p/ outra inserção).
  if (error?.code === "23505") return "Essa fonte já está cadastrada.";
  return explainError(error);
}

export async function toggleSource(id: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from("sources").update({ active }).eq("id", id);
  return explainError(error);
}

export async function deleteSource(id: string): Promise<string | null> {
  const { error } = await supabase.from("sources").delete().eq("id", id);
  return explainError(error);
}
