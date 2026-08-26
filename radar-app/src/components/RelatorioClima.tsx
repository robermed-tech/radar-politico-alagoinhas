/**
 * Card "Relatórios" da Análise do Clima (06/08/26, pedido do cliente):
 * escolhe-se o período, clica-se em IMPRIMIR RELATÓRIO e o PDF abre NA TELA,
 * com botão de baixar.
 *
 * O PDF é montado no navegador (`lib/relatorio.ts` + `lib/pdf.ts`) e exibido a
 * partir de um blob local: nada sobe para servidor nenhum. Isso importa aqui
 * mais que em outro lugar do painel — o relatório carrega @ e texto de
 * cidadãos reais, o mesmo dado que a retenção da migration 009 protege.
 *
 * O período do relatório é escolhido DENTRO do card e não herda o filtro do
 * topo da página de propósito: quem lê a tela em 7 dias frequentemente quer
 * imprimir as 24h, e uma seleção que muda sozinha ao mexer no filtro da página
 * geraria um PDF diferente do que a pessoa pediu.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchBriefing, type Comment, type Periodo, type Post } from "@/lib/data";
import { gerarRelatorioPDF } from "@/lib/relatorio";
import { PERIODOS, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { ModalShell, ModalBotaoPrimario } from "@/components/ModalShell";

/** Janela do painel -> período dos briefings gravados pelo backend. */
function periodoBriefing(dias: Dias): Periodo {
  return dias === 1 ? "dia" : dias === 7 ? "semana" : "mes";
}

function IconeRelatorio({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

interface Props {
  posts: Post[];
  comentarios: Comment[];
}

export function RelatorioClima({ posts, comentarios }: Props) {
  const qc = useQueryClient();
  const [dias, setDias] = useState<Dias>(7);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ url: string; nome: string; dias: Dias } | null>(null);
  // Guarda a URL viva para revogar no unmount sem depender do estado atual.
  const urlAtiva = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlAtiva.current) URL.revokeObjectURL(urlAtiva.current);
    };
  }, []);

  function descartar() {
    if (urlAtiva.current) {
      URL.revokeObjectURL(urlAtiva.current);
      urlAtiva.current = null;
    }
    setPdf(null);
  }

  async function imprimir() {
    setGerando(true);
    setErro(null);
    try {
      // O briefing é opcional: entra como seção a mais quando existe. Se a
      // consulta falhar (ou o período ainda não tiver briefing gerado), o
      // relatório sai assim mesmo — ele nunca depende do modelo para existir.
      const briefing = await qc
        .fetchQuery({
          queryKey: ["briefing", periodoBriefing(dias)],
          queryFn: () => fetchBriefing(periodoBriefing(dias)),
          staleTime: 5 * 60 * 1000,
        })
        .catch(() => null);

      const { blob, nomeArquivo } = gerarRelatorioPDF({
        dias, posts, comentarios, briefing: briefing ?? null,
      });
      descartar();
      const url = URL.createObjectURL(blob);
      urlAtiva.current = url;
      setPdf({ url, nome: nomeArquivo, dias });
    } catch (e) {
      setErro(`Não foi possível gerar o relatório (${(e as Error).message}).`);
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label">Relatórios</div>
          <p className="mt-1 text-sm text-txt-2">
            Um resumo do clima em PDF com os destaques do período: números, temas sob pressão,
            perfis que mobilizaram e as vozes mais curtidas.
          </p>
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs font-bold uppercase tracking-wider text-txt-3">
          Período do relatório
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            const ativo = p.dias === dias;
            return (
              <label
                key={p.dias}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                  ativo
                    ? "border-brand bg-brand text-brand-ink"
                    : "border-line bg-bg-2 text-txt-2 hover:text-txt-1"
                }`}
              >
                <input
                  type="radio"
                  name="periodo-relatorio"
                  className="h-4 w-4"
                  style={{ accentColor: ativo ? "#04242F" : "var(--brand)" }}
                  checked={ativo}
                  onChange={() => setDias(p.dias)}
                />
                {p.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={imprimir}
          disabled={gerando}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-extrabold uppercase tracking-wide text-brand-ink transition hover:opacity-90 disabled:opacity-60"
        >
          {gerando ? "Gerando…" : "Imprimir relatório"}
        </button>
        <span className="text-xs text-txt-3">
          O arquivo abre aqui na tela, com opção de baixar.
        </span>
      </div>
      {erro && (
        <p className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold"
           style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
          {erro}
        </p>
      )}

      {pdf && (
        <ModalShell
          onFechar={descartar}
          chip="Análise do clima"
          titulo={`Relatório do clima · ${periodoLabel(pdf.dias)}`}
          subtitulo="Confira o documento abaixo e baixe o arquivo."
          icone={<IconeRelatorio />}
          corIcone="#62C2CA"
          larguraMax="max-w-4xl"
          rodape={
            <>
              <a
                href={pdf.url}
                download={pdf.nome}
                className="modal-botao-primario cursor-pointer rounded-xl px-6 py-2.5 text-sm font-extrabold"
              >
                Baixar PDF
              </a>
              <ModalBotaoPrimario
                onClick={descartar}
                className="!bg-transparent !text-txt-2"
                style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
              >
                Fechar
              </ModalBotaoPrimario>
            </>
          }
        >
          {/* O visualizador de PDF do navegador já traz zoom e impressão; o
              botão de baixar existe porque em tela cheia de iframe ele nem
              sempre fica à vista. */}
          <iframe
            src={pdf.url}
            title={`Relatório do clima em ${periodoLabel(pdf.dias)}`}
            className="h-[62vh] w-full rounded-xl border border-line bg-white"
          />
          <p className="mt-2 text-[12px] text-txt-3">
            Arquivo: <span className="font-semibold text-txt-2">{pdf.nome}</span>. O documento é
            montado no seu navegador e não é enviado a nenhum servidor.
          </p>
        </ModalShell>
      )}
    </div>
  );
}
