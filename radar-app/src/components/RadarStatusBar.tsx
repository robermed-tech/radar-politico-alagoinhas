import { useQuery } from "@tanstack/react-query";
import { fetchCollectionLogsHoje, fetchFontesUnificadas, calcKpis } from "@/lib/collection";
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
const COR_RADAR_ATIVO = "#FF6A2B";
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
  return calcKpis(logs ?? [], sources ?? []);
}

/** Faixa horizontal compacta. */
export function RadarStatusBar() {
  const kpis = useRadarKpis();
  const ativo = kpis.fontesAtivas > 0;
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
          <b className="tnum text-txt-1">{fmtInt(kpis.itensColetados)}</b> item{kpis.itensColetados === 1 ? "" : "s"} coletado{kpis.itensColetados === 1 ? "" : "s"} hoje
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
 * fica de pé entre a foto escura do clima à esquerda e o laranja à direita sem
 * disputar atenção com nenhum dos dois.
 */
export function RadarStatusColumn({ minHeight = 320 }: { minHeight?: number }) {
  const kpis = useRadarKpis();
  const ativo = kpis.fontesAtivas > 0;
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
      <div
        className="text-sm uppercase tracking-[0.16em]"
        style={{ color: "rgba(255,255,255,0.78)", fontWeight: 700 }}
      >
        Coleta
      </div>

      {/* Ícone e texto sobem junto com os da AntenaStatusColumn (31/07):
          as duas são gêmeas de propósito, e um pedido de "aumentar a antena"
          só é honesto se o radar cresce a mesma proporção, senão as duas
          voltam a divergir e o "igual" que o cliente pediu em 29/07 quebra de
          novo — 150→210 na antena é ×1,4; aqui 168→235 mantém a mesma razão. */}
      <div className="my-9">
        <RadarSweep ativo={ativo} size={235} />
      </div>

      <div className="flex items-center justify-center gap-2.5">
        <span className="text-[21px] leading-tight text-white" style={{ fontWeight: 800 }}>
          {ativo ? "Em varredura" : "Ocioso"}
        </span>
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ background: cor, boxShadow: `0 0 10px ${cor}` }}
        />
      </div>
    </div>
  );
}
