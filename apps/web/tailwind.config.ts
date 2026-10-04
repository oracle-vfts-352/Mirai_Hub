import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Enables class-based dark mode management
  theme: {
    extend: {
      colors: {
        mirai: {
          // Light Mode Brand tokens
          bgLight: '#FFFFFF',
          accentLight: '#EF4444', // Crimson Red
          textLight: '#18181B',
          
          // Dark Mode Brand tokens
          bgDark: '#09090B',     // Stealth Black
          accentDark: '#3B82F6',    // Electric Blue
          textDark: '#F4F4F5',
        }
      },
      animation: {
        'pulse-fast': 'pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
} satisfies Config
