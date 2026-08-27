import { useQuery } from "@tanstack/react-query";
import { fetchCollectionLogsHoje, fetchFontesUnificadas, calcKpis } from "@/lib/collection";
import { fetchPipelineHealth } from "@/lib/data";
import { pipelineComProblema } from "@/components/PipelineHealthBanner";
import { fmtInt } from "@/lib/format";
import { FUNDO_ESCUTA, SOMBRA } from "./superficieRadio";

/**
 * Cores do estado do radar (onda 2 do redesign, 03/08). Varredura ativa no
 * LARANJA DA MARCA — era verde #22C55E, e o protótipo aprovado mostra o radar
 * na energia da marca; de quebra, o verde volta a ser exclusivo de sentimento,
 * que é a regra da paleta. Ocioso segue âmbar (é um estado de atenção: nenhuma
 * fonte ativa). Hex literal, e não var(--brand): a cor entra em strings de
 * conic-gradient com sufixo de alpha (`${cor}55`), onde var() não resolve —
 * acompanhar o token à mão se ele mudar.
 */
const COR_RADAR_ATIVO = "#62C2CA";
const COR_RADAR_OCIOSO = "#F59E0B";

/**
 * Status do "radar de coleta". A versão completa continua na aba Monitor de
 * coleta da Configuração; aqui ficam dois formatos compactos:
 *
 *   • `barra`  — faixa horizontal (usada quando não há os cards do clima ao
 *                lado, ex.: período sem dados);
 *   • `coluna` — painel vertical que fica ENTRE o card do clima e o de
 *                engajamento na Estação Meteorológica (pedido de 27/07). Antes
 *                a barra ficava sozinha no topo da página, empurrando os dois
 *                cards para baixo.
 */
function RadarSweep({ ativo, size = 34 }: { ativo: boolean; size?: number }) {
  const cor = ativo ? COR_RADAR_ATIVO : COR_RADAR_OCIOSO;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <style>{`
        @keyframes radar-mini-spin { to { transform: rotate(360deg); } }
        @keyframes radar-mini-pulso {
          0%   { transform: scale(0.45); opacity: 0.55; }
          100% { transform: scale(1);    opacity: 0; }
        }
        .radar-mini-sweep { animation: radar-mini-spin 3.4s linear infinite; }
        .radar-mini-pulso { animation: radar-mini-pulso 3.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .radar-mini-sweep, .radar-mini-pulso { animation: none; }
          .radar-mini-pulso { opacity: 0; }
        }
      `}</style>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" style={{ color: cor }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.30" strokeWidth="3" />
        <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
      </svg>
      <div
        className="radar-mini-pulso absolute inset-0 rounded-full"
        style={{ border: `2px solid ${cor}`, transformOrigin: "center" }}
      />
      <div
        className="radar-mini-sweep absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, ${cor}00 0deg, ${cor}00 290deg, ${cor}55 350deg, ${cor}AA 360deg)`,
          WebkitMaskImage: "radial-gradient(circle, #000 60%, transparent 61%)",
          maskImage: "radial-gradient(circle, #000 60%, transparent 61%)",
        }}
      />
      {/* O ponto central cresce devagar de propósito: numa proporção fixa de
          15% ele virava um blob de 25px quando o radar foi para 168px. */}
      {(() => {
        const p = Math.max(5, Math.round(size * 0.075));
        return (
          <span
            className="absolute rounded-full"
            style={{
              width: p,
              height: p,
              background: cor,
              boxShadow: `0 0 ${Math.max(8, p)}px ${cor}`,
              top: `calc(50% - ${p / 2}px)`,
              left: `calc(50% - ${p / 2}px)`,
            }}
          />
        );
      })()}
    </div>
  );
}

interface Kpis {
  fontesAtivas: number;
  itensColetados: number;
  execucoes: number;
  /** Varredura de verdade: há fonte ativa E o pipeline está saudável. */
  ativo: boolean;
}

function useRadarKpis(): Kpis {
  const { data: logs } = useQuery({
    queryKey: ["coleta-logs-hoje"],
    queryFn: fetchCollectionLogsHoje,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: sources } = useQuery({
    queryKey: ["coleta-fontes-unificadas"],
    queryFn: fetchFontesUnificadas,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Mesma queryKey do App: o cache é compartilhado, nenhuma requisição extra.
  const { data: health } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: fetchPipelineHealth,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const kpis = calcKpis(logs ?? [], sources ?? []);
  // "Em varredura" exigia só fonte cadastrada, e o radar girava com o
  // pipeline parado e "0 itens coletados hoje" ao lado (pedido do cliente em
  // 06/08). Agora o estado vem da MESMA régua do banner de saúde
  // (pipelineComProblema): banner aceso ⇒ radar ocioso, sempre coerentes.
  return { ...kpis, ativo: kpis.fontesAtivas > 0 && !pipelineComProblema(health) };
}

/** Faixa horizontal compacta. */
export function RadarStatusBar() {
  const kpis = useRadarKpis();
  const ativo = kpis.ativo;
  const cor = ativo ? COR_RADAR_ATIVO : COR_RADAR_OCIOSO;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line bg-bg-1 px-4 py-2.5">
      <RadarSweep ativo={ativo} />
      <div className="min-w-0">
        <span className="text-sm font-extrabold text-txt-1">
          {ativo ? "Radar em varredura" : "Radar ocioso"}
        </span>
        <span
          className="ml-2 inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: cor, boxShadow: `0 0 6px ${cor}` }}
        />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[13px] text-txt-2">
        <span>
          <b className="tnum text-txt-1">{fmtInt(kpis.fontesAtivas)}</b> fonte{kpis.fontesAtivas === 1 ? "" : "s"} monitorada{kpis.fontesAtivas === 1 ? "" : "s"}
        </span>
        <span>
          {/* Plural de "item" é "itens" — concatenar "s" gerava "items". */}
          <b className="tnum text-txt-1">{fmtInt(kpis.itensColetados)}</b> {kpis.itensColetados === 1 ? "item coletado" : "itens coletados"} hoje
        </span>
        <span>
          <b className="tnum text-txt-1">{fmtInt(kpis.execucoes)}</b> execuç{kpis.execucoes === 1 ? "ão" : "ões"}
        </span>
      </div>
    </div>
  );
}

/**
 * Painel vertical do radar, para ficar entre os dois cards da Estação
 * Meteorológica. Grafite com texto branco (paleta neutra da reunião de 24/07):
 * fica de pé entre a foto escura do clima à esquerda e a marca à direita sem
 * disputar atenção com nenhum dos dois.
 */
/**
 * Selo para a LINHA DO TÍTULO, nascido no modelo Direção A (27/08/26), quando
 * o radar saiu da faixa nobre da Estação Meteorológica.
 *
 * HOJE ELE ESTÁ SEM CONSUMIDOR: horas depois, o Robério pediu o radar animado
 * de volta à faixa, e ter os dois ao mesmo tempo seria dizer o mesmo estado
 * duas vezes na mesma tela. Fica exportado porque a régua é a mesma
 * (useRadarKpis) e o formato compacto resolve qualquer tela em que a coluna
 * não caiba.
 */
export function RadarStatusChip() {
  const { ativo } = useRadarKpis();
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-bg-1 py-1 pl-1.5 pr-3.5 text-[15px] font-semibold text-txt-2"
      title={
        ativo
          ? "O radar está coletando publicações agora"
          : "Nenhuma coleta em andamento; confira o monitor de coleta"
      }
    >
      <RadarSweep ativo={ativo} size={22} />
      {ativo ? "Coleta em varredura" : "Coleta ociosa"}
    </span>
  );
}

export function RadarStatusColumn({
  minHeight = 320,
  tamanho = 235,
}: {
  minHeight?: number;
  /** Diâmetro do radar. 235 é a medida gêmea da AntenaStatusColumn (ver
   *  abaixo) e vale para a coluna larga da Rádio Escuta. Na Estação
   *  Meteorológica a coluna tem 183px e o card recorta o que passa disso, então
   *  a página passa um valor que CABE — radar cortado na borda lê como defeito,
   *  não como desenho. */
  tamanho?: number;
}) {
  const kpis = useRadarKpis();
  const ativo = kpis.ativo;
  const cor = ativo ? COR_RADAR_ATIVO : COR_RADAR_OCIOSO;

  // Revisão de 27/07: as três contagens (fontes monitoradas, itens coletados,
  // execuções) saíram deste card. Elas eram detalhe operacional competindo por
  // atenção com o clima e o engajamento, que são a leitura principal da tela;
  // continuam inteiras na aba Monitor de coleta da Configuração. O que resta é
  // o sinal de que o sistema está vivo, e o radar cresce para ocupar o espaço.
  // `h-full` alinha a BASE do radar com a dos dois cards vizinhos: o wrapper é
  // o item do grid e estica junto com a linha, mas este card parava no seu
  // próprio conteúdo (~320px) enquanto clima e engajamento crescem com o
  // texto, deixando o radar "flutuando" acima da linha de base (29/07).
  return (
    <div
      className="flex h-full flex-col items-center justify-center overflow-hidden rounded-[28px] px-6 py-8 text-center"
      style={{
        // A superfície vem de superficieRadio.ts, importada — este card, a
        // antena e os dois da Rádio Escuta são a MESMA superfície, e quatro
        // cópias da receita só ficam iguais enquanto ninguém mexe numa delas.
        // (Onda 2 de 03/08: a receita lá virou o chumbo quente da nova paleta,
        // com o contraste remedido no comentário do próprio token.)
        background: FUNDO_ESCUTA,
        minHeight,
        boxShadow: SOMBRA,
      }}
    >
      {/* Corpos subiram em 27/08 (pedido do Robério: "aumente o tamanho dos
          elementos e do ícone dentro do card"): rótulo 16→18px, estado 21→24px
          e LED 12→14px. A AntenaStatusColumn da Rádio Escuta, que é a gêmea
          desta desde 29/07, ficou nos corpos antigos — o pedido foi sobre este
          card. Se as duas tiverem que voltar a casar, é lá que se mexe. */}
      <div
        className="text-[18px] uppercase tracking-[0.16em]"
        style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
      >
        Coleta
      </div>

      {/* O diâmetro vem de quem posiciona (ver `tamanho`): esta coluna tem
          largura fixa no grid e o card recorta o que passa dela. */}
      {/* Respiro menor (36→24px) porque o desenho cresceu: sem isso o card
          passa a ditar a altura da faixa inteira, e o veredito ao lado estica
          junto para acompanhar uma folga que não é dado nenhum. */}
      <div className="my-6">
        <RadarSweep ativo={ativo} size={tamanho} />
      </div>

      <div className="flex items-center justify-center gap-2.5">
        <span className="text-[24px] leading-tight text-white" style={{ fontWeight: 800 }}>
          {ativo ? "Em varredura" : "Ocioso"}
        </span>
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ background: cor, boxShadow: `0 0 10px ${cor}` }}
        />
      </div>
    </div>
  );
}
