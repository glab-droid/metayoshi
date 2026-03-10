/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./app/**/*.{html,js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--color-background) / <alpha-value>)',
        primary: '#f5841f', // MetaYoshi orange
        secondary: '#f6c343', // Register CTA yellow
        dark: {
          900: 'rgb(var(--color-dark-900) / <alpha-value>)',
          800: 'rgb(var(--color-dark-800) / <alpha-value>)',
          700: 'rgb(var(--color-dark-700) / <alpha-value>)',
          600: 'rgb(var(--color-dark-600) / <alpha-value>)',
        }
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
      },
      boxShadow: {
        'soft': '0 4px 12px rgba(0, 0, 0, 0.4)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
