// Formulário genérico de requerimento, reutilizado pelas páginas de
// /requerimentos/*.html — cada página só passa uma config descrevendo
// quais tipos aceita e quais campos extras precisa.

function tituloTipoReq(tipo) {
  return tipo.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

const PREFIXO_IDENTIFICACAO_REQ = {
  promocao: '', rebaixamento: 'R/',
  // outros tipos entram aqui conforme forem confirmados nos moldes oficiais
};

const COR_STATUS_REQ = {
  pendente: { badge: 'bg-gray-500/15 text-gray-600', barra: '#9ca3af' },
  aprovado: { badge: 'bg-green-500/15 text-green-600', barra: '#22c55e' },
  reprovado: { badge: 'bg-red-500/15 text-red-600', barra: '#ef4444' },
  cancelado: { badge: 'bg-red-500/15 text-red-600', barra: '#ef4444' },
};

function formatarDataHoraReq(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * config = {
 *   tipos: [{ value, label }],
 *   alvoLivre: bool,              // true = nick digitado livre (porta de entrada), sem precisar já existir
 *   patenteCorpo: 'militar' | 'executivo' | null,  // se setado, mostra seletor de patente/cargo destino
 *   tiposComPatente: [tipo, ...],
 *   tiposComCrime: [tipo, ...],
 *   tiposComTag: [tipo, ...],
 * }
 */
async function montarFormularioRequerimento(config) {
  const raiz = document.getElementById('form-requerimento-raiz');

  let alvoSelecionadoId = null;

  raiz.innerHTML = `
    <div class="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div class="grid grid-cols-1 md:grid-cols-[300px_1fr]">
        <div id="req-alvo-preview" class="border-b md:border-b-0 md:border-r border-border p-5 flex flex-col items-center text-center justify-center min-h-[220px]">
          <p class="text-sm text-muted">Digite o nick do alvo pra ver o perfil aqui.</p>
        </div>

        <div class="p-5">
          <form id="form-req" class="space-y-4">
            <div class="relative">
              <label class="block text-xs text-muted mb-1">${config.alvoLivre ? 'Nick do usuário (novo)' : 'Alvo'}</label>
              <input id="req-alvo" autocomplete="off" placeholder="${config.alvoLivre ? 'Digite o nick do Habblet' : 'Buscar por nick…'}"
                class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              <div id="req-alvo-sugestoes" class="hidden absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-md max-h-48 overflow-y-auto"></div>
            </div>

            <div>
              <label class="block text-xs text-muted mb-1">Sua TAG</label>
              <input id="req-tag-autor" maxlength="10" placeholder="TAG"
                class="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-accent">
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
        </div>
      </div>
    </div>

    <div class="mt-6">
      <h2 class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Recentes</h2>
      <div id="req-recentes" class="space-y-3">
        <p class="text-sm text-muted">Carregando…</p>
      </div>
    </div>
  `;

  const inputAlvo = document.getElementById('req-alvo');
  const inputTagAutor = document.getElementById('req-tag-autor');
  apiFetch('/usuarios/me').then(async (r) => {
    if (r.ok) {
      const me = await r.json();
      if (me.tag) inputTagAutor.value = me.tag;
    }
  });
  const sugestoesEl = document.getElementById('req-alvo-sugestoes');
  const selectTipo = document.getElementById('req-tipo');
  const campoPatente = document.getElementById('req-campo-patente');
  const campoTag = document.getElementById('req-campo-tag');
  const campoCrime = document.getElementById('req-campo-crime');
  const previewEl = document.getElementById('req-alvo-preview');

  function renderPreviewCarregando() {
    previewEl.innerHTML = '<p class="text-sm text-muted">Carregando…</p>';
  }

  function renderPreviewVazio(msg) {
    previewEl.innerHTML = `<p class="text-sm text-muted">${msg}</p>`;
  }

  function renderPreviewUsuario(perfil, ultimoRequerimento) {
    const avatar = perfil.figure ? avatarUrl(perfil.figure, 'grande', '2') : null;
    previewEl.innerHTML = `
      ${avatar ? `<img src="${avatar}" class="max-h-40 object-contain mb-2" alt="">` : ''}
      <p class="font-display font-bold text-lg">${perfil.nick}</p>
      ${perfil.tag ? `<p class="text-xs text-muted">[${perfil.tag}]</p>` : ''}
      <p class="text-sm mt-1">${perfil.patente_nome || 'Conta institucional'}</p>
      <p class="text-xs text-muted">${perfil.corpo === 'militar' ? 'Corpo Militar' : perfil.corpo === 'executivo' ? 'Corpo Executivo' : ''}</p>
      <span class="text-xs font-semibold px-2.5 py-1 rounded-full capitalize bg-white/10 mt-2">${(perfil.status || '').replace(/_/g, ' ')}</span>
      <p class="text-xs text-muted mt-3">Último requerimento:<br>${ultimoRequerimento ? formatarDataHoraReq(ultimoRequerimento) : '—'}</p>
    `;
  }

  function renderPreviewHabblet(dados) {
    const avatar = dados.figure ? avatarUrl(dados.figure, 'grande', '2') : null;
    previewEl.innerHTML = `
      ${avatar ? `<img src="${avatar}" class="max-h-40 object-contain mb-2" alt="">` : ''}
      <p class="font-display font-bold text-lg">${dados.nick}</p>
      ${dados.motto ? `<p class="text-xs text-muted mt-1 italic">"${dados.motto}"</p>` : ''}
      <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/15 text-accent mt-2">Ainda não cadastrado no CIASystem</span>
    `;
  }

  // Autocomplete de alvo (só quando o usuário já precisa existir no sistema)
  if (!config.alvoLivre) {
    let debounce;
    inputAlvo.addEventListener('input', () => {
      alvoSelecionadoId = null;
      renderPreviewVazio('Selecione um usuário na busca.');
      clearTimeout(debounce);
      const termo = inputAlvo.value.trim();
      if (termo.length < 2) { sugestoesEl.classList.add('hidden'); return; }
      debounce = setTimeout(async () => {
        const resp = await apiFetch(`/usuarios?busca=${encodeURIComponent(termo)}`);
        const lista = resp.ok ? await resp.json() : [];
        sugestoesEl.innerHTML = lista.length
          ? lista.map((u) => `
              <button type="button" data-nick="${u.nick}" class="w-full text-left px-3 py-2 text-sm hover:bg-base transition-colors">
                ${u.nick}${u.tag ? ` [${u.tag}]` : ''} <span class="text-muted">· ${u.patente_nome || 'Executivo'}</span>
              </button>
            `).join('')
          : '<p class="px-3 py-2 text-sm text-muted">Nenhum usuário encontrado.</p>';
        sugestoesEl.classList.remove('hidden');
      }, 250);
    });

    sugestoesEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-nick]');
      if (!btn) return;
      inputAlvo.value = btn.dataset.nick;
      sugestoesEl.classList.add('hidden');
      renderPreviewCarregando();

      const perfilResp = await apiFetch(`/usuarios/nick/${encodeURIComponent(btn.dataset.nick)}`);
      if (!perfilResp.ok) { renderPreviewVazio('Não foi possível carregar o perfil.'); return; }
      const perfil = await perfilResp.json();
      alvoSelecionadoId = perfil.id;

      const historicoResp = await apiFetch(`/requerimentos/alvo/${perfil.id}`);
      const historico = historicoResp.ok ? await historicoResp.json() : [];
      renderPreviewUsuario(perfil, historico[0]?.criado_em);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#req-alvo-sugestoes') && e.target !== inputAlvo) sugestoesEl.classList.add('hidden');
    });
  } else {
    // Nick livre (porta de entrada) — busca direto na API do Habblet.
    let debounce;
    inputAlvo.addEventListener('input', () => {
      clearTimeout(debounce);
      const nick = inputAlvo.value.trim();
      if (nick.length < 2) { renderPreviewVazio('Digite o nick do alvo pra ver o perfil aqui.'); return; }
      renderPreviewCarregando();
      debounce = setTimeout(async () => {
        const resp = await apiFetch(`/habblet/perfil/${encodeURIComponent(nick)}`);
        if (!resp.ok) { renderPreviewVazio('Jogador não encontrado no Habblet.'); return; }
        renderPreviewHabblet(await resp.json());
      }, 400);
    });
  }

  // Carrega patentes (se essa página usa esse campo)
  if (config.patenteCorpo) {
    const resp = await apiFetch(`/patentes?corpo=${config.patenteCorpo}`);
    const lista = resp.ok ? await resp.json() : [];
    document.getElementById('req-patente').innerHTML = lista.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
  }

  // Carrega crimes (se essa página usa esse campo)
  if (config.tiposComCrime?.length) {
    const resp = await apiFetch('/crimes');
    const crimesLista = resp.ok ? await resp.json() : [];
    document.getElementById('req-crime').innerHTML += crimesLista.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('');
  }

  // Mapa de todas as patentes, pra exibir o nome no card de "recentes"
  // (independente do corpo dessa página específica).
  const respTodasPatentes = await apiFetch('/patentes');
  const patentesMapa = {};
  if (respTodasPatentes.ok) {
    for (const p of await respTodasPatentes.json()) patentesMapa[p.id] = p.nome;
  }

  function atualizarCamposCondicionais() {
    const tipoAtual = selectTipo.value;
    campoPatente.classList.toggle('hidden', !(config.tiposComPatente || []).includes(tipoAtual));
    campoTag.classList.toggle('hidden', !(config.tiposComTag || []).includes(tipoAtual));
    campoCrime.classList.toggle('hidden', !(config.tiposComCrime || []).includes(tipoAtual));
  }
  selectTipo.addEventListener('change', atualizarCamposCondicionais);
  atualizarCamposCondicionais();

  function renderCardRecente(r) {
    const cor = COR_STATUS_REQ[r.status] || COR_STATUS_REQ.pendente;
    const alvos = r.alvos_json ? JSON.parse(r.alvos_json) : [];
    const alvoPrincipal = alvos[0];
    const alvosTexto = alvos.map((a) => a.nick).join(' / ') || '—';
    let dadosEspecificos = {};
    try { dadosEspecificos = r.dados_especificos ? JSON.parse(r.dados_especificos) : {}; } catch {}

    const ehInstrucaoInicial = r.tipo === 'instrucao_inicial';
    const avatarAutor = r.autor_figure ? avatarUrl(r.autor_figure, 'mini', '2') : null;
    const prefixoId = PREFIXO_IDENTIFICACAO_REQ[r.tipo] ?? '';
    const tagUsada = dadosEspecificos.tag_utilizada || r.autor_tag || '—';
    const identificacao = alvoPrincipal ? `${alvoPrincipal.nick} [${prefixoId}${tagUsada}] ${formatarDataHoraReq(r.criado_em).split(',')[0]}` : null;

    const linhasExtras = [];
    linhasExtras.push(`<b>${ehInstrucaoInicial ? 'Nick e TAG do Instrutor' : 'Requerido por'}:</b> ${r.autor_nick || '—'}${r.autor_tag ? ` [${r.autor_tag}]` : ''}`);
    linhasExtras.push(`<b>${ehInstrucaoInicial ? 'Recruta(s) aprovado(s)' : 'Alvo(s)'}:</b> ${alvosTexto}`);
    if (dadosEspecificos.patente_destino_id && patentesMapa[dadosEspecificos.patente_destino_id]) {
      linhasExtras.push(`<b>Destino:</b> ${patentesMapa[dadosEspecificos.patente_destino_id]}`);
    }
    if (r.tag_aplicada) linhasExtras.push(`<b>Nova TAG:</b> ${r.tag_aplicada}`);
    if (r.crime_nome) linhasExtras.push(`<b>Infração:</b> ${r.crime_nome}`);
    if (r.fundamentacao) linhasExtras.push(`<b>Motivo:</b> ${r.fundamentacao}`);

    return `
      <div class="bg-card border border-border text-dark rounded-2xl shadow-sm overflow-hidden" style="border-left: 4px solid ${cor.barra}">
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div class="flex items-center gap-2">
            <p class="text-sm font-bold">${tituloTipoReq(r.tipo)}</p>
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${cor.badge}">${r.status}</span>
          </div>
          <p class="text-xs text-muted">${formatarDataHoraReq(r.criado_em)}</p>
        </div>

        <div class="flex gap-4 px-4 py-4">
          <div class="w-28 shrink-0 text-center">
            <span class="h-16 w-16 mx-auto rounded-full bg-base border border-border overflow-hidden inline-block transition-transform duration-300 hover:-translate-y-[10px]">
              ${avatarAutor ? `<img src="${avatarAutor}" class="w-full h-[190%] object-cover object-top -mt-4" alt="">` : `<span class="w-full h-full flex items-center justify-center text-sm font-bold">${(r.autor_nick || '?').slice(0,2).toUpperCase()}</span>`}
            </span>
            <p class="text-sm font-semibold mt-1.5">${r.autor_nick || '—'}</p>
            <p class="text-[0.65rem] text-muted mt-2">Patente/Cargo:</p>
            <p class="text-xs font-semibold">${r.autor_patente_nome || '—'}</p>
          </div>

          <div class="flex-1 text-sm space-y-1.5 min-w-0">
            <p class="text-muted">${r.autor_patente_nome || ''} <b class="text-dark">${r.autor_nick || ''}</b> escreveu:</p>
            ${linhasExtras.map((l) => `<p>${l}</p>`).join('')}
            ${identificacao ? `<p class="font-semibold">• ${identificacao}</p>` : ''}
            <p class="flex items-center gap-1.5 text-green-600 pt-1">✅ Li e concordo com as normas de ${tituloTipoReq(r.tipo).toLowerCase()}.</p>

            <div class="pt-1">
              <p class="text-[0.65rem] text-muted">Assinatura:</p>
              <p class="assinatura text-xl leading-tight">${r.autor_nick || ''}</p>
            </div>
          </div>
        </div>

        <div class="border-t border-border px-4 py-3 grid grid-cols-3 gap-3">
          <div>
            <p class="text-[0.65rem] text-muted">Status:</p>
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${cor.badge} inline-block mt-1">${r.status}</span>
          </div>
          <div>
            <p class="text-[0.65rem] text-muted">Usuário responsável:</p>
            <p class="assinatura text-base ${alvoPrincipal?.decidido_por_nick ? '' : 'text-muted italic text-xs font-sans'}">${alvoPrincipal?.decidido_por_nick || 'Não preenchido'}</p>
          </div>
          <div>
            <p class="text-[0.65rem] text-muted">Data da decisão:</p>
            <p class="text-xs mt-1">${alvoPrincipal?.decidido_em ? formatarDataHoraReq(alvoPrincipal.decidido_em) : 'Não preenchida'}</p>
          </div>
        </div>

        ${alvoPrincipal?.motivo_recusa ? `
          <div class="px-4 pb-3">
            <p class="text-[0.65rem] text-muted">Motivo da recusa:</p>
            <p class="text-xs mt-0.5 text-red-600">${alvoPrincipal.motivo_recusa}</p>
          </div>
        ` : ''}

        ${alvos.length > 1 ? `
          <div class="flex flex-wrap gap-1.5 px-4 pb-4">
            ${alvos.map((a) => `<span class="text-xs px-2 py-0.5 rounded-full ${(COR_STATUS_REQ[a.status] || COR_STATUS_REQ.pendente).badge}">${a.nick} · ${a.status}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  async function carregarRecentes() {
    const resp = await apiFetch('/requerimentos');
    const container = document.getElementById('req-recentes');
    if (!resp.ok) { container.innerHTML = '<p class="text-sm text-red-400">Erro ao carregar.</p>'; return; }

    const todos = await resp.json();
    const valoresTipos = config.tipos.map((t) => t.value);
    const filtrados = todos.filter((r) => valoresTipos.includes(r.tipo)).slice(0, 10);

    container.innerHTML = filtrados.length
      ? filtrados.map(renderCardRecente).join('')
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
    if (inputTagAutor.value.trim()) {
      dadosEspecificos.tag_utilizada = inputTagAutor.value.trim().toUpperCase();
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
    renderPreviewVazio('Digite o nick do alvo pra ver o perfil aqui.');
    atualizarCamposCondicionais();
    carregarRecentes();
  });
}
