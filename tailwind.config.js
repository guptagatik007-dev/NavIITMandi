/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // tokens mirror src/styles/tokens.css — single source of truth is the CSS
        pine: { 900: '#0b1210', 800: '#101a17', 700: '#16241f', 600: '#1e3129' },
        mist: { 400: '#8ba39b', 200: '#c8d6d1', 100: '#e8efec' },
        accent: { DEFAULT: '#5eead4', dim: '#2dd4bf', deep: '#0f766e' },
        warn: '#fbbf24',
        danger: '#f87171',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
        rail: '0 2px 12px rgba(0,0,0,0.28)',
      },
    },
  },
  plugins: [],
};
