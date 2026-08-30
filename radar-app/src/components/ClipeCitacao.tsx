import { useState } from "react";
import { urlDoClipe } from "@/lib/radio";
import { MedidorNivel, useNivelDeAudio } from "@/components/MedidorNivel";

/**
 * Player do trecho de áudio da citação — Rádio Escuta.
 *
 * A citação no card é TRANSCRIÇÃO AUTOMÁTICA, e o Whisper alucina sobre música
 * (saiu "Suzy Allison Dance The Two Step" de uma letra em inglês). O instante
 * `mm:ss` sempre esteve ao lado da frase para permitir conferência; o botão
 * aqui é o que torna a conferência viável — antes era preciso abrir o áudio na
 * Apify, o que ninguém faz.
 *
 * Três decisões que valem registro:
 *
 * 1. **A URL assinada é pedida no clique, não na montagem da lista.** Uma tela
 *    com trinta pautas dispararia trinta requisições de assinatura para ouvir
 *    zero ou uma — e a assinatura tem validade curta, então a que fosse emitida
 *    junto com a página poderia já ter expirado quando alguém clicasse.
 * 2. **Sem clipe não existe player.** Quando `audio_clip` é nulo (áudio já
 *    expirado na Apify, que retém 3 dias, ou bloco anterior a este recurso), o
 *    componente diz "sem áudio" em vez de mostrar um controle que não toca —
 *    a mesma regra de "falha não é silêncio" que o resto da seção segue.
 * 3. **O transporte é próprio para caber o MEDIDOR DE NÍVEL** (30/08/26). O
 *    `<audio controls>` nativo não aceita nada dentro dele, e o medidor
 *    empilhado por fora seriam duas linguagens visuais coladas. O transporte
 *    daqui é mínimo de propósito — tocar/pausar, escada de dB e uma régua de
 *    posição —, porque o trabalho é conferir uma frase de segundos, não editar
 *    áudio. A régua usa `accentColor` na marca, o mesmo idioma dos controles
 *    deslizantes da Configuração.
 *
 * Se o navegador não medir (sem Web Audio, ou o áudio recusado em modo CORS), o
 * componente cai no player nativo em vez de mostrar um medidor parado.
 */

function mmss(seg: number): string {
  if (!Number.isFinite(seg)) return "0:00";
  const s = Math.max(0, Math.floor(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ClipeCitacao({ caminho }: { caminho: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  /** O elemento vem por callback ref: o medidor só pode ligar o grafo depois
   *  que ele existe, e um `useRef` não avisaria a mudança. */
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  /** O modo CORS é o que permite medir. Se ele impedir o carregamento, o
   *  player volta ao nativo — perder o medidor é melhor que perder o áudio. */
  const [semCors, setSemCors] = useState(false);

  const { db, pico, medindo } = useNivelDeAudio(audio, tocando);

  if (!caminho) {
    return (
      <span className="text-[12px] text-txt-3" title="O áudio da captação expira em 3 dias na Apify; a pauta fica 90 dias">
        sem áudio para conferir
      </span>
    );
  }

  async function tocar() {
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

  if (url && (semCors || !medindo)) {
    // Caminho de recuo: sem medição, o controle nativo faz o trabalho.
    return <audio src={url} controls autoPlay className="h-8 w-full max-w-[280px]" />;
  }

  if (url) {
    return (
      <div className="w-full max-w-[320px]">
        <audio
          ref={setAudio}
          src={url}
          // `autoPlay` porque o player só aparece depois de um clique explícito
          // no botão de ouvir — não há reprodução automática ao abrir a página.
          autoPlay
          crossOrigin="anonymous"
          className="hidden"
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          onEnded={() => setTocando(false)}
          onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuracao(e.currentTarget.duration)}
          onError={() => setSemCors(true)}
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => (tocando ? audio?.pause() : void audio?.play())}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink transition hover:opacity-90"
            aria-label={tocando ? "Pausar o trecho" : "Tocar o trecho"}
          >
            {tocando ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <MedidorNivel db={db} pico={pico} />
        </div>

        <div className="mt-1.5 flex items-center gap-2 pl-10">
          <input
            type="range"
            min={0}
            max={duracao || 0}
            step={0.1}
            value={Math.min(tempo, duracao || 0)}
            onChange={(e) => {
              const t = Number(e.currentTarget.value);
              if (audio) audio.currentTime = t;
              setTempo(t);
            }}
            aria-label="Posição no trecho"
            className="h-1 min-w-0 flex-1 cursor-pointer"
            style={{ accentColor: "var(--brand)" }}
          />
          <span className="tnum shrink-0 text-[11px] text-txt-3">
            {mmss(tempo)} / {mmss(duracao)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={tocar}
      disabled={carregando}
      // Pílula na marca (prévia aprovada em 04/08): o botão de conferir o
      // áudio é a ação principal da citação, não um detalhe cinza. Tinta
      // escura sobre a marca, como todo preenchimento de marca.
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
