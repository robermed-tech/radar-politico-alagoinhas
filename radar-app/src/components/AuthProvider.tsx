import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, loadProfile, type Session, type Role, type Profile } from "@/lib/auth";
import { detectAuthLanding, clearAuthLanding, ensureSessionFromEmailLink } from "@/lib/inviteFlow";

// Detecta convite/recuperação em QUALQUER formato de link (hash implícito ou
// query PKCE com token_hash), captado no carregamento do módulo — antes do
// supabase-js limpar o hash. Ver lib/inviteFlow.ts.
const inviteLandingDetected = detectAuthLanding() !== null;

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  tenant: string | null;
  isAdmin: boolean;
  /** true enquanto a sessão/profile inicial ainda está carregando. */
  loading: boolean;
  /** true quando a sessão atual veio de um link de convite ainda não aceito. */
  isInviteLanding: boolean;
  /** chamar depois que o usuário definir a senha, pra liberar o app normal. */
  dismissInviteLanding: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInviteLanding, setIsInviteLanding] = useState(inviteLandingDetected);

  useEffect(() => {
    let cancelled = false;

    async function hydrate(s: Session | null) {
      if (cancelled) return;
      setSession(s);
      if (s?.user) {
        const p = await loadProfile(s.user.id);
        if (!cancelled) setProfile(p);
      } else {
        setProfile(null);
      }
      if (!cancelled) setLoading(false);
    }

    // Se o link veio no formato PKCE (token_hash na query), estabelece a sessão
    // via verifyOtp ANTES de ler getSession — senão o novo usuário chega sem
    // sessão e não consegue definir a senha. No-op no formato implícito.
    ensureSessionFromEmailLink()
      .then(() => supabase.auth.getSession())
      .then(({ data }) => hydrate(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      // Não exibe spinner global nas trocas posteriores (ex.: refresh de token).
      hydrate(s);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const role = profile?.role ?? null;
  const value: AuthState = {
    session,
    profile,
    role,
    tenant: profile?.tenant_id ?? null,
    isAdmin: role === "admin",
    loading,
    isInviteLanding,
    dismissInviteLanding: () => {
      clearAuthLanding();
      setIsInviteLanding(false);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
