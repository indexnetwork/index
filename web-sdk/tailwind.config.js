/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: "jit",
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        primary: ["Inter", "sans-serif"],
        secondary: ["Freizeit", "sans-serif"],
      },
      width: {
        mobileContainer: '95vw',
      },
      maxWidth: {
        container: "560px",
      },
      backgroundColor: {
        primary: "var(--primary)",
        secondary: "var(--secondary)",
        accent: "var(--accent)",
        pale: "var(--pale)",
      },
      maxHeight: {
        container: "80vh",
      },
      fontSize: {
        "2xs": ".65rem",
      },
      maxHeight: {
        chatBody: "400px",
      },
      height: {
        chatBody: "400px",
      },
      textColor: {
        primary: "var(--primary)",
        secondary: "var(--secondary)",
      },
      borderColor: {
        default: "var(--border)",
      },
      boxShadow: {
        md: "var(--accent) 0px 0px 0.5em",
      },
      colors: {
        orange: {
          600: 'rgba(255, 54, 0, 0.05)'
        },
        grey: {
          100: '#F8FAFC',
          200: "#E2E8F0",
          600: "#1E293B",
          800: "#F9FAFB",
        },
      },
    },
  },
  plugins: [],
}