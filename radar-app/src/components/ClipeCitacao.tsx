import { useRef, useState } from "react";
import { urlDoClipe } from "@/lib/radio";

/**
 * Player do trecho de áudio da citação — Rádio Escuta.
 *
 * A citação no card é TRANSCRIÇÃO AUTOMÁTICA, e o Whisper alucina sobre música
 * (saiu "Suzy Allison Dance The Two Step" de uma letra em inglês). O instante
 * `mm:ss` sempre esteve ao lado da frase para permitir conferência; o botão
 * aqui é o que torna a conferência viável — antes era preciso abrir o áudio na
 * Apify, o que ninguém faz.
 *
 * Duas decisões que valem registro:
 *
 * 1. **A URL assinada é pedida no clique, não na montagem da lista.** Uma tela
 *    com trinta pautas dispararia trinta requisições de assinatura para ouvir
 *    zero ou uma — e a assinatura tem validade curta, então a que fosse emitida
 *    junto com a página poderia já ter expirado quando alguém clicasse.
 * 2. **Sem clipe não existe player.** Quando `audio_clip` é nulo (áudio já
 *    expirado na Apify, que retém 3 dias, ou bloco anterior a este recurso), o
 *    componente diz "sem áudio" em vez de mostrar um controle que não toca —
 *    a mesma regra de "falha não é silêncio" que o resto da seção segue.
 */
export function ClipeCitacao({ caminho }: { caminho: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);

  if (!caminho) {
    return (
      <span className="text-[12px] text-txt-3" title="O áudio da captação expira em 3 dias na Apify; a pauta fica 90 dias">
        sem áudio para conferir
      </span>
    );
  }

  async function tocar() {
    if (url) {
      void ref.current?.play();
      return;
    }
    setCarregando(true);
    setErro(false);
    const assinada = await urlDoClipe(caminho!);
    setCarregando(false);
    if (!assinada) {
      setErro(true);
      return;
    }
    setUrl(assinada);
  }

  if (erro) {
    return <span className="text-[12px] text-txt-3">áudio indisponível</span>;
  }

  if (url) {
    return (
      // `autoPlay` porque o player só aparece depois de um clique explícito no
      // botão de ouvir — não há reprodução automática ao abrir a página.
      <audio
        ref={ref}
        src={url}
        controls
        autoPlay
        preload="none"
        className="h-8 w-full max-w-[280px]"
      />
    );
  }

  return (
    <button
      onClick={tocar}
      disabled={carregando}
      // Pílula na marca (prévia aprovada em 04/08): o botão de conferir o
      // áudio é a ação principal da citação, não um detalhe cinza. Tinta
      // escura sobre o laranja, como todo preenchimento de marca.
      className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[13px] font-bold text-brand-ink transition hover:opacity-90 disabled:opacity-60"
      title="Ouvir este trecho da captação para conferir a transcrição"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
      {carregando ? "abrindo…" : "ouvir o trecho"}
    </button>
  );
}
