import { createClient, type Session, type User } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "radar_session",
  },
});

export type { Session, User };

/** Resolve tenant_id do usuário via RPC. Fallback para VITE_TENANT enquanto RLS não está ativo. */
export async function getUserTenant(userId: string): Promise<string> {
  const { data } = await supabase.rpc("get_user_tenant", { uid: userId }).single();
  return (data as string | null) ?? (import.meta.env.VITE_TENANT as string) ?? "alagoinhas";
}

export async function sendMagicLink(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Retorna o JWT da sessão ativa para uso em calls PostgREST autenticadas. */
export async function getSessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
