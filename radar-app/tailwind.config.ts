import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // bg-0 fica transparente (deixa o gradiente de clima aparecer);
        // bg-1/bg-2 translúcidos = vidro (backdrop-blur aplicado no index.css)
        bg: {
          0: "transparent",
          1: "rgba(255,255,255,0.07)",
          2: "rgba(255,255,255,0.05)",
          3: "rgba(255,255,255,0.10)",
        },
        line: { DEFAULT: "rgba(255,255,255,0.14)", strong: "rgba(255,255,255,0.24)" },
        txt: { 1: "#EAF0FA", 2: "#9FB0CC", 3: "#5F6E8C" },
        brand: { DEFAULT: "#3B82F6", 2: "#06B6D4" },
        accent: "#A855F7",
        risk: { low: "#22C55E", mod: "#EAB308", high: "#F97316", crit: "#EF4444" },
        sent: { pos: "#22C55E", neu: "#64748B", neg: "#EF4444" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
