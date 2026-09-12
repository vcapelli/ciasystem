// Configuração do Tailwind (via CDN) compartilhada por todas as
// páginas — carregar logo depois de <script src="https://cdn.tailwindcss.com">.
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],          // texto corrido, menu, botões
        display: ['industry', 'Oswald', 'sans-serif'], // títulos grandes e a marca
      },
      colors: {
        basebg: '#eef0f3',  // fundo geral das páginas internas
        card: '#ffffff',    // cards e superfícies
        border: '#e2e4e9',
        muted: '#6b7280',
        dark: '#212529',    // barra/cabeçalho escuro (navbar, topo dos cards)
        accent: { DEFAULT: '#046b2f', dark: '#035423' }, // verde do botão principal
      },
      borderRadius: { '2xl': '1.25rem' },
    },
  },
};
