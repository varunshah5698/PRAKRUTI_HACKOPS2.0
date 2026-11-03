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
        mist: '#e7ede7',
        leaf: '#4e9b3f',
        moss: '#142016',
        dashboard: '#e7ede7',
        surface: '#ffffff',
        raised: '#f4f8f1',
        line: '#dce5d8',
        muted: '#5a6a5f',
        accent: '#4e9b3f',
        teal: '#2f8f84',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 19, 23, 0.04), 0 8px 24px rgba(16, 19, 23, 0.04)',
        lift: '0 18px 50px rgba(16, 19, 23, 0.12)',
        glass: 'inset 0 1px 0 rgba(255,255,255,.85), 0 20px 48px -34px rgba(23,42,29,.38)',
        pill: 'inset 0 1px 0 rgba(255,255,255,.9), 0 10px 26px -22px rgba(23,42,29,.4)',
        frame: '0 50px 120px -60px rgba(28,45,34,.42), inset 0 1px 0 rgba(255,255,255,.7)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
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
