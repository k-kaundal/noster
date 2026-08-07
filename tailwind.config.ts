import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: {
				DEFAULT: '1rem',
				sm: '1.5rem',
				lg: '2rem',
			},
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				surface: 'hsl(var(--surface))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))',
				},
				brand: {
					from: 'hsl(var(--brand-from))',
					to: 'hsl(var(--brand-to))',
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				success: {
					DEFAULT: 'hsl(var(--success))',
					foreground: 'hsl(var(--success-foreground))'
				},
				warning: {
					DEFAULT: 'hsl(var(--warning))',
					foreground: 'hsl(var(--warning-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				/* Interaction colors used by post action buttons */
				like: 'hsl(var(--like))',
				repost: 'hsl(var(--repost))',
				reply: 'hsl(var(--reply))',
				zap: 'hsl(var(--zap))',
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				}
			},
			borderRadius: {
				'3xl': 'calc(var(--radius) + 12px)',
				'2xl': 'calc(var(--radius) + 8px)',
				xl: 'calc(var(--radius) + 4px)',
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 4px)',
				sm: 'calc(var(--radius) - 8px)'
			},
			transitionTimingFunction: {
				spring: 'var(--ease-spring)',
				snap: 'var(--ease-snap)',
				quart: 'var(--ease-out-quart)',
			},
			boxShadow: {
				/* Resting surfaces separate with a border; these are for things
				   that genuinely float above the page. */
				card: '0 1px 2px -1px hsl(var(--shadow-color) / calc(0.1 * var(--shadow-strength)))',
				'card-hover': '0 1px 3px -1px hsl(var(--shadow-color) / calc(0.14 * var(--shadow-strength)))',
				float: '0 2px 4px -2px hsl(var(--shadow-color) / 0.08), 0 12px 28px -8px hsl(var(--shadow-color) / 0.12)',
			},
			keyframes: {
				'accordion-down': {
					from: { height: '0' },
					to: { height: 'var(--radix-accordion-content-height)' }
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: '0' }
				},
				'fade-in': {
					from: { opacity: '0' },
					to: { opacity: '1' }
				},
				'slide-up': {
					from: { opacity: '0', transform: 'translateY(12px)' },
					to: { opacity: '1', transform: 'translateY(0)' }
				},
				'slide-down': {
					from: { opacity: '0', transform: 'translateY(-8px)' },
					to: { opacity: '1', transform: 'translateY(0)' }
				},
				'slide-right': {
					from: { opacity: '0', transform: 'translateX(-8px)' },
					to: { opacity: '1', transform: 'translateX(0)' }
				},
				'scale-in': {
					from: { opacity: '0', transform: 'scale(0.96)' },
					to: { opacity: '1', transform: 'scale(1)' }
				},
				shimmer: {
					'100%': { transform: 'translateX(100%)' }
				},
				'spin-slow': {
					from: { transform: 'rotate(0deg)' },
					to: { transform: 'rotate(360deg)' }
				},
				/* A slow pulse for live indicators, gentler than `animate-pulse` */
				breathe: {
					'0%, 100%': { opacity: '1', transform: 'scale(1)' },
					'50%': { opacity: '0.7', transform: 'scale(0.92)' }
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s var(--ease-snap)',
				'accordion-up': 'accordion-up 0.2s var(--ease-snap)',
				'fade-in': 'fade-in 0.3s ease-out both',
				'slide-up': 'slide-up 0.45s var(--ease-spring) both',
				'slide-down': 'slide-down 0.35s var(--ease-spring) both',
				'slide-right': 'slide-right 0.35s var(--ease-spring) both',
				'scale-in': 'scale-in 0.28s var(--ease-spring) both',
				shimmer: 'shimmer 1.8s infinite',
				'spin-slow': 'spin-slow 8s linear infinite',
				breathe: 'breathe 4s ease-in-out infinite'
			}
		}
	},
	plugins: [tailwindcssAnimate, typography],
} satisfies Config;
