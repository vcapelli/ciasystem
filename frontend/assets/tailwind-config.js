// Configuração do Tailwind (via CDN) compartilhada por todas as
// páginas — carregar logo depois de <script src="https://cdn.tailwindcss.com">.
tailwind.config = {
  theme: {
    extend: {
      fontFamily: { sans: ['Plus Jakarta Sans', 'sans-serif'] },
      colors: {
        base: '#121218',
        card: '#1b1b24',
        border: '#2a2a36',
        muted: '#8f8fa3',
        amber: { DEFAULT: '#f2a93b', dark: '#d9932a' },
      },
      borderRadius: { '2xl': '1.25rem' },
    },
  },
};
