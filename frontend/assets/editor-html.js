// Editor de HTML compartilhado: barra de atalhos (negrito, itálico,
// título, lista, link, cor, tamanho, alinhamento...) + botão de
// pré-visualizar. Usado em qualquer formulário que edite conteúdo em
// HTML (documentos, aulas, notícias, e-mails...).
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

const TAMANHOS_EDITOR_HTML = [
  { rotulo: 'Pequeno', valor: '0.8em' },
  { rotulo: 'Normal', valor: '1em' },
  { rotulo: 'Grande', valor: '1.3em' },
  { rotulo: 'Enorme', valor: '1.8em' },
];

const ALINHAMENTOS_EDITOR_HTML = [
  { valor: 'left', icone: 'fa-solid fa-align-left', titulo: 'Alinhar à esquerda' },
  { valor: 'center', icone: 'fa-solid fa-align-center', titulo: 'Centralizar' },
  { valor: 'right', icone: 'fa-solid fa-align-right', titulo: 'Alinhar à direita' },
  { valor: 'justify', icone: 'fa-solid fa-align-justify', titulo: 'Justificar' },
];

function htmlEditorHtml(idBase, valorInicial) {
  return `
    <div class="border border-border rounded-lg overflow-hidden">
      <div class="flex flex-wrap items-center gap-1 bg-basebg border-b border-border px-2 py-1.5">
        ${BOTOES_EDITOR_HTML.map((b, i) => `
          <button type="button" data-editor-btn="${idBase}" data-indice="${i}" title="${b.titulo}"
            class="h-7 w-7 flex items-center justify-center rounded text-xs hover:bg-border/60 transition-colors">${b.rotulo}</button>
        `).join('')}

        <span class="w-px h-5 bg-border mx-0.5"></span>

        <input type="color" id="${idBase}-cor" title="Cor do texto" value="#000000"
          class="h-7 w-7 rounded cursor-pointer bg-transparent border border-border">

        <select id="${idBase}-tamanho" title="Tamanho da fonte"
          class="h-7 bg-card border border-border rounded text-xs px-1 focus:outline-none">
          <option value="">Tamanho…</option>
          ${TAMANHOS_EDITOR_HTML.map((t) => `<option value="${t.valor}">${t.rotulo}</option>`).join('')}
        </select>

        <span class="w-px h-5 bg-border mx-0.5"></span>

        ${ALINHAMENTOS_EDITOR_HTML.map((a) => `
          <button type="button" data-editor-alinhar="${idBase}" data-valor="${a.valor}" title="${a.titulo}"
            class="h-7 w-7 flex items-center justify-center rounded text-xs hover:bg-border/60 transition-colors"><i class="${a.icone}"></i></button>
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

  function envolverSelecao(abre, fecha) {
    const inicio = textarea.selectionStart;
    const fim = textarea.selectionEnd;
    const selecionado = textarea.value.slice(inicio, fim);
    textarea.setRangeText(`${abre}${selecionado}${fecha}`, inicio, fim, 'select');
    textarea.selectionStart = inicio + abre.length;
    textarea.selectionEnd = inicio + abre.length + selecionado.length;
    textarea.focus();
  }

  document.querySelectorAll(`[data-editor-btn="${idBase}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const info = BOTOES_EDITOR_HTML[Number(btn.dataset.indice)];
      if (info.insereSozinho) {
        const inicio = textarea.selectionStart;
        const fim = textarea.selectionEnd;
        textarea.setRangeText(info.insereSozinho, inicio, fim, 'end');
        textarea.focus();
      } else {
        envolverSelecao(info.abre, info.fecha);
      }
    });
  });

  const corInput = document.getElementById(`${idBase}-cor`);
  corInput.addEventListener('input', () => {
    envolverSelecao(`<span style="color: ${corInput.value}">`, '</span>');
  });

  const tamanhoSelect = document.getElementById(`${idBase}-tamanho`);
  tamanhoSelect.addEventListener('change', () => {
    if (!tamanhoSelect.value) return;
    envolverSelecao(`<span style="font-size: ${tamanhoSelect.value}">`, '</span>');
    tamanhoSelect.value = '';
  });

  document.querySelectorAll(`[data-editor-alinhar="${idBase}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      envolverSelecao(`<div style="text-align: ${btn.dataset.valor}">`, '</div>');
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
