import type { Config } from 'tailwindcss';
import { Z_INDEX } from './src/lib/ui/z-index';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1280px' },
    },
    extend: {
      // Named layers instead of ad-hoc numbers — see src/lib/ui/z-index.ts.
      zIndex: Object.fromEntries(
        Object.entries(Z_INDEX).map(([name, value]) => [name, String(value)]),
      ) as Record<keyof typeof Z_INDEX, string>,
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand-primary) / <alpha-value>)',
          secondary: 'rgb(var(--brand-secondary) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent1) / <alpha-value>)',
          accent2: 'rgb(var(--brand-accent2) / <alpha-value>)',
        },
        surface: 'rgb(var(--brand-background) / <alpha-value>)',
        content: 'rgb(var(--brand-text) / <alpha-value>)',
        muted: 'rgb(var(--brand-muted) / <alpha-value>)',
        hairline: 'rgb(var(--brand-border) / <alpha-value>)',
        // Admin shell — see the --admin-* tokens in globals.css. Mapped as
        // colours so every translucent overlay the dark chrome needs is an
        // alpha modifier (`bg-admin-nav/[0.08]`) rather than a literal.
        'admin-sidebar': 'rgb(var(--admin-sidebar-bg) / <alpha-value>)',
        'admin-header': 'rgb(var(--admin-header-bg) / <alpha-value>)',
        'admin-nav': 'rgb(var(--admin-nav-fg) / <alpha-value>)',
        'admin-workspace': 'rgb(var(--admin-workspace-bg) / <alpha-value>)',
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Popovers and the search panel: a short fade with a slight drop.
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.985)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'slide-up': 'slide-up .25s ease-out',
        'pop-in': 'pop-in .16s cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
};

export default config;
