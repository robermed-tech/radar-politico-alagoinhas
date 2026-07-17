/**
 * Presença em tempo real — "quem está com o dashboard aberto agora".
 *
 * Usa Presence do Supabase Realtime (canal efêmero, sem gravar no banco):
 * o estado desaparece sozinho quando a aba fecha ou a conexão cai, sem
 * precisar de heartbeat nem limpeza manual de linhas antigas.
 *
 * IMPORTANTE: o supabase-js reusa a MESMA instância de canal por topic no
 * mesmo cliente. Criar `supabase.channel(CHANNEL_NAME)` em dois lugares (um
 * para `track`, outro para ler o estado) faz o segundo `.on(...)` cair no
 * canal já subscrito e lançar "cannot add presence callbacks after
 * subscribe()" — o que, dentro de um useEffect sem error boundary, desmonta
 * a árvore React inteira (tela branca). Por isso mantemos UM único canal
 * singleton: ele registra o handler de `sync` e chama `subscribe()` uma só
 * vez; quem quer ler a lista de online só se inscreve num broadcast em
 * memória, sem tocar no supabase-js de novo.
 */
import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/auth";

const TENANT = (import.meta.env.VITE_TENANT as string | undefined) || "alagoinhas";
const CHANNEL_NAME = `presence-${TENANT}`;

interface PresenceMeta {
  online_at: string;
}

// ── Singleton do canal + broadcast em memória ────────────────────────────────
let channel: RealtimeChannel | null = null;
let onlineIds = new Set<string>();
const listeners = new Set<(ids: Set<string>) => void>();

function notify() {
  for (const l of listeners) l(onlineIds);
}

/** Cria (uma única vez) o canal de presença e começa a anunciar o usuário. */
function ensureChannel(userId: string): void {
  if (channel) return;
  const ch = supabase.channel(CHANNEL_NAME, {
    config: { presence: { key: userId } },
  });
  ch.on("presence", { event: "sync" }, () => {
    onlineIds = new Set(Object.keys(ch.presenceState<PresenceMeta>()));
    notify();
  });
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      ch.track({ online_at: new Date().toISOString() } satisfies PresenceMeta);
    }
  });
  channel = ch;
}

/** Anuncia no canal de presença que o usuário logado está com o app aberto. */
export function useTrackPresence(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    ensureChannel(userId);
    // Canal singleton — vive enquanto a aba estiver aberta; a presença some
    // sozinha quando a aba fecha. Não removemos aqui de propósito.
  }, [userId]);
}

/** IDs (profiles.id) dos usuários com o dashboard aberto agora. */
export function useOnlineUserIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(onlineIds);

  useEffect(() => {
    listeners.add(setIds);
    setIds(onlineIds); // estado atual imediato, sem esperar o próximo sync
    return () => {
      listeners.delete(setIds);
    };
  }, []);

  return ids;
}
