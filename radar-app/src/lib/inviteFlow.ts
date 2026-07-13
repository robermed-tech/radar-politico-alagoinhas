import { supabase } from "./auth";

/**
 * Robustez do fluxo de convite/recuperação por e-mail.
 *
 * O Supabase pode entregar o link em DOIS formatos, dependendo da configuração
 * do projeto e da versão do template de e-mail:
 *
 *  1. Implícito (hash):   .../#access_token=...&type=invite&...
 *     → o supabase-js (detectSessionInUrl) já cria a sessão sozinho.
 *  2. PKCE (query):       .../?token_hash=pkce_...&type=invite
 *     → precisa chamar verifyOtp({ token_hash, type }) manualmente; o
 *       detectSessionInUrl NÃO cobre esse caso.
 *
 * A versão antiga só olhava o hash (`type=invite`), então um link no formato
 * (2) caía no login sem sessão — e o novo usuário ficava sem como definir a
 * senha. Aqui cobrimos os dois, além de recuperação de senha (type=recovery).
 */

type Landing = "invite" | "recovery" | null;

// Capturado no carregamento do módulo — antes do supabase-js processar e
// limpar o hash da URL (detectSessionInUrl).
const rawHash = typeof window !== "undefined" ? window.location.hash : "";
const rawSearch = typeof window !== "undefined" ? window.location.search : "";

const STICKY_KEY = "radar_auth_landing";

function tipoDe(s: string): Landing {
  if (/type=invite/.test(s)) return "invite";
  if (/type=recovery/.test(s)) return "recovery";
  return null;
}

/**
 * Detecta se a sessão veio de um link de convite/recuperação, em qualquer
 * formato (hash ou query). Fica "grudado" em sessionStorage para sobreviver ao
 * refresh enquanto o usuário ainda não definiu a senha.
 */
export function detectAuthLanding(): Landing {
  const achado = tipoDe(rawHash) || tipoDe(rawSearch);
  if (achado) {
    try { sessionStorage.setItem(STICKY_KEY, achado); } catch { /* modo privado */ }
    return achado;
  }
  try { return (sessionStorage.getItem(STICKY_KEY) as Landing) || null; } catch { return null; }
}

/** Limpa a marca de convite/recuperação — chamar após o usuário definir a senha. */
export function clearAuthLanding(): void {
  try { sessionStorage.removeItem(STICKY_KEY); } catch { /* modo privado */ }
}

/**
 * Estabelece a sessão quando o link chega no formato PKCE (token_hash na query
 * string). No-op no formato implícito (hash), que o detectSessionInUrl já trata.
 */
export async function ensureSessionFromEmailLink(): Promise<void> {
  const params = new URLSearchParams(rawSearch);
  const token_hash = params.get("token_hash");
  const type = params.get("type");
  if (!token_hash || !type) return;
  const { error } = await supabase.auth.verifyOtp({
    type: type as "invite" | "recovery" | "email" | "magiclink",
    token_hash,
  });
  if (error) console.warn("[auth] verifyOtp (token_hash) falhou:", error.message);
}
