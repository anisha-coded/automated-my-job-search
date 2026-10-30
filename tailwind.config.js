/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18231f",
        moss: "#567565",
        canvas: "#f6f7f3",
      },
    },
  },
  plugins: [],
};
