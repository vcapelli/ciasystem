// Formulário genérico de requerimento, reutilizado pelas páginas de
// /requerimentos/*.html — cada página só passa uma config descrevendo
// quais tipos aceita e quais campos extras precisa.

const TITULOS_TIPO_REQ = {
  instrucao_inicial: 'Instrução Inicial', contratacao: 'Contratação', promocao: 'Promoção',
  rebaixamento: 'Rebaixamento', advertencia: 'Advertência', licenca: 'Licença',
  volta_licenca: 'Volta de Licença', transferencia_conta: 'Transferência de Conta',
  transferencia_corpo: 'Transferência de Corpo', venda_cargo: 'Venda de Cargo', tag: 'TAG',
  turno_tarefa: 'Turno/Tarefa', reforma: 'Reforma', desligamento_honroso: 'Desligamento Honroso',
  desligamento_desonroso: 'Desligamento Desonroso', exoneracao: 'Exoneração',
  bonificacao: 'Bonificação', cancelamento: 'Cancelamento',
};

function tituloTipoReq(tipo) {
  return TITULOS_TIPO_REQ[tipo] || tipo.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatarDataCurtaReq(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
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
 *   alvoLivre: bool,
 *   patenteCorpo: 'militar' | 'executivo' | null,
 *   filtrarPatentePorAutor: bool,      // Contratação: patente < patente do autor (ou todas, se admin)
 *   patenteFiltroPorAlvo: bool,        // promoção/rebaixamento: filtra pela patente atual do alvo
 *   tiposComPatente: [tipo, ...],
 *   tiposComCrime: [tipo, ...],        // também mostra o campo "Provas"
 *   tiposComTag: [tipo, ...],
 *   tiposComPermissao: [tipo, ...],
 *   tiposComDataRetorno: [tipo, ...],  // licença
 *   tiposComExoneracao: [tipo, ...],   // temporária/indeterminada
 *   tipoVoltaLicencaCondicional: bool, // só habilita 'volta_licenca' se o alvo estiver de licença
 *   usaNovoNick: bool,                 // transferência de conta
 *   permiteAutoAlvo: bool,             // se true, ignora o bloqueio de "não pode ser o próprio alvo" (ex: TAGs)
 * }
 */
async function montarFormularioRequerimento(config) {
  const raiz = document.getElementById('form-requerimento-raiz');

  let alvoSelecionadoId = null;
  let permissaoSelecionadaId = null;
  let alvoAtualPatenteOrdem = null;
  let alvoAtualStatus = null;
  let patentesCacheCompleta = [];

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
                class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              <div id="req-alvo-sugestoes" class="hidden absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-md max-h-48 overflow-y-auto"></div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs text-muted mb-1">Sua TAG</label>
                <input id="req-tag-autor" maxlength="10" placeholder="TAG"
                  class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              </div>

              ${config.tipos.length > 1 ? `
                <div>
                  <label class="block text-xs text-muted mb-1">Tipo</label>
                  <select id="req-tipo" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                    ${config.tipos.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
                  </select>
                </div>
              ` : `<input type="hidden" id="req-tipo" value="${config.tipos[0].value}">`}

              <div id="req-campo-patente" class="hidden">
                <label class="block text-xs text-muted mb-1">Patente/cargo destino</label>
                <select id="req-patente" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"></select>
              </div>

              <div id="req-campo-novo-nick" class="hidden">
                <label class="block text-xs text-muted mb-1">Novo nickname</label>
                <input id="req-novo-nick" placeholder="Novo nick do Habblet" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              </div>

              <div id="req-campo-tag" class="hidden space-y-3">
                <div id="req-tag-atual-wrap" class="hidden">
                  <label class="block text-xs text-muted mb-1">TAG atual</label>
                  <input id="req-tag-atual" disabled class="w-full bg-border/40 border border-border rounded-lg px-3 py-2 text-sm text-muted cursor-not-allowed">
                </div>
                <div>
                  <label id="req-tag-label" class="block text-xs text-muted mb-1">Nova TAG (2-3 caracteres)</label>
                  <input id="req-tag" maxlength="3" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                </div>
              </div>

              <div id="req-campo-crime" class="hidden">
                <label class="block text-xs text-muted mb-1">Infração</label>
                <select id="req-crime" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                  <option value="">— selecione —</option>
                </select>
              </div>

              <div id="req-campo-provas" class="hidden">
                <label class="block text-xs text-muted mb-1">Provas</label>
                <input id="req-provas" placeholder="Link de prints, vídeo, etc." class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              </div>

              <div id="req-campo-permissao" class="relative hidden sm:col-span-2">
                <label class="block text-xs text-muted mb-1">Permissão (concessor, se necessária)</label>
                <input id="req-permissao" autocomplete="off" placeholder="Buscar por nick…" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                <div id="req-permissao-sugestoes" class="hidden absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-md max-h-48 overflow-y-auto"></div>
              </div>

              <div id="req-campo-data-retorno" class="hidden">
                <label class="block text-xs text-muted mb-1">Data de retorno</label>
                <input id="req-data-retorno" type="date" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              </div>

              <div id="req-campo-exoneracao" class="hidden space-y-3">
                <div>
                  <label class="block text-xs text-muted mb-1">Duração</label>
                  <select id="req-exoneracao-tipo" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                    <option value="indeterminada">Indeterminada</option>
                    <option value="temporaria">Temporária</option>
                  </select>
                </div>
                <div id="req-campo-exoneracao-data" class="hidden">
                  <label class="block text-xs text-muted mb-1">Exoneração até</label>
                  <input id="req-exoneracao-ate" type="date" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                </div>
              </div>

              <div class="sm:col-span-2">
                <label class="block text-xs text-muted mb-1">Motivo / fundamentação</label>
                <textarea id="req-motivo" rows="3" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"></textarea>
              </div>
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
  let meAtual = null;
  const promessaMe = apiFetch('/usuarios/me').then(async (r) => {
    if (r.ok) {
      meAtual = await r.json();
      if (meAtual.tag) inputTagAutor.value = meAtual.tag;
    }
  });
  const sugestoesEl = document.getElementById('req-alvo-sugestoes');
  const selectTipo = document.getElementById('req-tipo');
  const campoPatente = document.getElementById('req-campo-patente');
  const campoTag = document.getElementById('req-campo-tag');
  const campoCrime = document.getElementById('req-campo-crime');
  const campoProvas = document.getElementById('req-campo-provas');
  const campoPermissao = document.getElementById('req-campo-permissao');
  const campoDataRetorno = document.getElementById('req-campo-data-retorno');
  const campoExoneracao = document.getElementById('req-campo-exoneracao');
  const campoNovoNick = document.getElementById('req-campo-novo-nick');
  const previewEl = document.getElementById('req-alvo-preview');

  document.getElementById('req-exoneracao-tipo')?.addEventListener('change', (e) => {
    document.getElementById('req-campo-exoneracao-data').classList.toggle('hidden', e.target.value !== 'temporaria');
  });

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

  function atualizarOpcaoVoltaLicenca() {
    if (!config.tipoVoltaLicencaCondicional || !selectTipo) return;
    const opcaoVolta = [...selectTipo.options].find((o) => o.value === 'volta_licenca');
    if (!opcaoVolta) return;
    const podeVoltar = alvoAtualStatus === 'licenca';
    opcaoVolta.disabled = !podeVoltar;
    opcaoVolta.textContent = podeVoltar ? 'Volta de Licença' : 'Volta de Licença (alvo não está de licença)';
    if (!podeVoltar && selectTipo.value === 'volta_licenca') {
      const primeiraHabilitada = [...selectTipo.options].find((o) => !o.disabled);
      if (primeiraHabilitada) selectTipo.value = primeiraHabilitada.value;
    }
  }

  function atualizarOpcoesPatenteFiltradas() {
    if (!config.patenteFiltroPorAlvo || !patentesCacheCompleta.length) return;
    const tipoAtual = selectTipo.value;
    let filtradas = patentesCacheCompleta;
    if (alvoAtualPatenteOrdem !== null) {
      if (tipoAtual === 'promocao') filtradas = patentesCacheCompleta.filter((p) => p.ordem > alvoAtualPatenteOrdem);
      else if (tipoAtual === 'rebaixamento') filtradas = patentesCacheCompleta.filter((p) => p.ordem < alvoAtualPatenteOrdem);
    }
    document.getElementById('req-patente').innerHTML = filtradas.length
      ? filtradas.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('')
      : '<option value="">— nenhuma patente disponível —</option>';
  }

  // Autocomplete de alvo (só quando o usuário já precisa existir no sistema)
  if (!config.alvoLivre) {
    let debounce;
    inputAlvo.addEventListener('input', () => {
      alvoSelecionadoId = null;
      alvoAtualPatenteOrdem = null;
      alvoAtualStatus = null;
      renderPreviewVazio('Selecione um usuário na busca.');
      clearTimeout(debounce);
      const termo = inputAlvo.value.trim();
      if (termo.length < 2) { sugestoesEl.classList.add('hidden'); return; }
      debounce = setTimeout(async () => {
        const resp = await apiFetch(`/usuarios?busca=${encodeURIComponent(termo)}`);
        const lista = resp.ok ? await resp.json() : [];
        sugestoesEl.innerHTML = lista.length
          ? lista.map((u) => `
              <button type="button" data-nick="${u.nick}" class="w-full text-left px-3 py-2 text-sm hover:bg-basebg transition-colors">
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
      await promessaMe;

      if (!config.permiteAutoAlvo && meAtual && btn.dataset.nick === meAtual.nick) {
        sugestoesEl.classList.add('hidden');
        renderPreviewVazio('Você não pode ser o alvo do próprio requerimento.');
        inputAlvo.value = '';
        alvoSelecionadoId = null;
        return;
      }

      inputAlvo.value = btn.dataset.nick;
      sugestoesEl.classList.add('hidden');
      renderPreviewCarregando();

      const perfilResp = await apiFetch(`/usuarios/nick/${encodeURIComponent(btn.dataset.nick)}`);
      if (!perfilResp.ok) { renderPreviewVazio('Não foi possível carregar o perfil.'); return; }
      const perfil = await perfilResp.json();
      alvoSelecionadoId = perfil.id;
      alvoAtualPatenteOrdem = perfil.patente_ordem ?? null;
      alvoAtualStatus = perfil.status ?? null;

      const tagAtualWrap = document.getElementById('req-tag-atual-wrap');
      const tagAtualInput = document.getElementById('req-tag-atual');
      const tagLabel = document.getElementById('req-tag-label');
      if (tagAtualWrap) {
        if (perfil.tag) {
          tagAtualInput.value = perfil.tag;
          tagAtualWrap.classList.remove('hidden');
          tagLabel.textContent = 'Alterar para (2-3 caracteres)';
        } else {
          tagAtualWrap.classList.add('hidden');
          tagLabel.textContent = 'Nova TAG (2-3 caracteres)';
        }
      }

      atualizarOpcoesPatenteFiltradas();
      atualizarOpcaoVoltaLicenca();

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
        await promessaMe;
        if (meAtual && nick.toLowerCase() === meAtual.nick.toLowerCase()) {
          renderPreviewVazio('Você não pode ser o alvo do próprio requerimento.');
          return;
        }
        const resp = await apiFetch(`/habblet/perfil/${encodeURIComponent(nick)}`);
        if (!resp.ok) { renderPreviewVazio('Jogador não encontrado no Habblet.'); return; }
        renderPreviewHabblet(await resp.json());
      }, 400);
    });
  }

  // Autocomplete de "Permissão" (concessor) — mesmo padrão do alvo, mais simples.
  const inputPermissao = document.getElementById('req-permissao');
  const sugestoesPermissaoEl = document.getElementById('req-permissao-sugestoes');
  if (inputPermissao) {
    let debouncePermissao;
    inputPermissao.addEventListener('input', () => {
      permissaoSelecionadaId = null;
      clearTimeout(debouncePermissao);
      const termo = inputPermissao.value.trim();
      if (termo.length < 2) { sugestoesPermissaoEl.classList.add('hidden'); return; }
      debouncePermissao = setTimeout(async () => {
        const resp = await apiFetch(`/usuarios?busca=${encodeURIComponent(termo)}`);
        const lista = resp.ok ? await resp.json() : [];
        sugestoesPermissaoEl.innerHTML = lista.length
          ? lista.map((u) => `
              <button type="button" data-id="${u.id}" data-nick="${u.nick}" class="w-full text-left px-3 py-2 text-sm hover:bg-basebg transition-colors">
                ${u.nick}${u.tag ? ` [${u.tag}]` : ''} <span class="text-muted">· ${u.patente_nome || 'Executivo'}</span>
              </button>
            `).join('')
          : '<p class="px-3 py-2 text-sm text-muted">Nenhum usuário encontrado.</p>';
        sugestoesPermissaoEl.classList.remove('hidden');
      }, 250);
    });
    sugestoesPermissaoEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      permissaoSelecionadaId = Number(btn.dataset.id);
      inputPermissao.value = btn.dataset.nick;
      sugestoesPermissaoEl.classList.add('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#req-permissao-sugestoes') && e.target !== inputPermissao) sugestoesPermissaoEl.classList.add('hidden');
    });
  }

  // Carrega patentes (se essa página usa esse campo)
  if (config.filtrarPatentePorAutor) {
    await promessaMe;
    if (meAtual?.administrador_sistema) {
      const resp = await apiFetch('/patentes');
      const lista = resp.ok ? await resp.json() : [];
      document.getElementById('req-patente').innerHTML = lista
        .map((p) => `<option value="${p.id}">${p.nome}${p.corpo === 'executivo' ? ' (Executivo)' : ''}</option>`).join('');
    } else {
      const resp = await apiFetch('/patentes?corpo=militar');
      const todas = resp.ok ? await resp.json() : [];
      const permitidas = meAtual?.patente_ordem ? todas.filter((p) => p.ordem < meAtual.patente_ordem) : [];
      document.getElementById('req-patente').innerHTML = permitidas.length
        ? permitidas.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('')
        : '<option value="">— nenhuma patente disponível pra sua patente atual —</option>';
    }
  } else if (config.patenteCorpo) {
    const resp = await apiFetch(`/patentes?corpo=${config.patenteCorpo}`);
    patentesCacheCompleta = resp.ok ? await resp.json() : [];
    document.getElementById('req-patente').innerHTML = patentesCacheCompleta.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
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
    campoProvas.classList.toggle('hidden', !(config.tiposComCrime || []).includes(tipoAtual));
    campoPermissao.classList.toggle('hidden', !(config.tiposComPermissao || []).includes(tipoAtual));
    campoDataRetorno.classList.toggle('hidden', !(config.tiposComDataRetorno || []).includes(tipoAtual));
    campoExoneracao.classList.toggle('hidden', !(config.tiposComExoneracao || []).includes(tipoAtual));
    if (campoNovoNick) campoNovoNick.classList.toggle('hidden', !config.usaNovoNick);
    atualizarOpcoesPatenteFiltradas();
  }
  selectTipo.addEventListener('change', atualizarCamposCondicionais);
  atualizarCamposCondicionais();
  atualizarOpcaoVoltaLicenca();

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
    const identificacao = alvoPrincipal ? `${alvoPrincipal.nick} [${prefixoId}${tagUsada}] ${formatarDataCurtaReq(r.criado_em)}` : null;

    const linhasExtras = [];
    linhasExtras.push(`<b>${ehInstrucaoInicial ? 'Nick e TAG do Instrutor' : 'Requerido por'}:</b> ${r.autor_nick || '—'}${r.autor_tag ? ` [${r.autor_tag}]` : ''}`);
    linhasExtras.push(`<b>${ehInstrucaoInicial ? 'Recruta(s) aprovado(s)' : 'Alvo'}:</b> ${alvosTexto}`);
    if (dadosEspecificos.patente_destino_id && patentesMapa[dadosEspecificos.patente_destino_id]) {
      const nomeDestino = patentesMapa[dadosEspecificos.patente_destino_id];
      const idAntiga = alvoPrincipal?.patente_antes_id ?? alvoPrincipal?.patente_atual_id_agora;
      const nomeAntiga = idAntiga ? patentesMapa[idAntiga] : null;
      linhasExtras.push(`<b>Destino:</b> ${nomeAntiga && nomeAntiga !== nomeDestino ? `${nomeAntiga} > ${nomeDestino}` : nomeDestino}`);
    }
    if (dadosEspecificos.novo_nick) linhasExtras.push(`<b>Novo nickname:</b> ${dadosEspecificos.novo_nick}`);
    if (r.tag_aplicada) linhasExtras.push(`<b>Nova TAG:</b> ${r.tag_aplicada}`);
    if (r.crime_nome) linhasExtras.push(`<b>Infração:</b> ${r.crime_nome}`);
    if (dadosEspecificos.provas) linhasExtras.push(`<b>Provas:</b> ${dadosEspecificos.provas}`);
    if (dadosEspecificos.data_retorno) linhasExtras.push(`<b>Data de retorno:</b> ${dadosEspecificos.data_retorno}`);
    if (dadosEspecificos.exoneracao_ate) linhasExtras.push(`<b>Exoneração até:</b> ${dadosEspecificos.exoneracao_ate}`);
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
            <span class="h-16 w-16 mx-auto rounded-full bg-basebg border border-border overflow-hidden inline-block">
              ${avatarAutor ? `<img src="${avatarAutor}" class="w-full h-[190%] object-cover object-top -mt-4 transition-transform duration-300 hover:-translate-y-[10px]" alt="">` : `<span class="w-full h-full flex items-center justify-center text-sm font-bold">${(r.autor_nick || '?').slice(0,2).toUpperCase()}</span>`}
            </span>
            <p class="text-sm font-semibold mt-1.5">${r.autor_nick || '—'}</p>
            <p class="text-[0.65rem] text-muted mt-2">Patente/Cargo:</p>
            <p class="text-xs font-semibold">${r.autor_patente_nome || '—'}</p>
          </div>

          <div class="flex-1 text-sm space-y-1.5 min-w-0">
            <p class="text-muted">${r.autor_patente_nome || ''} <b class="text-dark">${r.autor_nick || ''}</b> escreveu:</p>
            ${linhasExtras.map((l) => `<p>${l}</p>`).join('')}
            ${identificacao ? `<p class="font-semibold">• ${identificacao}</p>` : ''}
            <p class="flex items-center gap-1.5 text-green-600 pt-1"><i class="fa-solid fa-circle-check"></i> Li e concordo com as normas de ${tituloTipoReq(r.tipo).toLowerCase()}.</p>

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
            <p class="assinatura text-base ${alvoPrincipal?.decidido_por_nick ? 'text-dark' : 'text-muted italic text-xs font-sans'}">${alvoPrincipal?.decidido_por_nick || 'Não preenchido'}</p>
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

        ${meAtual?.administrador_sistema ? `
          <div class="border-t border-border px-4 py-2.5 flex items-center justify-between">
            <div class="flex gap-2">
              ${r.status === 'pendente' && alvoPrincipal ? `
                <button data-acao="aprovar" data-req="${r.id}" data-alvo="${alvoPrincipal.id}" class="btn-decidir text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500/15 text-green-600 hover:bg-green-500/25 transition-colors">
                  <i class="fa-solid fa-check"></i> Aprovar
                </button>
                <button data-acao="reprovar" data-req="${r.id}" data-alvo="${alvoPrincipal.id}" class="btn-decidir text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/15 text-red-600 hover:bg-red-500/25 transition-colors">
                  <i class="fa-solid fa-xmark"></i> Reprovar
                </button>
              ` : ''}
              ${r.status !== 'cancelado' ? `
                <button data-acao="cancelar" data-req="${r.id}" class="btn-decidir text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-500/15 text-gray-600 hover:bg-gray-500/25 transition-colors">
                  <i class="fa-solid fa-ban"></i> Cancelar
                </button>
              ` : ''}
            </div>
            <button data-acao="excluir" data-req="${r.id}" title="Excluir do histórico" class="btn-decidir text-muted hover:text-red-600 transition-colors px-2">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  async function carregarRecentes() {
    await promessaMe;
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

  document.getElementById('req-recentes').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-decidir');
    if (!btn) return;
    const acao = btn.dataset.acao;
    const reqId = btn.dataset.req;

    if (acao === 'aprovar' || acao === 'reprovar') {
      let motivo_recusa;
      if (acao === 'reprovar') {
        motivo_recusa = prompt('Motivo da recusa:');
        if (motivo_recusa === null) return;
      }
      await apiFetch(`/requerimentos/${reqId}/alvos/${btn.dataset.alvo}/decidir`, {
        method: 'POST',
        body: JSON.stringify({ status: acao === 'aprovar' ? 'aprovado' : 'reprovado', motivo_recusa: motivo_recusa || undefined }),
      });
      carregarRecentes();
    } else if (acao === 'cancelar') {
      if (!confirm('Cancelar este requerimento? Se ele já estava aprovado, o efeito aplicado será revertido (ex: volta à patente/TAG/status de antes).')) return;
      const motivo = prompt('Motivo do cancelamento (opcional):') || undefined;
      await apiFetch(`/requerimentos/${reqId}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) });
      carregarRecentes();
    } else if (acao === 'excluir') {
      if (!confirm('Excluir este requerimento definitivamente do histórico? Essa ação não pode ser desfeita.')) return;
      await apiFetch(`/requerimentos/${reqId}`, { method: 'DELETE' });
      carregarRecentes();
    }
  });

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
      if (meAtual && alvo.toLowerCase() === meAtual.nick.toLowerCase() && !config.permiteAutoAlvo) {
        erroEl.textContent = 'Você não pode ser o alvo do próprio requerimento.'; erroEl.classList.remove('hidden'); return;
      }
    } else {
      if (!alvoSelecionadoId) { erroEl.textContent = 'Selecione um usuário na busca.'; erroEl.classList.remove('hidden'); return; }
      alvo = alvoSelecionadoId;
    }

    if (tipo === 'volta_licenca' && alvoAtualStatus !== 'licenca') {
      erroEl.textContent = 'Esse alvo não está de licença — não é possível registrar volta de licença.';
      erroEl.classList.remove('hidden');
      return;
    }

    const dadosEspecificos = {};
    if ((config.tiposComPatente || []).includes(tipo)) {
      dadosEspecificos.patente_destino_id = Number(document.getElementById('req-patente').value);
    }
    if (inputTagAutor.value.trim()) {
      dadosEspecificos.tag_utilizada = inputTagAutor.value.trim();
    }
    if ((config.tiposComCrime || []).includes(tipo) && document.getElementById('req-provas').value.trim()) {
      dadosEspecificos.provas = document.getElementById('req-provas').value.trim();
    }
    if ((config.tiposComDataRetorno || []).includes(tipo) && document.getElementById('req-data-retorno').value) {
      dadosEspecificos.data_retorno = document.getElementById('req-data-retorno').value;
    }
    if ((config.tiposComExoneracao || []).includes(tipo)) {
      const duracao = document.getElementById('req-exoneracao-tipo').value;
      if (duracao === 'temporaria' && document.getElementById('req-exoneracao-ate').value) {
        dadosEspecificos.exoneracao_ate = document.getElementById('req-exoneracao-ate').value;
      }
    }
    if (config.usaNovoNick && document.getElementById('req-novo-nick').value.trim()) {
      dadosEspecificos.novo_nick = document.getElementById('req-novo-nick').value.trim();
    }

    const body = {
      tipo,
      alvos: [alvo],
      dados_especificos: Object.keys(dadosEspecificos).length ? dadosEspecificos : undefined,
      fundamentacao: document.getElementById('req-motivo').value.trim() || undefined,
      crime_id: (config.tiposComCrime || []).includes(tipo) && document.getElementById('req-crime').value
        ? Number(document.getElementById('req-crime').value) : undefined,
      tag_aplicada: (config.tiposComTag || []).includes(tipo)
        ? document.getElementById('req-tag').value.trim() : undefined,
      autorizado_por_id: (config.tiposComPermissao || []).includes(tipo) && permissaoSelecionadaId
        ? permissaoSelecionadaId : undefined,
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
    permissaoSelecionadaId = null;
    alvoAtualPatenteOrdem = null;
    alvoAtualStatus = null;
    renderPreviewVazio('Digite o nick do alvo pra ver o perfil aqui.');
    atualizarCamposCondicionais();
    atualizarOpcaoVoltaLicenca();
    carregarRecentes();
  });
}
