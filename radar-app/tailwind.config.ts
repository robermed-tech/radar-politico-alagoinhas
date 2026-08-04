import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Piso tipográfico maior (25/07, ampliado em 27/07 junto com o peso das
      // fontes) — xs/sm sobem sobre o default do Tailwind para melhorar a
      // leitura no telão e em TVs.
      fontSize: {
        xs: ["14px", { lineHeight: "1.42" }],
        sm: ["16px", { lineHeight: "1.48" }],
      },
      colors: {
        // Tokens sensíveis ao tema (CSS vars definidas em index.css: .theme-dark / .theme-light)
        bg: {
          0: "transparent",
          1: "var(--g1)",
          2: "var(--g2)",
          3: "var(--g3)",
          page: "var(--bg-page)",
          card: "var(--bg-card)",
        },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)", card: "var(--border-card)" },
        txt: { 1: "var(--txt1)", 2: "var(--txt2)", 3: "var(--txt3)" },
        // Marca — laranja de interação, único hex nos dois temas desde 31/07
        // (ver o comentário de --brand no index.css). accent é alias de brand
        // (mesma cor, dois nomes) para reaproveitar os 40+ usos existentes de
        // bg-brand/text-brand sem duplicar o token. `ink` é a tinta quase
        // preta para texto SOBRE um preenchimento brand (mesmo par que
        // `lime.ink` já usava): branco sobre #F79641 mede 2,24:1 e reprova o
        // AA; `ink` mede 8,44:1. `2` e `skycard` eram cópias hardcoded do
        // brand de antes da unificação (uma delas presa ao tom do tema
        // escuro) — viram alias do token único para não haver uma terceira
        // fonte de laranja no app.
        brand: { DEFAULT: "var(--brand)", 2: "var(--brand)", ink: "#1A0F02" },
        accent: "var(--accent)",
        risk: { low: "#22C55E", mod: "#EAB308", high: "#EF8C00", crit: "#EF4444" },
        sent: { pos: "#22C55E", neu: "#64748B", neg: "#EF4444" },
        // Semânticas genéricas de UI — distintas do sistema de clima/risco
        // (risk.*/sent.* continuam sendo a fonte de verdade para estado de alerta).
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        // Acentos do estilo "clean" (referência) — agora em laranja
        lime: { DEFAULT: "#BEDB1D", ink: "#1A2400" },
        skycard: { DEFAULT: "var(--brand)", deep: "var(--brand)" },
      },
      // Duas famílias com papéis distintos (briefing de 03/08): Space Grotesk
      // carrega título, rótulo de card e NÚMERO (as formas geométricas e o
      // corte reto dos dígitos sustentam corpo grande sem virar peso morto);
      // Inter carrega o texto corrido, que é onde a leitura acontece. Não
      // trocar `sans` por uma display: o painel tem parágrafo de análise e
      // citação de cidadão, e display em corpo pequeno cansa.
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
