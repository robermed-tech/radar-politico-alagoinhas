import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tokens sensíveis ao tema (CSS vars definidas em index.css: .theme-dark / .theme-light)
        bg: {
          0: "transparent",
          1: "var(--g1)",
          2: "var(--g2)",
          3: "var(--g3)",
        },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        txt: { 1: "var(--txt1)", 2: "var(--txt2)", 3: "var(--txt3)" },
        brand: { DEFAULT: "#F97316", 2: "#FB923C" },
        accent: "#A855F7",
        risk: { low: "#22C55E", mod: "#EAB308", high: "#F97316", crit: "#EF4444" },
        sent: { pos: "#22C55E", neu: "#64748B", neg: "#EF4444" },
        // Acentos do estilo "clean" (referência) — agora em laranja
        lime: { DEFAULT: "#BEDB1D", ink: "#1A2400" },
        skycard: { DEFAULT: "#FB923C", deep: "#EA580C" },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
