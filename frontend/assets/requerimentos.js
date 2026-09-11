// Formulário genérico de requerimento, reutilizado pelas 8 páginas de
// /requerimentos/*.html — cada página só passa uma config descrevendo
// quais tipos aceita e quais campos extras precisa.

function tituloTipoReq(tipo) {
  return tipo.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

const BADGE_STATUS_REQ = {
  pendente: 'bg-gray-500/15 text-gray-500',
  aprovado: 'bg-green-500/15 text-green-600',
  reprovado: 'bg-red-500/15 text-red-600',
};

/**
 * config = {
 *   tipos: [{ value, label }],
 *   alvoLivre: bool,              // true = nick digitado livre (porta de entrada), sem precisar já existir
 *   patenteCorpo: 'militar' | 'executivo' | null,  // se setado, mostra seletor de patente/cargo destino
 *   tiposComPatente: [tipo, ...], // quais tipos selecionados exibem o seletor de patente
 *   tiposComCrime: [tipo, ...],   // quais tipos exigem crime + fundamentação
 *   tiposComTag: [tipo, ...],     // quais tipos exibem o campo de TAG
 * }
 */
async function montarFormularioRequerimento(config) {
  const raiz = document.getElementById('form-requerimento-raiz');

  let alvoSelecionadoId = null;

  raiz.innerHTML = `
    <form id="form-req" class="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-4">
      <div class="relative">
        <label class="block text-xs text-muted mb-1">${config.alvoLivre ? 'Nick do usuário (novo)' : 'Alvo'}</label>
        <input id="req-alvo" autocomplete="off" placeholder="${config.alvoLivre ? 'Digite o nick do Habblet' : 'Buscar por nick…'}"
          class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
        <div id="req-alvo-sugestoes" class="hidden absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-md max-h-48 overflow-y-auto"></div>
      </div>

      ${config.tipos.length > 1 ? `
        <div>
          <label class="block text-xs text-muted mb-1">Tipo</label>
          <select id="req-tipo" class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
            ${config.tipos.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
          </select>
        </div>
      ` : `<input type="hidden" id="req-tipo" value="${config.tipos[0].value}">`}

      <div id="req-campo-patente" class="hidden">
        <label class="block text-xs text-muted mb-1">Patente/cargo destino</label>
        <select id="req-patente" class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"></select>
      </div>

      <div id="req-campo-tag" class="hidden">
        <label class="block text-xs text-muted mb-1">Nova TAG (2-3 caracteres)</label>
        <input id="req-tag" maxlength="3" class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-accent">
      </div>

      <div id="req-campo-crime" class="hidden">
        <label class="block text-xs text-muted mb-1">Infração</label>
        <select id="req-crime" class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
          <option value="">— selecione —</option>
        </select>
      </div>

      <div>
        <label class="block text-xs text-muted mb-1">Motivo / fundamentação</label>
        <textarea id="req-motivo" rows="3" class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"></textarea>
      </div>

      <button type="submit" class="bg-accent hover:bg-accent-dark text-white font-semibold rounded-lg px-5 py-2.5 text-sm transition-colors">
        Enviar requerimento
      </button>
      <p id="req-erro" class="hidden text-xs text-red-400"></p>
      <p id="req-sucesso" class="hidden text-xs text-green-600"></p>
    </form>

    <div class="mt-6">
      <h2 class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Recentes</h2>
      <div id="req-recentes" class="space-y-2">
        <p class="text-sm text-muted">Carregando…</p>
      </div>
    </div>
  `;

  const inputAlvo = document.getElementById('req-alvo');
  const sugestoesEl = document.getElementById('req-alvo-sugestoes');
  const selectTipo = document.getElementById('req-tipo');
  const campoPatente = document.getElementById('req-campo-patente');
  const campoTag = document.getElementById('req-campo-tag');
  const campoCrime = document.getElementById('req-campo-crime');

  // Autocomplete de alvo (só quando o usuário já precisa existir)
  if (!config.alvoLivre) {
    let debounce;
    inputAlvo.addEventListener('input', () => {
      alvoSelecionadoId = null;
      clearTimeout(debounce);
      const termo = inputAlvo.value.trim();
      if (termo.length < 2) { sugestoesEl.classList.add('hidden'); return; }
      debounce = setTimeout(async () => {
        const resp = await apiFetch(`/usuarios?busca=${encodeURIComponent(termo)}`);
        const lista = resp.ok ? await resp.json() : [];
        sugestoesEl.innerHTML = lista.length
          ? lista.map((u) => `
              <button type="button" data-id="${u.id}" data-nick="${u.nick}" class="w-full text-left px-3 py-2 text-sm hover:bg-base transition-colors">
                ${u.nick}${u.tag ? ` [${u.tag}]` : ''} <span class="text-muted">· ${u.patente_nome || 'Executivo'}</span>
              </button>
            `).join('')
          : '<p class="px-3 py-2 text-sm text-muted">Nenhum usuário encontrado.</p>';
        sugestoesEl.classList.remove('hidden');
      }, 250);
    });

    sugestoesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      alvoSelecionadoId = Number(btn.dataset.id);
      inputAlvo.value = btn.dataset.nick;
      sugestoesEl.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#req-alvo-sugestoes') && e.target !== inputAlvo) sugestoesEl.classList.add('hidden');
    });
  }

  // Carrega patentes (se essa página usa esse campo)
  let patentesCache = [];
  if (config.patenteCorpo) {
    const resp = await apiFetch(`/patentes?corpo=${config.patenteCorpo}`);
    patentesCache = resp.ok ? await resp.json() : [];
    document.getElementById('req-patente').innerHTML = patentesCache
      .map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
  }

  // Carrega crimes (se essa página usa esse campo)
  if (config.tiposComCrime?.length) {
    const resp = await apiFetch('/crimes');
    const crimesLista = resp.ok ? await resp.json() : [];
    const select = document.getElementById('req-crime');
    select.innerHTML += crimesLista.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('');
  }

  function atualizarCamposCondicionais() {
    const tipoAtual = selectTipo.value;
    campoPatente.classList.toggle('hidden', !(config.tiposComPatente || []).includes(tipoAtual));
    campoTag.classList.toggle('hidden', !(config.tiposComTag || []).includes(tipoAtual));
    campoCrime.classList.toggle('hidden', !(config.tiposComCrime || []).includes(tipoAtual));
  }
  selectTipo.addEventListener('change', atualizarCamposCondicionais);
  atualizarCamposCondicionais();

  async function carregarRecentes() {
    const resp = await apiFetch('/requerimentos');
    const container = document.getElementById('req-recentes');
    if (!resp.ok) { container.innerHTML = '<p class="text-sm text-red-400">Erro ao carregar.</p>'; return; }

    const todos = await resp.json();
    const valoresTipos = config.tipos.map((t) => t.value);
    const filtrados = todos.filter((r) => valoresTipos.includes(r.tipo)).slice(0, 10);

    container.innerHTML = filtrados.length
      ? filtrados.map((r) => `
          <div class="bg-card border border-border rounded-xl px-4 py-3 shadow-sm flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold">${tituloTipoReq(r.tipo)}</p>
              <p class="text-xs text-muted">${r.tag_requerimento} · ${new Date(r.criado_em).toLocaleDateString('pt-BR')}</p>
            </div>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${BADGE_STATUS_REQ[r.status] || 'bg-white/10'}">${r.status}</span>
          </div>
        `).join('')
      : '<p class="text-sm text-muted">Nenhum requerimento deste tipo ainda.</p>';
  }
  carregarRecentes();

  document.getElementById('form-req').addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('req-erro');
    const sucessoEl = document.getElementById('req-sucesso');
    erroEl.classList.add('hidden');
    sucessoEl.classList.add('hidden');

    const tipo = selectTipo.value;
    let alvo;
    if (config.alvoLivre) {
      alvo = inputAlvo.value.trim();
      if (!alvo) { erroEl.textContent = 'Digite o nick do alvo.'; erroEl.classList.remove('hidden'); return; }
    } else {
      if (!alvoSelecionadoId) { erroEl.textContent = 'Selecione um usuário na busca.'; erroEl.classList.remove('hidden'); return; }
      alvo = alvoSelecionadoId;
    }

    const dadosEspecificos = {};
    if ((config.tiposComPatente || []).includes(tipo)) {
      dadosEspecificos.patente_destino_id = Number(document.getElementById('req-patente').value);
    }

    const body = {
      tipo,
      alvos: [alvo],
      dados_especificos: Object.keys(dadosEspecificos).length ? dadosEspecificos : undefined,
      fundamentacao: document.getElementById('req-motivo').value.trim() || undefined,
      crime_id: (config.tiposComCrime || []).includes(tipo) && document.getElementById('req-crime').value
        ? Number(document.getElementById('req-crime').value) : undefined,
      tag_aplicada: (config.tiposComTag || []).includes(tipo)
        ? document.getElementById('req-tag').value.trim().toUpperCase() : undefined,
    };

    const resposta = await apiFetch('/requerimentos', { method: 'POST', body: JSON.stringify(body) });
    const dados = await resposta.json();

    if (!resposta.ok) {
      erroEl.textContent = dados.erro || 'Não foi possível enviar o requerimento.';
      erroEl.classList.remove('hidden');
      return;
    }

    sucessoEl.textContent = `Requerimento enviado! Código: ${dados.tag_requerimento}`;
    sucessoEl.classList.remove('hidden');
    document.getElementById('form-req').reset();
    alvoSelecionadoId = null;
    atualizarCamposCondicionais();
    carregarRecentes();
  });
}
