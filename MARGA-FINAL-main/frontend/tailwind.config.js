/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        headline: ['Orbitron', 'sans-serif'],
        sans: ['Rajdhani', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      colors: {
        slate: {
          850: '#131c2e',
          950: '#090d16',
        },
      },
    },
  },
  plugins: [],
}
