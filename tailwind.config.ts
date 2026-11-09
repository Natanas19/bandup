import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "login-secondary": "var(--login-secondary)",
        "login-caption": "var(--login-caption)",
        "content-label": "rgb(var(--content-label) / <alpha-value>)",
        "content-faint": "rgb(var(--content-faint) / <alpha-value>)",
        "brand": "rgb(var(--brand) / <alpha-value>)",
        "brand-highlight": "rgb(var(--brand-highlight) / <alpha-value>)",
        "input-focus": "rgb(var(--input-focus) / <alpha-value>)",
        "input-ring": "rgb(var(--input-ring) / <alpha-value>)",
        "nav-border": "rgb(var(--nav-border) / <alpha-value>)",
        "nav-dot": "rgb(var(--nav-dot) / <alpha-value>)",
        "disabled-surface": "rgb(var(--disabled-surface) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        "accent-outline-hover": "rgb(var(--accent-outline-hover) / <alpha-value>)",
        "brand-hover": "rgb(var(--brand-hover) / <alpha-value>)",
        "warning-strong": "rgb(var(--warning-strong) / <alpha-value>)",
        "shadow-tint": "rgb(var(--shadow-tint) / <alpha-value>)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          muted: "rgb(var(--surface-muted) / <alpha-value>)",
          raised: "rgb(var(--surface-raised) / <alpha-value>)",
        },
        content: {
          strong: "rgb(var(--content-strong) / <alpha-value>)",
          DEFAULT: "rgb(var(--content) / <alpha-value>)",
          muted: "rgb(var(--content-muted) / <alpha-value>)",
          subtle: "rgb(var(--content-subtle) / <alpha-value>)",
        },
        outline: {
          subtle: "rgb(var(--outline-subtle) / <alpha-value>)",
          DEFAULT: "rgb(var(--outline) / <alpha-value>)",
          strong: "rgb(var(--outline-strong) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          hover: "rgb(var(--primary-hover) / <alpha-value>)",
        },
        "on-primary": "rgb(var(--on-primary) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          border: "rgb(var(--accent-border) / <alpha-value>)",
        },
        focus: "rgb(var(--focus) / <alpha-value>)",
        danger: {
          soft: "rgb(var(--danger-soft-bg) / <alpha-value>)",
          emphasis: "rgb(var(--danger-emphasis) / <alpha-value>)",
          DEFAULT: "rgb(var(--danger-text) / <alpha-value>)",
          surface: "rgb(var(--danger-bg) / <alpha-value>)",
          border: "rgb(var(--danger-border) / <alpha-value>)",
        },
        warning: {
          badge: "rgb(var(--warning-badge-bg) / <alpha-value>)",
          DEFAULT: "rgb(var(--warning-text) / <alpha-value>)",
          surface: "rgb(var(--warning-bg) / <alpha-value>)",
          border: "rgb(var(--warning-border) / <alpha-value>)",
        },
        success: {
          badge: "rgb(var(--success-badge-bg) / <alpha-value>)",
          DEFAULT: "rgb(var(--success-text) / <alpha-value>)",
          surface: "rgb(var(--success-bg) / <alpha-value>)",
          border: "rgb(var(--success-border) / <alpha-value>)",
        },
        info: {
          DEFAULT: "rgb(var(--info-text) / <alpha-value>)",
          surface: "rgb(var(--info-bg) / <alpha-value>)",
          border: "rgb(var(--info-border) / <alpha-value>)",
        },
        decorative: {
          start: "rgb(var(--decorative-start) / <alpha-value>)",
          end: "rgb(var(--decorative-end) / <alpha-value>)",
          glow: "rgb(var(--decorative-glow) / <alpha-value>)",
        },
      },
      boxShadow: {
        "app-dashboard": "var(--shadow-dashboard)",
        "app-form": "var(--shadow-form)",
        "app-card": "var(--shadow-card)",
        "app-panel": "var(--shadow-panel)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Arial", "Helvetica", "sans-serif"],
        mono: ["Courier New", "monospace"],
      },
      borderRadius: {
        card: "var(--radius-card)",
        control: "var(--radius-control)",
        panel: "var(--radius-panel)",
      },
    },
  },
  plugins: [],
};

export default config;
