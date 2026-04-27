import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        surface: "#131316",
        border: "#1f1f24",
        accent: "#7c5cff",
        muted: "#7a7a85",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter"],
      },
    },
  },
  plugins: [],
};

export default config;
