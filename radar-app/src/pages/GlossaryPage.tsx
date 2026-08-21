interface Secao {
  icon: string;
  titulo: string;
  oque: string;
  porque: string;
  decisao: string;
}

const SECOES: Secao[] = [
  {
    icon: "☀",
    titulo: "Clima Político",
    oque: "O termômetro visual da opinião pública. Resume em uma única tela — com metáfora de clima (sol, nuvem, chuva, tempestade) — se o momento é favorável ou de crise.",
    porque: "É o painel de entrada: em 2 segundos o gestor sabe se 'está tudo bem' ou se precisa agir. Mostra também o volume de posts e comentários coletados no período.",
    decisao: "Define o tom do dia: posso seguir a agenda normal (céu aberto) ou preciso convocar a equipe de comunicação (tempestade)?",
  },
  {
    icon: "◉",
    titulo: "Comando",
    oque: "A visão geral consolidada: os índices ao vivo (Aprovação, Confiança, Risco) e a evolução do sentimento no período, em um só lugar.",
    porque: "Reúne os números-chave que normalmente estariam espalhados. É o 'cockpit' — onde se acompanha a saúde da imagem de forma contínua.",
    decisao: "Vale a pena ampliar uma campanha positiva? O risco subiu o suficiente para mudar prioridades esta semana?",
  },
  {
    icon: "✦",
    titulo: "Central de Crises",
    oque: "Histórico do nível de risco (Baixo → Crítico) ao longo dos dias, mais os planos de contenção gerados pelo Agente Caçador de Crises para cada post de alto risco.",
    porque: "Separa o barulho da crise real. Um agente de IA avalia cada alerta e diz se é crise verdadeira — e, se for, entrega um plano de ação concreto com prazo.",
    decisao: "Esta queixa vai viralizar? Devo responder em 4h ou apenas monitorar? Qual o passo a passo para conter?",
  },
  {
    icon: "✧",
    titulo: "Assistente Estratégico (IA)",
    oque: "Um briefing diário gerado por IA: diagnóstico da imagem, oportunidades, alertas e recomendações concretas de comunicação (canal, mensagem, tom, timing).",
    porque: "Transforma dados em ação. Em vez de gráficos, entrega 'o que fazer hoje' — como um chefe de gabinete que leu tudo e resume as prioridades.",
    decisao: "Quais 3 ações de comunicação tomar hoje? Que mensagem publicar, em qual canal e com que tom?",
  },
  {
    icon: "▲",
    titulo: "Aprovação Digital",
    oque: "O detalhamento do índice de aprovação (IAD): quem aprova e quem rejeita, por categoria, por perfil e por tema — com as vozes (comentários) mais curtidas de cada lado.",
    porque: "Responde 'por que' a aprovação está num nível. Mostra se o apoio vem da base, da imprensa ou se está concentrado em poucos temas.",
    decisao: "Qual público sustenta minha aprovação? Em que tema estou bem e em qual preciso melhorar a comunicação?",
  },
  {
    icon: "∿",
    titulo: "Tendências",
    oque: "A evolução de cada tema ao longo do tempo. Mostra o que está subindo, estável ou caindo — em volume, sentimento negativo, positivo ou risco.",
    porque: "Antecipa problemas. Um tema com críticas crescendo há dias é um alerta precoce — dá tempo de agir antes de virar crise.",
    decisao: "Que assunto está esquentando? Devo me antecipar a um tema que vem ganhando críticas nas últimas duas semanas?",
  },
  {
    icon: "✷",
    titulo: "Influenciadores",
    oque: "Ranking de quem mais move a opinião — perfis monitorados e cidadãos — com score de influência (alcance × engajamento) e alinhamento (aliado, neutro, opositor).",
    porque: "Mapeia o jogo de forças. Saber quem amplifica mensagens (a favor ou contra) orienta com quem dialogar e quem monitorar de perto.",
    decisao: "Quem são meus aliados digitais a fortalecer? Quais opositores concentram a crítica e merecem atenção?",
  },
  {
    icon: "❋",
    titulo: "Narrativas",
    oque: "Os temas em circulação agrupados por assunto e tom, com origem (quem iniciou), amplificação e — crucial — detecção de campanhas coordenadas (contas postando textos quase idênticos).",
    porque: "Revela mobilização organizada. Distingue a indignação espontânea de uma campanha articulada (de oposição ou de apoio), que exige resposta diferente.",
    decisao: "Esta crítica é orgânica ou é uma campanha coordenada? Quem iniciou a narrativa e quem a está espalhando?",
  },
];

interface Indice {
  sigla: string;
  nome: string;
  oque: string;
  escala: string;
}

const INDICES: Indice[] = [
  {
    sigla: "IAD",
    nome: "Índice de Aprovação Digital",
    oque: "Mede o quanto a opinião pública é favorável, com base no sentimento dos comentários dos cidadãos, dando mais peso aos comentários com mais curtidas.",
    escala: "0 (rejeição total) a 100 (aprovação total)",
  },
  {
    sigla: "ICA",
    nome: "Índice de Confiança da Amostra",
    oque: "Mede o quanto se pode confiar na leitura: leva em conta o volume de dados, a diversidade de fontes e a recência. Evita conclusões fortes com poucos dados.",
    escala: "0 (amostra fraca) a 100 (amostra robusta). Abaixo de 40 = 'amostra insuficiente'.",
  },
  {
    sigla: "Nível",
    nome: "Nível de Alerta",
    oque: "Classificação qualitativa do momento político: Baixo, Moderado, Alto ou Crítico. Derivada do IAD, da presença de posts de alto risco e da velocidade de crescimento das críticas.",
    escala: "Baixo · Moderado · Alto · Crítico — leia sempre junto com o IAD para decidir a urgência da resposta.",
  },
  {
    sigla: "Coord.",
    nome: "Coordenação",
    oque: "Detecta quando contas diferentes postam comentários quase idênticos — sinal de campanha organizada (militância, disparo ou bots), em vez de reação espontânea.",
    escala: "Lista de grupos com texto, contas envolvidas e sentimento.",
  },
];

function Card({ s }: { s: Secao }) {
  return (
    <div className="card-hover rounded-2xl border border-line bg-bg-1 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-bg-3 text-lg font-bold text-brand-2">
          {s.icon}
        </span>
        <h3 className="text-lg font-extrabold text-txt-1">{s.titulo}</h3>
      </div>
      <div className="space-y-2.5 text-[15px] leading-relaxed">
        <p className="text-txt-2">
          <span className="font-bold text-txt-1">O que é: </span>
          {s.oque}
        </p>
        <p className="text-txt-2">
          <span className="font-bold" style={{ color: "#38BDF8" }}>Por que importa: </span>
          {s.porque}
        </p>
        <div className="rounded-lg border-l-2 border-brand bg-brand/5 px-3 py-2 text-txt-1">
          <span className="font-bold">Decisão que ajuda a tomar: </span>
          {s.decisao}
        </div>
      </div>
    </div>
  );
}

export function GlossaryPage() {
  return (
    <div className="space-y-5 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Glossário da Central de Comando</h1>
        <p className="mt-1 max-w-2xl text-sm text-txt-2">
          Um guia didático de cada área da plataforma: o que é, por que existe e qual decisão
          ela ajuda a tomar. Pensado para que qualquer pessoa do gabinete use os dados com confiança.
        </p>
      </div>

      {/* Como ler a plataforma */}
      <div className="card-hover rounded-2xl border border-line bg-bg-1 p-5">
        <h2 className="text-base font-extrabold text-txt-1">Como a plataforma funciona (em 1 minuto)</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-txt-2">
          A cada poucas horas, um robô (o <b>AGORA</b>) coleta os posts e comentários das redes sobre o
          prefeito e a gestão. Uma <b>IA</b> lê cada comentário e classifica o sentimento <i>sob a ótica do
          prefeito</i> (apoio a opositor = negativo). Esses dados viram <b>índices</b> e <b>alertas</b> que
          alimentam as 8 áreas abaixo. Tudo é atualizado sozinho — o gabinete só lê e decide.
        </p>
      </div>

      {/* Seções */}
      <div>
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-txt-3">
          As 8 áreas da Central
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {SECOES.map((s) => (
            <Card key={s.titulo} s={s} />
          ))}
        </div>
      </div>

      {/* Índices */}
      <div>
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-txt-3">
          Os números-chave (índices)
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {INDICES.map((i) => (
            <div key={i.sigla} className="card-hover rounded-2xl border border-line bg-bg-1 p-5">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-extrabold" style={{ color: "#38BDF8" }}>{i.sigla}</span>
                <span className="text-sm font-semibold text-txt-2">{i.nome}</span>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-txt-2">{i.oque}</p>
              <div className="mt-2 text-[13px] text-txt-3">
                <span className="font-bold">Escala: </span>{i.escala}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Escala de clima */}
      <div className="card-hover rounded-2xl border border-line bg-bg-1 p-5">
        <h2 className="text-base font-extrabold text-txt-1">A metáfora do clima</h2>
        <p className="mt-1 text-[14px] text-txt-2">
          A aprovação (IAD) vira uma condição de clima — fácil de entender num olhar:
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[14px] text-txt-2 sm:grid-cols-3">
          <div>☀️ <b className="text-txt-1">Céu Aberto</b> · 75-100 · ótimo</div>
          <div>⛅ <b className="text-txt-1">Parc. Nublado</b> · 60-74 · bom</div>
          <div>☁️ <b className="text-txt-1">Nublado</b> · 45-59 · dividido</div>
          <div>🌧️ <b className="text-txt-1">Chuva</b> · 30-44 · ruim</div>
          <div>⛈️ <b className="text-txt-1">Tempestade</b> · 15-29 · crise</div>
          <div>🌑 <b className="text-txt-1">Extremo</b> · 0-14 · crítico</div>
        </div>
      </div>

      <div className="pb-4 text-center text-[13px] text-txt-3">
        Viratempo · inteligência para decisões: não substitui o julgamento humano, o potencializa.
      </div>
    </div>
  );
}
