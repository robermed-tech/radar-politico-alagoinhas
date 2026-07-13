/**
 * Hidratação de `tenant_settings` no cliente.
 *
 * O painel calcula IAD/Risco no navegador (lib/indices.ts). Os pesos desses
 * cálculos moravam hardcoded no código; agora são lidos de `tenant_settings`
 * (RLS permite SELECT a qualquer usuário autenticado) e aplicados no módulo de
 * índices. Assim a aba "Score" da Configuração passa a mexer, de fato, nos
 * números exibidos — antes ela salvava no banco mas nada os consumia.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSettings, type NotificationConfig } from "@/lib/admin";
import { setScoreWeights, DEFAULT_SCORE_WEIGHTS } from "@/lib/indices";

/** Defaults de notificação — espelham o seed da migration 002. */
export const DEFAULT_NOTIFICATION: NotificationConfig = {
  iad_limiar: 40,
  iad_ativo: true,
  neg_limiar: 60,
  neg_ativo: true,
  tema_limiar: 50,
  tema_ativo: false,
  subtema_limiar: 3,
  subtema_ativo: false,
  canal_whats: true,
  canal_email: false,
};

/**
 * Carrega as configurações do tenant uma vez e aplica os pesos do score.
 * Chamada no topo do App. Se algum peso mudou em relação ao default, invalida
 * a query de posts para que os `useMemo` de IAD/Risco recalculem com o valor
 * novo (do contrário só recalculariam na próxima troca de dados).
 */
export function useHydrateSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["tenant-settings"],
    queryFn: fetchSettings,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    const w = data?.score_weights;
    if (!w) return;
    setScoreWeights(w);
    const mudou = (Object.keys(DEFAULT_SCORE_WEIGHTS) as (keyof typeof DEFAULT_SCORE_WEIGHTS)[])
      .some((k) => Number(w[k]) !== DEFAULT_SCORE_WEIGHTS[k]);
    if (mudou) qc.invalidateQueries({ queryKey: ["radar"] });
  }, [data, qc]);

  return data ?? null;
}

/** Config de notificação em vigor (com defaults) — lida por painéis do dashboard. */
export function useNotificationConfig(): NotificationConfig {
  const { data } = useQuery({
    queryKey: ["tenant-settings"],
    queryFn: fetchSettings,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  return { ...DEFAULT_NOTIFICATION, ...(data?.notification_config ?? {}) };
}
