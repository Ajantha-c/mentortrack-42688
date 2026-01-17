/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      boxShadow: {
        glass: "0 20px 60px rgba(0,0,0,0.25)",
      },
    },
  },
  plugins: [],
};
