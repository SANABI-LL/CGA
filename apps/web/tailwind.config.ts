import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        maroon: {
          DEFAULT: '#800000',
          dark: '#5C0000',
          light: '#A01010',
        },
        amber: {
          campus: '#C4903A',
        },
        surface: {
          DEFAULT: '#242020',
          raised: '#2E2A27',
          footer: '#3D3530',
        },
        map: {
          dark: '#1A1714',
        },
        greystone: {
          light: '#B9B0A2',
          dark: '#5C5248',
        },
      },
      fontFamily: {
        serif: ['"EB Garamond"', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
