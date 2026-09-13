// Seletor múltiplo de usuários — busca por nick, adiciona como "chip"
// removível. Usado pra escolher coautores/aprovadores/administradores
// do fórum nas solicitações de revisão de documento.
//
// Uso:
//   container.innerHTML = seletorUsuariosHtml('meu-seletor', 'Buscar coautor…');
//   ligarSeletorUsuarios('meu-seletor', { apenasAdmin: false, excluirIds: [meuId] });
//   ... na hora de salvar: obterSelecionados('meu-seletor') → [12, 34, ...]

function seletorUsuariosHtml(idBase, placeholder) {
  return `
    <div class="relative">
      <input id="${idBase}-input" placeholder="${placeholder}" autocomplete="off"
        class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
      <div id="${idBase}-sugestoes" class="hidden absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-md max-h-40 overflow-y-auto"></div>
    </div>
    <div id="${idBase}-chips" class="flex flex-wrap gap-1.5 mt-2"></div>
  `;
}

function ligarSeletorUsuarios(idBase, opcoes) {
  opcoes = opcoes || {};
  const input = document.getElementById(`${idBase}-input`);
  const sugestoes = document.getElementById(`${idBase}-sugestoes`);
  const chips = document.getElementById(`${idBase}-chips`);

  function renderChip(id, nick) {
    if (chips.querySelector(`[data-chip-id="${id}"]`)) return;
    const chip = document.createElement('span');
    chip.dataset.chipId = id;
    chip.dataset.chipNick = nick;
    chip.className = 'inline-flex items-center gap-1.5 text-xs font-semibold bg-accent/10 text-accent px-2.5 py-1 rounded-full';
    chip.innerHTML = `${nick} <button type="button" class="hover:text-red-600"><i class="fa-solid fa-xmark"></i></button>`;
    chip.querySelector('button').addEventListener('click', () => chip.remove());
    chips.appendChild(chip);
  }

  // pré-popula, se pedido (ex: quem já está listado numa revisão existente)
  (opcoes.iniciais || []).forEach((u) => renderChip(u.id, u.nick));

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const termo = input.value.trim();
    if (termo.length < 2) { sugestoes.classList.add('hidden'); return; }
    debounce = setTimeout(async () => {
      const qs = new URLSearchParams({ busca: termo });
      if (opcoes.apenasAdmin) qs.set('apenas_admin', '1');
      const r = await apiFetch(`/usuarios?${qs}`);
      let lista = r.ok ? await r.json() : [];
      if (opcoes.excluirIds) lista = lista.filter((u) => !opcoes.excluirIds.includes(u.id));
      sugestoes.innerHTML = lista.length
        ? lista.map((u) => `<button type="button" data-id="${u.id}" data-nick="${u.nick}" class="w-full text-left px-3 py-2 text-sm hover:bg-basebg transition-colors">${u.nick}</button>`).join('')
        : `<p class="px-3 py-2 text-sm text-muted">${opcoes.apenasAdmin ? 'Nenhum administrador encontrado.' : 'Nenhum usuário encontrado.'}</p>`;
      sugestoes.classList.remove('hidden');
    }, 250);
  });

  sugestoes.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    renderChip(btn.dataset.id, btn.dataset.nick);
    input.value = '';
    sugestoes.classList.add('hidden');
  });
}

function obterSelecionados(idBase) {
  return Array.from(document.querySelectorAll(`#${idBase}-chips [data-chip-id]`)).map((el) => Number(el.dataset.chipId));
}
