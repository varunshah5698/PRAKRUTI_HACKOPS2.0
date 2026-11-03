import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk Variable', 'Space Grotesk', 'Inter', 'sans-serif'],
      },
      colors: {
        paper: '#f7f7f2',
        ink: '#111310',
        lime: '#b9ff66',
        dashboard: '#101317',
        surface: '#181d23',
        raised: '#202730',
        line: '#303945',
        muted: '#a2adba',
        accent: '#b5e36b',
        teal: '#56c1b3',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 19, 23, 0.04), 0 8px 24px rgba(16, 19, 23, 0.04)',
        lift: '0 18px 50px rgba(16, 19, 23, 0.12)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        marquee: 'marquee 28s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
