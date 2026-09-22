// Editor de HTML compartilhado: barra de atalhos (negrito, itálico,
// título, lista, link, cor, tamanho, alinhamento...) + alternância
// entre modo Visual (formata e mostra na hora, edição direta sobre o
// conteúdo renderizado) e modo Código (o HTML puro, pra ajustes finos
// ou colar marcação pronta). Usado em qualquer formulário que edite
// conteúdo em HTML (documentos, aulas, notícias, e-mails, projetos...).
//
// Uso:
//   container.innerHTML = htmlEditorHtml('editor-x', valorInicial);
//   ligarEditorHtml('editor-x');
//   ... na hora de salvar: document.getElementById('editor-x-textarea').value
//
// O contrato pro resto do app não muda: o HTML sempre atual mora em
// `#{idBase}-textarea` (agora normalmente escondido, só visível no
// modo Código) — todo código existente que lê `.value` desse textarea
// continua funcionando sem qualquer alteração, seja qual for o modo em
// que a pessoa deixou o editor. O modo Visual (`#{idBase}-visual`, um
// `contenteditable`) é só uma segunda forma de editar o mesmo
// conteúdo, sincronizada com o textarea a cada mudança e a cada troca
// de modo.

const BOTOES_EDITOR_HTML = [
  { rotulo: '<b>B</b>', titulo: 'Negrito', abre: '<b>', fecha: '</b>', comando: 'bold' },
  { rotulo: '<i>I</i>', titulo: 'Itálico', abre: '<i>', fecha: '</i>', comando: 'italic' },
  { rotulo: '<u>S</u>', titulo: 'Sublinhado', abre: '<u>', fecha: '</u>', comando: 'underline' },
  { rotulo: 'H2', titulo: 'Título', abre: '<h2>', fecha: '</h2>', comando: 'formatBlock', comandoValor: 'H2' },
  { rotulo: 'H3', titulo: 'Subtítulo', abre: '<h3>', fecha: '</h3>', comando: 'formatBlock', comandoValor: 'H3' },
  { rotulo: 'P', titulo: 'Parágrafo', abre: '<p>', fecha: '</p>', comando: 'formatBlock', comandoValor: 'P' },
  { rotulo: '<i class="fa-solid fa-list"></i>', titulo: 'Lista', abre: '<ul>\n  <li>', fecha: '</li>\n</ul>', comando: 'insertUnorderedList' },
  { rotulo: '<i class="fa-solid fa-link"></i>', titulo: 'Link', abre: '<a href="">', fecha: '</a>', comando: 'link' },
  { rotulo: '<i class="fa-solid fa-minus"></i>', titulo: 'Linha horizontal', insereSozinho: '<hr>\n', comando: 'insertHorizontalRule' },
  { rotulo: '<i class="fa-solid fa-turn-down"></i>', titulo: 'Quebra de linha', insereSozinho: '<br>\n', comando: 'insertLineBreak' },
];

const TAMANHOS_EDITOR_HTML = [
  { rotulo: 'Pequeno', valor: '0.8em' },
  { rotulo: 'Normal', valor: '1em' },
  { rotulo: 'Grande', valor: '1.3em' },
  { rotulo: 'Enorme', valor: '1.8em' },
];

const ALINHAMENTOS_EDITOR_HTML = [
  { valor: 'left', icone: 'fa-solid fa-align-left', titulo: 'Alinhar à esquerda', comando: 'justifyLeft' },
  { valor: 'center', icone: 'fa-solid fa-align-center', titulo: 'Centralizar', comando: 'justifyCenter' },
  { valor: 'right', icone: 'fa-solid fa-align-right', titulo: 'Alinhar à direita', comando: 'justifyRight' },
  { valor: 'justify', icone: 'fa-solid fa-align-justify', titulo: 'Justificar', comando: 'justifyFull' },
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
          <button type="button" data-editor-alinhar="${idBase}" data-valor="${a.valor}" data-comando="${a.comando}" title="${a.titulo}"
            class="h-7 w-7 flex items-center justify-center rounded text-xs hover:bg-border/60 transition-colors"><i class="${a.icone}"></i></button>
        `).join('')}

        <span class="flex-1"></span>
        <div class="flex items-center rounded-lg border border-border overflow-hidden text-xs font-semibold">
          <button type="button" data-editor-modo="${idBase}" data-valor="visual" class="px-2.5 py-1 transition-colors" title="Escreve e já vê formatado">
            <i class="fa-solid fa-eye"></i> Visual
          </button>
          <button type="button" data-editor-modo="${idBase}" data-valor="codigo" class="px-2.5 py-1 transition-colors" title="Edita o HTML puro">
            <i class="fa-solid fa-code"></i> Código
          </button>
        </div>
      </div>
      <div id="${idBase}-visual" contenteditable="true" class="prose-editor-html min-h-[160px] max-h-[420px] overflow-y-auto px-3 py-2 text-sm focus:outline-none">${valorInicial || ''}</div>
      <textarea id="${idBase}-textarea" rows="10" class="hidden w-full px-3 py-2 text-sm font-mono focus:outline-none">${valorInicial || ''}</textarea>
    </div>
  `;
}

function ligarEditorHtml(idBase) {
  const textarea = document.getElementById(`${idBase}-textarea`);
  const visual = document.getElementById(`${idBase}-visual`);
  const btnModoVisual = document.querySelector(`[data-editor-modo="${idBase}"][data-valor="visual"]`);
  const btnModoCodigo = document.querySelector(`[data-editor-modo="${idBase}"][data-valor="codigo"]`);
  let modo = 'visual';

  function marcarBotaoModoAtivo() {
    const ativa = 'bg-accent text-white';
    const inativa = 'bg-card text-muted hover:bg-border/40';
    btnModoVisual.className = `px-2.5 py-1 transition-colors ${modo === 'visual' ? ativa : inativa}`;
    btnModoCodigo.className = `px-2.5 py-1 transition-colors ${modo === 'codigo' ? ativa : inativa}`;
  }

  function irParaModo(novoModo) {
    if (novoModo === modo) return;
    if (novoModo === 'codigo') {
      textarea.value = visual.innerHTML;
      visual.classList.add('hidden');
      textarea.classList.remove('hidden');
    } else {
      visual.innerHTML = textarea.value;
      textarea.classList.add('hidden');
      visual.classList.remove('hidden');
    }
    modo = novoModo;
    marcarBotaoModoAtivo();
  }

  btnModoVisual.addEventListener('click', () => irParaModo('visual'));
  btnModoCodigo.addEventListener('click', () => irParaModo('codigo'));
  marcarBotaoModoAtivo();

  visual.addEventListener('input', () => { textarea.value = visual.innerHTML; });

  function envolverSelecaoTexto(abre, fecha) {
    const inicio = textarea.selectionStart;
    const fim = textarea.selectionEnd;
    const selecionado = textarea.value.slice(inicio, fim);
    textarea.setRangeText(`${abre}${selecionado}${fecha}`, inicio, fim, 'select');
    textarea.selectionStart = inicio + abre.length;
    textarea.selectionEnd = inicio + abre.length + selecionado.length;
    textarea.focus();
  }

  function aplicarComandoVisual(comando, valor) {
    visual.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(comando, false, valor);
    textarea.value = visual.innerHTML;
  }

  function aplicarTamanhoVisual(tamanhoCss) {
    visual.focus();
    document.execCommand('fontSize', false, '7');
    visual.querySelectorAll('font[size="7"]').forEach((f) => {
      f.removeAttribute('size');
      f.style.fontSize = tamanhoCss;
    });
    textarea.value = visual.innerHTML;
  }

  document.querySelectorAll(`[data-editor-btn="${idBase}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const info = BOTOES_EDITOR_HTML[Number(btn.dataset.indice)];

      if (modo === 'codigo') {
        if (info.insereSozinho) {
          const inicio = textarea.selectionStart;
          const fim = textarea.selectionEnd;
          textarea.setRangeText(info.insereSozinho, inicio, fim, 'end');
          textarea.focus();
        } else {
          envolverSelecaoTexto(info.abre, info.fecha);
        }
        return;
      }

      if (info.comando === 'link') {
        const url = prompt('Link (URL completa):', 'https://');
        if (!url) return;
        aplicarComandoVisual('createLink', url);
      } else if (info.comandoValor) {
        aplicarComandoVisual(info.comando, info.comandoValor);
      } else {
        aplicarComandoVisual(info.comando);
      }
    });
  });

  const corInput = document.getElementById(`${idBase}-cor`);
  corInput.addEventListener('input', () => {
    if (modo === 'codigo') envolverSelecaoTexto(`<span style="color: ${corInput.value}">`, '</span>');
    else aplicarComandoVisual('foreColor', corInput.value);
  });

  const tamanhoSelect = document.getElementById(`${idBase}-tamanho`);
  tamanhoSelect.addEventListener('change', () => {
    if (!tamanhoSelect.value) return;
    if (modo === 'codigo') envolverSelecaoTexto(`<span style="font-size: ${tamanhoSelect.value}">`, '</span>');
    else aplicarTamanhoVisual(tamanhoSelect.value);
    tamanhoSelect.value = '';
  });

  document.querySelectorAll(`[data-editor-alinhar="${idBase}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (modo === 'codigo') envolverSelecaoTexto(`<div style="text-align: ${btn.dataset.valor}">`, '</div>');
      else aplicarComandoVisual(btn.dataset.comando);
    });
  });
}
