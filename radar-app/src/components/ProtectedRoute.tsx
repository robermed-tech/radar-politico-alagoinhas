import { type ReactNode, useEffect, useState } from "react";
import { supabase, type Session } from "@/lib/auth";
import { LoginPage } from "@/pages/LoginPage";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  // undefined = ainda verificando | null = sem sessão | Session = autenticado
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-txt-2">
        Verificando sessão…
      </div>
    );
  }

  if (!session) return <LoginPage />;

  return <>{children}</>;
}
