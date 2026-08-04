import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchProfileMetrics } from "@/lib/data";
import { montarRanking, desdeQuando, fmtSaldo, type PerfilSeguidores } from "@/lib/seguidores";
import { fmtInt } from "@/lib/format";

/* Prévia aprovada em 04/08: a cor por categoria saiu do ranking (CAT_COR
   pintava Prefeito de verde e Oposição de vermelho — verde/vermelho são de
   sentimento, e a mesma regra já tinha tirado a cor do seletor de perfis).
   Barra e sparkline agora são neutras (chumbo); a categoria continua no
   texto da linha. Ganho/perda seguem verde/vermelho porque saldo É juízo
   (ganhou/perdeu), via tokens de tema em vez do par de gráfico. */
const BARRA_NEUTRA = "linear-gradient(90deg, #55534E, #171613)";
const COR_GANHO = "var(--success)";
const COR_PERDA = "var(--danger)";

/** Saldo com seta e sinal. Zero e null viram texto neutro, nunca "verde de 0". */
function Saldo({ v }: { v: number | null }) {
  if (v === null) return <span className="text-txt-3">sem base de comparação</span>;
  if (v === 0) return <span className="tnum text-txt-3">estável</span>;
  return (
    <span className="tnum font-semibold" style={{ color: v > 0 ? COR_GANHO : COR_PERDA }}>
      {v > 0 ? "▲" : "▼"} {fmtSaldo(v)}
    </span>
  );
}

/** Mini gráfico da série de seguidores do perfil (SVG puro, sem biblioteca). */
function Sparkline({ serie, cor }: { serie: { t: number; v: number }[]; cor: string }) {
  const pontos = serie.slice(-20);
  if (pontos.length < 2) return <div className="h-6 w-20" />;
  const vs = pontos.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const d = pontos
    .map((p, i) => {
      const x = (i / (pontos.length - 1)) * 76 + 2;
      const y = 22 - ((p.v - min) / span) * 18;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width="80" height="24" className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={cor} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Card de destaque (maior/menor audiência, maior ganho/perda). */
function Destaque({
  rotulo,
  perfil,
  valor,
  legenda,
}: {
  rotulo: string;
  perfil: PerfilSeguidores | null;
  valor: React.ReactNode;
  legenda: string;
}) {
  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
      <div className="section-label">{rotulo}</div>
      {perfil ? (
        <>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-txt-1">@{perfil.handle}</span>
            <span className="truncate text-xs font-semibold text-txt-3">{perfil.categoria}</span>
          </div>
          <div className="tnum mt-1 font-display text-[28px] font-bold leading-none text-txt-1">{valor}</div>
          <div className="mt-1 text-xs text-txt-3">{legenda}</div>
        </>
      ) : (
        <div className="mt-2 text-sm text-txt-3">sem dados</div>
      )}
    </div>
  );
}

/**
 * Ranking de seguidores dos perfis monitorados, dentro de "Análise por Perfil".
 *
 * Mostra quem tem mais e menos seguidores, o total de cada conta e o saldo de
 * ganhos e perdas entre as coletas. O painel se atualiza sozinho a cada minuto:
 * assim que o pipeline grava um retrato novo (tabela `profile_metrics`), ele
 * aparece aqui sem recarregar a página.
 *
 * O Instagram publica só o TOTAL de seguidores de uma conta, nunca a lista de
 * quem entrou ou saiu. Por isso o que aparece é saldo líquido da janela, e o
 * rodapé explica isso ao usuário em vez de deixar a leitura ambígua.
 */
export function RankingSeguidores() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["profile-metrics"],
    queryFn: () => fetchProfileMetrics(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Relógio próprio: sem ele o "atualizado há X" congela no valor calculado na
  // montagem, mesmo com a query buscando dados novos em segundo plano.
  const [, setTique] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTique((n) => n + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const ranking = useMemo(() => montarRanking(data), [data]);

  const { maior, menor, ganho, perda, ultimaColeta } = useMemo(() => {
    if (ranking.length === 0) {
      return { maior: null, menor: null, ganho: null, perda: null, ultimaColeta: "" };
    }
    const comSaldo = ranking.filter((p) => p.delta24h !== null);
    const ordenadoSaldo = [...comSaldo].sort((a, b) => (b.delta24h ?? 0) - (a.delta24h ?? 0));
    const topo = ordenadoSaldo[0];
    const fundo = ordenadoSaldo[ordenadoSaldo.length - 1];
    return {
      maior: ranking[0],
      menor: ranking[ranking.length - 1],
      ganho: topo && (topo.delta24h ?? 0) > 0 ? topo : null,
      perda: fundo && (fundo.delta24h ?? 0) < 0 ? fundo : null,
      ultimaColeta: ranking.reduce(
        (a, p) => (p.atualizadoEm > a ? p.atualizadoEm : a),
        ranking[0].atualizadoEm
      ),
    };
  }, [ranking]);

  if (isLoading) return <div className="text-sm text-txt-3">Carregando seguidores…</div>;

  if (ranking.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <div className="section-label">Ranking de seguidores</div>
          <p className="text-sm text-txt-3">
            Quem tem mais e menos seguidores, com o saldo de ganhos e perdas de cada conta
          </p>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <p className="text-sm text-txt-2">
            Aguardando a primeira coleta de seguidores. O radar grava um retrato dos
            contadores de cada perfil monitorado a cada execução, e o ranking aparece aqui
            assim que o primeiro retrato chegar.
          </p>
        </div>
      </div>
    );
  }

  const maxSeguidores = ranking[0]?.seguidores || 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="section-label">Ranking de seguidores</div>
          <p className="text-sm text-txt-3">
            Quem tem mais e menos seguidores, com o saldo de ganhos e perdas de cada conta
          </p>
        </div>
        <span className="rounded-full border border-line bg-bg-2 px-2.5 py-1 text-xs text-txt-3">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />
          Atualizado {desdeQuando(ultimaColeta)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Destaque
          rotulo="Maior audiência"
          perfil={maior}
          valor={fmtInt(maior?.seguidores ?? 0)}
          legenda="seguidores"
        />
        <Destaque
          rotulo="Menor audiência"
          perfil={menor}
          valor={fmtInt(menor?.seguidores ?? 0)}
          legenda="seguidores"
        />
        <Destaque
          rotulo="Mais ganhou (24h)"
          perfil={ganho}
          valor={
            <span style={{ color: COR_GANHO }}>{fmtSaldo(ganho?.delta24h ?? 0)}</span>
          }
          legenda="saldo de seguidores"
        />
        <Destaque
          rotulo="Mais perdeu (24h)"
          perfil={perda}
          valor={<span style={{ color: COR_PERDA }}>{fmtSaldo(perda?.delta24h ?? 0)}</span>}
          legenda="saldo de seguidores"
        />
      </div>

      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-txt-1">Todos os perfis monitorados</span>
          <span className="text-xs text-txt-3">{ranking.length} contas</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="text-left text-xs text-txt-3">
                <th className="pb-2 pr-2 font-semibold">#</th>
                <th className="pb-2 pr-2 font-semibold">Perfil</th>
                <th className="pb-2 pr-2 text-right font-semibold">Seguidores</th>
                <th className="pb-2 pr-2 font-semibold">Evolução</th>
                <th className="pb-2 pr-2 text-right font-semibold">Última coleta</th>
                <th className="pb-2 text-right font-semibold">24h</th>
                <th className="pb-2 pl-2 text-right font-semibold">7 dias</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((p, i) => {
                const largura = Math.max(4, Math.round((p.seguidores / maxSeguidores) * 100));
                return (
                  <tr key={p.handle} className="border-t border-line">
                    <td className="tnum py-2 pr-2 text-xs text-txt-3">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-txt-1">@{p.handle}</span>
                        <span className="text-xs font-medium text-txt-3">{p.categoria}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-bg-2">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${largura}%`, background: BARRA_NEUTRA }}
                        />
                      </div>
                    </td>
                    <td className="tnum py-2 pr-2 text-right text-sm font-bold text-txt-1">
                      {fmtInt(p.seguidores)}
                    </td>
                    <td className="py-2 pr-2">
                      <Sparkline serie={p.serie} cor="var(--brand)" />
                    </td>
                    <td className="py-2 pr-2 text-right text-xs">
                      <Saldo v={p.deltaColeta} />
                    </td>
                    <td className="py-2 text-right text-xs">
                      <Saldo v={p.delta24h} />
                    </td>
                    <td className="py-2 pl-2 text-right text-xs">
                      <Saldo v={p.delta7d} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-txt-3">
          O Instagram publica apenas o total de seguidores de uma conta, nunca a lista de
          quem passou a seguir ou deixou de seguir. Os números acima são o saldo líquido de
          cada janela: "▲ +312" quer dizer que a conta terminou o período com 312 seguidores
          a mais, já descontadas as saídas.
        </p>
      </div>
    </div>
  );
}
