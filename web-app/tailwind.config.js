/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",

    // Or if using `src` directory:
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        mainDark: "#131620",
        primary: "#ffffff",
        secondary: "#4192F1",
        passiveLight: "#D5DDF0",
        passiveDark: "#0D0D0D",
        highlightBlue: "#3992FF",
      },
      fontFamily: {
        title: ["Roquefort", "sans-serif"],
        primary: ["Inter", "sans-serif"],
        secondary: ["Freizeit", "sans-serif"],
      },
      screens: {
        lg: "1200px",
      },
      spacing: {
        12: "3rem",
      },
    },
  },
  plugins: [],
};
