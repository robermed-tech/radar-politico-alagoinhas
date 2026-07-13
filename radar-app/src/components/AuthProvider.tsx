import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, loadProfile, type Session, type Role, type Profile } from "@/lib/auth";

// Capturado no carregamento do módulo — antes do supabase-js processar e
// limpar o hash da URL (detectSessionInUrl). Convite (inviteUserByEmail)
// redireciona com "type=invite" no hash; sem checar isso aqui, a janela de
// oportunidade se perde e não dá mais pra saber que a sessão veio de um convite.
const inviteLandingDetected =
  typeof window !== "undefined" && /type=invite/.test(window.location.hash);

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

    supabase.auth.getSession().then(({ data }) => hydrate(data.session));
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
    dismissInviteLanding: () => setIsInviteLanding(false),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
