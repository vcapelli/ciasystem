// Editor de HTML compartilhado: barra de atalhos (negrito, itálico,
// título, lista, link...) + botão de pré-visualizar. Usado em qualquer
// formulário que edite conteúdo de documento.
//
// Uso:
//   container.innerHTML = htmlEditorHtml('editor-x', valorInicial);
//   ligarEditorHtml('editor-x');
//   ... na hora de salvar: document.getElementById('editor-x-textarea').value

const BOTOES_EDITOR_HTML = [
  { rotulo: '<b>B</b>', titulo: 'Negrito', abre: '<b>', fecha: '</b>' },
  { rotulo: '<i>I</i>', titulo: 'Itálico', abre: '<i>', fecha: '</i>' },
  { rotulo: '<u>S</u>', titulo: 'Sublinhado', abre: '<u>', fecha: '</u>' },
  { rotulo: 'H2', titulo: 'Título', abre: '<h2>', fecha: '</h2>' },
  { rotulo: 'H3', titulo: 'Subtítulo', abre: '<h3>', fecha: '</h3>' },
  { rotulo: 'P', titulo: 'Parágrafo', abre: '<p>', fecha: '</p>' },
  { rotulo: '<i class="fa-solid fa-list"></i>', titulo: 'Lista', abre: '<ul>\n  <li>', fecha: '</li>\n</ul>' },
  { rotulo: '<i class="fa-solid fa-link"></i>', titulo: 'Link', abre: '<a href="">', fecha: '</a>' },
  { rotulo: '<i class="fa-solid fa-minus"></i>', titulo: 'Linha horizontal', insereSozinho: '<hr>\n' },
  { rotulo: '<i class="fa-solid fa-turn-down"></i>', titulo: 'Quebra de linha', insereSozinho: '<br>\n' },
];

function htmlEditorHtml(idBase, valorInicial) {
  return `
    <div class="border border-border rounded-lg overflow-hidden">
      <div class="flex flex-wrap items-center gap-1 bg-basebg border-b border-border px-2 py-1.5">
        ${BOTOES_EDITOR_HTML.map((b, i) => `
          <button type="button" data-editor-btn="${idBase}" data-indice="${i}" title="${b.titulo}"
            class="h-7 w-7 flex items-center justify-center rounded text-xs hover:bg-border/60 transition-colors">${b.rotulo}</button>
        `).join('')}
        <span class="flex-1"></span>
        <button type="button" data-editor-preview="${idBase}" class="text-xs font-semibold px-2.5 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
          <i class="fa-solid fa-eye"></i> Pré-visualizar
        </button>
      </div>
      <textarea id="${idBase}-textarea" rows="10" class="w-full px-3 py-2 text-sm font-mono focus:outline-none">${valorInicial || ''}</textarea>
      <div id="${idBase}-preview" class="hidden px-3 py-2 text-sm bg-card"></div>
    </div>
  `;
}

function ligarEditorHtml(idBase) {
  const textarea = document.getElementById(`${idBase}-textarea`);
  const preview = document.getElementById(`${idBase}-preview`);
  const btnPreview = document.querySelector(`[data-editor-preview="${idBase}"]`);

  document.querySelectorAll(`[data-editor-btn="${idBase}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const info = BOTOES_EDITOR_HTML[Number(btn.dataset.indice)];
      const inicio = textarea.selectionStart;
      const fim = textarea.selectionEnd;
      const selecionado = textarea.value.slice(inicio, fim);

      if (info.insereSozinho) {
        textarea.setRangeText(info.insereSozinho, inicio, fim, 'end');
      } else {
        textarea.setRangeText(`${info.abre}${selecionado}${info.fecha}`, inicio, fim, 'select');
        textarea.selectionStart = inicio + info.abre.length;
        textarea.selectionEnd = inicio + info.abre.length + selecionado.length;
      }
      textarea.focus();
    });
  });

  btnPreview.addEventListener('click', () => {
    const emPreview = !preview.classList.contains('hidden');
    if (emPreview) {
      preview.classList.add('hidden');
      textarea.classList.remove('hidden');
      btnPreview.innerHTML = '<i class="fa-solid fa-eye"></i> Pré-visualizar';
    } else {
      preview.innerHTML = textarea.value;
      preview.classList.remove('hidden');
      textarea.classList.add('hidden');
      btnPreview.innerHTML = '<i class="fa-solid fa-pen"></i> Editar';
    }
  });
}
