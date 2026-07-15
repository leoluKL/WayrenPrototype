/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg)',
        surface: 'var(--bg-surface)',
        hover: 'var(--bg-hover)',
        border: 'var(--border)',
        main: 'var(--text)',
        dim: 'var(--text-dim)',
        accent: 'var(--accent)',
        ok: 'var(--green)',
        err: 'var(--red)',
      },
    },
  },
  plugins: [],
}
