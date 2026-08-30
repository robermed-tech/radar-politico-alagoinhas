import { useEffect, useRef, useState } from "react";

/**
 * Medidor de nível (dBFS) do clipe de áudio da Rádio Escuta.
 *
 * É um INSTRUMENTO, não um enfeite: o valor sai do `AnalyserNode` lendo o áudio
 * que está tocando de verdade. A distinção importa porque o painel já tem um
 * equalizador (`SinalVivo.OndasEq`), e aquele é um SÍMBOLO — barras que dizem
 * "tem áudio aqui" sem medir nada. Um medidor que animasse sem dado seria a
 * segunda cópia do mesmo símbolo, ocupando o lugar de uma medição.
 *
 * O idioma é o do rádio: escada de segmentos com RETENÇÃO DE PICO (o traço que
 * salta para o máximo e desce devagar), que é o detalhe que separa um medidor
 * de broadcast de um visualizador de música. A escala é dBFS de -60 a 0, três
 * decibéis por segmento.
 *
 * Cor: teal da marca na faixa normal e âmbar nos últimos 6 dB, onde o sinal
 * encosta no teto. Verde e vermelho, que seriam o óbvio num medidor, estão
 * proibidos neste painel: ali eles são SENTIMENTO, e um medidor vermelho leria
 * como "reação negativa" na mesma tela que mede reação. Âmbar já é a cor de
 * atenção do painel (radar ocioso, avisos), então o alerta de nível fala a
 * língua que a tela já fala.
 *
 * Silêncio é dito, não desenhado: sem áudio tocando a escada apaga e o número
 * vira travessão. Medidor parado num valor antigo mentiria sobre o que está
 * saindo pelo alto-falante.
 */

/** Piso da escala. Abaixo disso é silêncio para efeito de exibição. */
const DB_MIN = -60;
const SEGMENTOS = 20;
/**
 * Últimos 6 dB: a zona quente, onde o sinal encosta no teto digital.
 *
 * AO MEXER NESTE VALOR (ou em DB_MIN), medir antes contra um CLIPE REAL, não
 * escolher pela teoria: fala de rádio comprimida medida em 30/08/26 vive entre
 * ~-42 dBFS (pausas) e ~-14 dBFS (picos), média -21,1, e por isso a zona
 * quente não acende em material normal. Com o alarme em -12 toda pauta
 * piscaria âmbar, e aviso que dispara sempre não avisa nada.
 */
const DB_QUENTE = -6;
/** Queda da retenção de pico, em dB por segundo (PPM de broadcast é lento). */
const QUEDA_PICO = 14;
/** Quanto o pico fica parado antes de começar a cair. */
const SEGURA_PICO_MS = 800;
/** Queda do envelope, em dB por segundo. Ataque é imediato: é assim que um
 *  medidor de programa se comporta, e é o que deixa a fala legível. */
const QUEDA_ENVELOPE = 90;
const QUEDA_ENVELOPE_CALMO = 40;

const COR_NORMAL = "var(--brand)";
const COR_QUENTE = "#F59E0B";
/** Segmento apagado no token de LINHA do tema, nunca num cinza fixo: um claro
 *  a 13% desaparece no card branco do tema claro, e a escada vazia deixaria de
 *  existir justamente no estado que ela precisa mostrar — silêncio. */
const COR_APAGADO = "var(--line)";

function dbDoPico(amostras: Float32Array): number {
  let pico = 0;
  for (let i = 0; i < amostras.length; i += 1) {
    const v = Math.abs(amostras[i]);
    if (v > pico) pico = v;
  }
  return pico > 0 ? 20 * Math.log10(pico) : -Infinity;
}

/** Posição de um valor na escala, de 0 a 1. */
function naEscala(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - DB_MIN) / (0 - DB_MIN)));
}

export interface Leitura {
  /** Envelope corrente em dBFS; -Infinity é silêncio. */
  db: number;
  /** Retenção de pico em dBFS; -Infinity quando já caiu até o piso. */
  pico: number;
}

const SILENCIO: Leitura = { db: -Infinity, pico: -Infinity };

/**
 * UM AudioContext para a página inteira.
 *
 * O navegador limita a cerca de seis contextos por página, e a tela de pautas
 * tem um player por citação: com um contexto por player, quem conferisse a
 * sétima citação da lista veria o medidor falhar sem explicação. O contexto
 * fica aberto e ocioso entre uma escuta e outra, que custa muito menos que
 * gerenciar fechamento — e fechá-lo derrubaria os outros players, já que agora
 * ele é compartilhado.
 */
let contexto: AudioContext | null = null;

function contextoDeAudio(): AudioContext {
  if (!contexto) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("sem Web Audio");
    contexto = new Ctx();
  }
  return contexto;
}

/**
 * Liga o elemento de áudio ao analisador e devolve a leitura corrente.
 *
 * `createMediaElementSource` só pode ser chamado UMA vez por elemento, e a
 * partir dele o som passa a sair pelo grafo — por isso o analisador é ligado ao
 * `destination` logo em seguida. O elemento precisa estar em modo CORS
 * (`crossOrigin="anonymous"`): sem isso o grafo entrega silêncio, e o que se
 * perderia não seria o medidor, seria o áudio. O Storage do Supabase responde
 * `Access-Control-Allow-Origin: *` e atende preflight, então o modo CORS vale
 * para a URL assinada do clipe.
 *
 * `medindo` sai false quando o navegador não tem Web Audio ou o elemento já
 * está preso a outro grafo: quem chama mostra o player simples, sem medidor.
 */
export function useNivelDeAudio(
  audio: HTMLAudioElement | null,
  tocando: boolean,
): Leitura & { medindo: boolean } {
  const [leitura, setLeitura] = useState<Leitura>(SILENCIO);
  const [medindo, setMedindo] = useState(true);
  const grafo = useRef<{ ctx: AudioContext; analisador: AnalyserNode } | null>(null);

  useEffect(() => {
    if (!audio || !tocando) {
      // Parou: a escada apaga. Congelar no último valor afirmaria um nível que
      // não está mais saindo pelo alto-falante.
      setLeitura(SILENCIO);
      return;
    }

    try {
      if (!grafo.current) {
        const ctx = contextoDeAudio();
        const fonte = ctx.createMediaElementSource(audio);
        const analisador = ctx.createAnalyser();
        analisador.fftSize = 1024;
        analisador.smoothingTimeConstant = 0;
        fonte.connect(analisador);
        analisador.connect(ctx.destination);
        grafo.current = { ctx, analisador };
      }
    } catch {
      setMedindo(false);
      return;
    }

    const { ctx, analisador } = grafo.current;
    void ctx.resume();

    // Com movimento reduzido o medidor continua medindo — ele é dado —, mas com
    // queda mais lenta, para a escada não tremer.
    const calmo = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const queda = calmo ? QUEDA_ENVELOPE_CALMO : QUEDA_ENVELOPE;

    const buffer = new Float32Array(analisador.fftSize);
    let vivo = true;
    let quadro = 0;
    let envelope = -Infinity;
    let pico = -Infinity;
    let picoEm = 0;
    let anterior = performance.now();

    function passo(agora: number) {
      if (!vivo) return;
      const dt = Math.max(0.001, (agora - anterior) / 1000);
      anterior = agora;

      analisador.getFloatTimeDomainData(buffer);
      const instantaneo = dbDoPico(buffer);

      if (instantaneo > envelope) {
        envelope = instantaneo;
      } else if (Number.isFinite(envelope)) {
        envelope -= queda * dt;
        if (envelope < DB_MIN) envelope = -Infinity;
      }

      if (Number.isFinite(envelope) && envelope > pico) {
        pico = envelope;
        picoEm = agora;
      } else if (Number.isFinite(pico) && agora - picoEm > SEGURA_PICO_MS) {
        pico -= QUEDA_PICO * dt;
        if (pico < DB_MIN) pico = -Infinity;
      }

      setLeitura({ db: envelope, pico });
      quadro = requestAnimationFrame(passo);
    }

    quadro = requestAnimationFrame(passo);
    return () => {
      vivo = false;
      cancelAnimationFrame(quadro);
    };
  }, [audio, tocando]);

  // Nada de fechar o contexto ao desmontar: ele é compartilhado pela página, e
  // fechá-lo calaria os outros players. Desligar o analisador basta.
  useEffect(() => () => { grafo.current?.analisador.disconnect(); }, []);

  return { ...leitura, medindo };
}

/** A escada com a retenção de pico e o número em dBFS. */
export function MedidorNivel({ db, pico }: Leitura) {
  const acesos = Math.round(naEscala(db) * SEGMENTOS);
  const segPico = Number.isFinite(pico) ? Math.round(naEscala(pico) * SEGMENTOS) : 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        className="flex min-w-0 flex-1 items-stretch gap-[2px]"
        style={{ height: 16 }}
        role="meter"
        aria-label="Nível do áudio em decibéis"
        aria-valuemin={DB_MIN}
        aria-valuemax={0}
        aria-valuenow={Number.isFinite(db) ? Math.round(db) : DB_MIN}
      >
        {Array.from({ length: SEGMENTOS }, (_, i) => {
          const dbDoSegmento = DB_MIN + ((i + 1) / SEGMENTOS) * (0 - DB_MIN);
          const quente = dbDoSegmento > DB_QUENTE;
          const aceso = i < acesos;
          // A retenção ocupa o segmento do máximo recente, mesmo com a escada
          // já abaixo dele: é o traço que fica para trás.
          const ehPico = segPico > 0 && i === segPico - 1;
          return (
            <span
              key={i}
              className="min-w-0 flex-1 rounded-[1px]"
              style={{
                background: aceso || ehPico ? (quente ? COR_QUENTE : COR_NORMAL) : COR_APAGADO,
                opacity: ehPico && !aceso ? 0.8 : 1,
              }}
            />
          );
        })}
      </div>
      <span
        className="tnum shrink-0 text-[12px] font-bold"
        style={{ color: "var(--txt-2)", minWidth: 60, textAlign: "right" }}
      >
        {Number.isFinite(db) ? `${db.toFixed(1)} dB` : "— dB"}
      </span>
    </div>
  );
}
