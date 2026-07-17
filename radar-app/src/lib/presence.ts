/**
 * Presença em tempo real — "quem está com o dashboard aberto agora".
 *
 * Usa Presence do Supabase Realtime (canal efêmero, sem gravar no banco):
 * o estado desaparece sozinho quando a aba fecha ou a conexão cai, sem
 * precisar de heartbeat nem limpeza manual de linhas antigas.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/auth";

const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";
const CHANNEL_NAME = `presence-${TENANT}`;

interface PresenceMeta {
  online_at: string;
}

/** Anuncia no canal de presença que o usuário logado está com o app aberto. */
export function useTrackPresence(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: userId } },
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({ online_at: new Date().toISOString() } satisfies PresenceMeta);
      }
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

/** IDs (profiles.id) dos usuários com o dashboard aberto agora. */
export function useOnlineUserIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME);
    const sync = () => setIds(new Set(Object.keys(channel.presenceState<PresenceMeta>())));
    channel.on("presence", { event: "sync" }, sync);
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return ids;
}
