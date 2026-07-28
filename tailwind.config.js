/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // Tablet breakpoints used with portrait:/landscape: variants
        // e.g. portrait:tablet:grid-cols-2
        tablet: "768px",
      },
      fontFamily: {
        roboto: ['Roboto', 'sans-serif'],
        openSans: ['Open Sans', 'sans-serif'],
        lato: ['Lato', 'sans-serif'],
        montserrat: ['Montserrat', 'sans-serif'],
        poppins: ['Poppins', 'sans-serif'],
        raleway: ['Raleway', 'sans-serif'],
        oswald: ['Oswald', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
        sourceSans: ['Source Sans Pro', 'sans-serif'],
        nunito: ['Nunito', 'sans-serif'],
        aladin: ['Aladin', 'cursive'],
      },
    },
  },
  plugins: [],
};
