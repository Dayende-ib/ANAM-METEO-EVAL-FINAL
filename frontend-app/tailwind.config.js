/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#0F766E",
        secondary: "#2563EB",
        accent: "#F97316",
        "background-light": "#F2F5F1",
        "background-dark": "#0F1412",
        "surface-light": "#FFFFFF",
        "surface-dark": "#141B17",
        "text-light": "#1F2A24",
        "text-dark": "#E6F1EA",
        "text-muted-light": "#5B6A63",
        "text-muted-dark": "#9FB0A6",
        "burkina-red": "#EF7D31",
        "burkina-green": "#0F766E",
        "burkina-gold": "#F59E0B",
      },
      fontFamily: {
        display: ["Space Grotesk", "IBM Plex Sans", "sans-serif"],
        body: ["IBM Plex Sans", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        full: "9999px",
      },
    },
  },
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
};

