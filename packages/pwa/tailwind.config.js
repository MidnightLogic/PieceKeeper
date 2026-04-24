export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  darkMode: 'class',
  safelist: [
    'bg-amber-600', 'dark:bg-amber-700',
    'bg-rose-700', 'dark:bg-rose-800',
    'bg-emerald-600', 'dark:bg-emerald-700',
    'bg-slate-500', 'dark:bg-slate-600',
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          850: '#151e2e',
        }
      }
    },
  },
  plugins: [],
}
