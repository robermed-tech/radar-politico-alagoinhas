import { type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LoginPage } from "@/pages/LoginPage";

function Verificando() {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-txt-2">
      Verificando sessão…
    </div>
  );
}

/** Guarda de rota: exige login. Sem sessão → tela de login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (loading) return <Verificando />;
  if (!session) return <LoginPage />;
  return <>{children}</>;
}

/** Guarda de rota: exige papel admin. Mostra um fallback se não for. */
export function RequireAdmin({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { loading, isAdmin } = useAuth();
  if (loading) return <Verificando />;
  if (!isAdmin) {
    return (
      <>
        {fallback ?? (
          <div className="grid min-h-[60vh] place-items-center p-8 text-center">
            <div>
              <div className="text-lg font-extrabold text-txt-1">Acesso restrito</div>
              <p className="mt-1 text-sm text-txt-2">
                Esta área é exclusiva de administradores.
              </p>
            </div>
          </div>
        )}
      </>
    );
  }
  return <>{children}</>;
}

/** Compat: ProtectedRoute continua existindo como alias de RequireAuth. */
export const ProtectedRoute = RequireAuth;
