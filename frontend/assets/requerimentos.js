// Formulário genérico de requerimento, reutilizado pelas páginas de
// /requerimentos/*.html — cada página só passa uma config descrevendo
// quais tipos aceita e quais campos extras precisa.

const TITULOS_TIPO_REQ = {
  instrucao_inicial: 'Instrução Inicial', contratacao: 'Contratação', promocao: 'Promoção',
  rebaixamento: 'Rebaixamento', advertencia: 'Advertência', licenca: 'Licença',
  volta_licenca: 'Volta de Licença', transferencia_conta: 'Transferência de Conta',
  transferencia_corpo: 'Transferência de Corpo', venda_cargo: 'Venda de Cargo', integracao: 'Integração', tag: 'TAG',
  turno_tarefa: 'Turno/Tarefa', reforma: 'Reforma', desligamento_honroso: 'Desligamento Honroso',
  desligamento_desonroso: 'Desligamento Desonroso', exoneracao: 'Exoneração',
  bonificacao: 'Bonificação', cancelamento: 'Cancelamento',
};

function tituloTipoReq(tipo) {
  return TITULOS_TIPO_REQ[tipo] || tipo.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

const MESES_CURTOS_REQ = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function formatarDataCurtaReq(iso) {
  if (!iso) return '';
  // Data pura (input type="date", ex: '2026-09-04', sem horário) —
  // 'new Date("2026-09-04")' é interpretado como meia-noite UTC, e os
  // getters usados abaixo (getDate/getMonth) leem em horário LOCAL.
  // Em fuso negativo (ex: BRT/UTC-3) meia-noite UTC já é o dia
  // anterior às 21h local, então o dia exibido "anda pra trás" um dia.
  // Pra data pura, lê os componentes direto da string — sem passar
  // por conversão de fuso nenhuma. Datas com horário (ex: criado_em,
  // que é um instante de verdade) continuam pelo caminho de sempre.
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (soData) return `${soData[3]} ${MESES_CURTOS_REQ[Number(soData[2]) - 1]} ${soData[1]}`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')} ${MESES_CURTOS_REQ[d.getMonth()]} ${d.getFullYear()}`;
}

// Apêndice de identificação com advertências escritas ainda ativas
// (dentro dos 30 dias), ex: " - {1 ADV: 16 Set 2026 até 16 Out 2026}".
// Some sozinho depois que a advertência expira. Usado no card de
// requerimento e nas listagens — de propósito NÃO usado no perfil.
function formatarApendiceAdvertencias(advertencias) {
  if (!advertencias?.length) return '';
  const partes = advertencias.map((a, i) => `${i + 1} ADV: ${formatarDataCurtaReq(a.inicio)} até ${formatarDataCurtaReq(a.fim)}`);
  return ` - {${partes.join(' / ')}}`;
}

async function buscarApendiceAdvertencias(usuarioId) {
  if (!usuarioId) return '';
  try {
    const r = await apiFetch(`/requerimentos/advertencias-ativas/${usuarioId}`);
    return formatarApendiceAdvertencias(r.ok ? await r.json() : []);
  } catch {
    return '';
  }
}

// Mesma ideia acima, mas pra licença de serviço em vigor, ex:
// " - {Licença: 16 Set 2026 até 16 Out 2026}". Some sozinho quando a
// pessoa volta de licença.
function formatarApendiceLicenca(licenca) {
  if (!licenca?.fim) return '';
  return ` - {Licença: ${formatarDataCurtaReq(licenca.inicio)} até ${formatarDataCurtaReq(licenca.fim)}}`;
}

async function buscarApendiceLicenca(usuarioId) {
  if (!usuarioId) return '';
  try {
    const r = await apiFetch(`/requerimentos/licenca-ativa/${usuarioId}`);
    return formatarApendiceLicenca(r.ok ? await r.json() : null);
  } catch {
    return '';
  }
}

// Busca os dois apêndices (advertências + licença) de uma vez e já
// devolve concatenados, prontos pra colar na identificação.
async function buscarApendiceIdentificacao(usuarioId) {
  const [adv, lic] = await Promise.all([
    buscarApendiceAdvertencias(usuarioId),
    buscarApendiceLicenca(usuarioId),
  ]);
  return adv + lic;
}

/**
 * Card completo de um requerimento — usado tanto na lista "Recentes"
 * das páginas de requerimento quanto na linha do tempo do perfil, pra
 * ficarem idênticos nos dois lugares.
 * `patentesMapa` = { id: nome } de todas as patentes.
 * `meAtual` = usuário logado (pra saber se mostra o apêndice de admin).
 * `mostrarApendices` = false no perfil, de propósito (ver comentário
 * de `apendicePreviaLicenca` abaixo) — nos outros lugares fica true.
 */
function renderCardRequerimento(r, patentesMapa, meAtual, apendiceExtra = '', mostrarApendices = true) {
  const cor = COR_STATUS_REQ[r.status] || COR_STATUS_REQ.pendente;
  const alvos = r.alvos_json ? JSON.parse(r.alvos_json) : [];
  const alvoPrincipal = alvos[0];
  const alvosTexto = alvos.map((a) => a.nick).join(' / ') || '—';
  let dadosEspecificos = {};
  try { dadosEspecificos = r.dados_especificos ? JSON.parse(r.dados_especificos) : {}; } catch {}
  // Apêndice de alerta (não bloqueante): requisitos de patente que
  // ainda faltam para o(s) alvo(s) — calculado pelo backend na
  // criação do requerimento. Nunca impede aprovar, só avisa.
  let alertasRequisitos = {};
  try { alertasRequisitos = r.alertas_requisitos ? JSON.parse(r.alertas_requisitos) : {}; } catch {}
  const listaAlertas = Object.values(alertasRequisitos).flat();

  const ehInstrucaoInicial = r.tipo === 'instrucao_inicial';
  const avatarAutor = r.autor_figure ? avatarUrl(r.autor_figure, 'mini', '2') : null;
  const autorPatenteTexto = r.autor_patente_nome || (r.autor_tipo === 'conta_oficial' ? 'Conta institucional' : '—');
  const prefixoId = PREFIXO_IDENTIFICACAO_REQ[r.tipo] ?? '';
  const tagUsada = dadosEspecificos.tag_utilizada || r.autor_tag || '—';
  // Enquanto o requerimento de licença ainda está pendente, o
  // apêndice "{Licença: ... até ...}" vindo do backend
  // (buscarApendiceLicenca) ainda não existe — só passa a existir
  // depois de aprovado, porque só aí `usuarios.status` vira 'licenca'.
  // Pra já mostrar uma prévia de como vai ficar, monta esse mesmo
  // trecho aqui na hora, usando os dados do próprio requerimento
  // (data de criação + data de retorno preenchida no formulário). Uma
  // vez aprovado, para de se auto-calcular e passa a confiar só no
  // apendiceExtra (vindo do backend) — evita mostrar duplicado.
  // Só entra em `mostrarApendices`, igual ao apêndice de advertências
  // — no perfil nenhum dos dois aparece, de propósito.
  const apendicePreviaLicenca = (mostrarApendices && r.tipo === 'licenca' && r.status === 'pendente' && dadosEspecificos.data_retorno)
    ? ` - {Licença: ${formatarDataCurtaReq(r.criado_em)} até ${formatarDataCurtaReq(dadosEspecificos.data_retorno)}}`
    : '';

  // Integração: usa a data histórica informada (ingresso real na
  // organização) na identificação em vez da data de hoje, que só
  // reflete quando o registro foi migrado pro sistema novo.
  const dataIdentificacao = (r.tipo === 'integracao' && dadosEspecificos.data) ? dadosEspecificos.data : r.criado_em;

  const identificacao = r.tipo === 'exoneracao'
    ? (alvoPrincipal ? `${alvoPrincipal.nick} [${alvoPrincipal.tag || '---'}] [${tagUsada}] {${r.crime_nome || r.fundamentacao || ''}} - ${formatarDataCurtaReq(r.criado_em)} até ${dadosEspecificos.exoneracao_ate ? formatarDataCurtaReq(dadosEspecificos.exoneracao_ate) : 'Indeterminado'}` : null)
    : (alvoPrincipal ? `${alvoPrincipal.nick} [${prefixoId}${tagUsada}] ${formatarDataCurtaReq(dataIdentificacao)}${apendiceExtra}${apendicePreviaLicenca}` : null);

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
  if (dadosEspecificos.data_retorno) linhasExtras.push(`<b>Data de retorno:</b> ${formatarDataCurtaReq(dadosEspecificos.data_retorno)}`);
  if (r.tipo === 'integracao' && dadosEspecificos.data) linhasExtras.push(`<b>Data de ingresso (histórica):</b> ${formatarDataCurtaReq(dadosEspecificos.data)}`);
  if (dadosEspecificos.exoneracao_ate) linhasExtras.push(`<b>Exoneração até:</b> ${formatarDataCurtaReq(dadosEspecificos.exoneracao_ate)}`);
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
          <p class="text-xs font-semibold">${autorPatenteTexto}</p>
        </div>

        <div class="flex-1 text-sm space-y-1.5 min-w-0">
          <p class="text-muted">${r.autor_patente_nome || (r.autor_tipo === 'conta_oficial' ? 'Conta institucional' : '')} <b class="text-dark">${r.autor_nick || ''}</b> escreveu:</p>
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

      ${listaAlertas.length ? `
        <div class="px-4 pb-3">
          <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p class="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
              <i class="fa-solid fa-triangle-exclamation"></i> Requisitos pendentes (não impede aprovar)
            </p>
            <ul class="text-xs text-amber-700 mt-1 list-disc list-inside space-y-0.5">
              ${listaAlertas.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
            </ul>
          </div>
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

/**
 * Liga os cliques de Aprovar/Reprovar/Cancelar/Excluir dentro de um
 * container que tenha cards renderizados por renderCardRequerimento.
 * `aoConcluir` é chamado depois de qualquer ação, pra recarregar a lista.
 */
function ligarAcoesRequerimento(container, aoConcluir) {
  container.addEventListener('click', async (e) => {
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
      const resp = await apiFetch(`/requerimentos/${reqId}/alvos/${btn.dataset.alvo}/decidir`, {
        method: 'POST',
        body: JSON.stringify({ status: acao === 'aprovar' ? 'aprovado' : 'reprovado', motivo_recusa: motivo_recusa || undefined }),
      });
      if (!resp.ok) {
        const dados = await resp.json().catch(() => ({}));
        alert(dados.erro || 'Não foi possível decidir esse requerimento.');
        return;
      }
      aoConcluir();
    } else if (acao === 'cancelar') {
      if (!confirm('Cancelar este requerimento? Se ele já estava aprovado, o efeito aplicado será revertido (ex: volta à patente/TAG/status de antes).')) return;
      const motivo = prompt('Motivo do cancelamento (opcional):') || undefined;
      const resp = await apiFetch(`/requerimentos/${reqId}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) });
      if (!resp.ok) {
        const dados = await resp.json().catch(() => ({}));
        alert(dados.erro || 'Não foi possível cancelar esse requerimento.');
        return;
      }
      aoConcluir();
    } else if (acao === 'excluir') {
      if (!confirm('Excluir este requerimento definitivamente do histórico? Essa ação não pode ser desfeita.')) return;
      const resp = await apiFetch(`/requerimentos/${reqId}`, { method: 'DELETE' });
      if (!resp.ok) {
        const dados = await resp.json().catch(() => ({}));
        alert(dados.erro || 'Não foi possível excluir esse requerimento.');
        return;
      }
      aoConcluir();
    }
  });
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
 *   tiposComDataIntegracao: [tipo, ...], // integração: data histórica de ingresso/último ato funcional
 *   tiposComExoneracao: [tipo, ...],   // temporária/indeterminada
 *   tipoVoltaLicencaCondicional: bool, // só habilita 'volta_licenca' se o alvo estiver de licença
 *   usaNovoNick: bool,                 // transferência de conta
 *   permiteAutoAlvo: bool,             // se true, ignora o bloqueio de "não pode ser o próprio alvo" (ex: TAGs)
 *   verificarExistente: bool,          // com alvoLivre, tenta achar um membro já existente antes de cair no preview genérico do Habblet
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
    <div id="req-aviso-postar-como" class="hidden mb-3 flex items-center gap-2 bg-accent/10 border border-accent/30 text-accent text-sm font-semibold rounded-xl px-4 py-2.5">
      <i class="fa-solid fa-user-shield"></i> <span id="req-aviso-postar-como-texto"></span>
    </div>
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
                <select id="req-tag-autor-select" class="hidden w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"></select>
                <input id="req-tag-customizada" placeholder="Digite a TAG" maxlength="10" class="hidden w-full mt-2 bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                <input id="req-tag-autor" maxlength="10" placeholder="TAG" disabled
                  class="w-full bg-border/40 border border-border rounded-lg px-3 py-2 text-sm text-muted cursor-not-allowed">
              </div>

              <div id="req-campo-postar-como" class="hidden">
                <label class="block text-xs text-muted mb-1">Postar em nome de</label>
                <select id="req-postar-como" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                  <option value="">Eu mesmo</option>
                </select>
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

              <div id="req-campo-data-integracao" class="hidden sm:col-span-2">
                <label class="block text-xs text-muted mb-1">Data de ingresso (histórica)</label>
                <input id="req-data-integracao" type="date" class="w-full bg-basebg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                <p class="text-xs text-muted mt-1">Data real em que a pessoa entrou na organização no sistema antigo. Define o ingresso e o último ato funcional dela — deixe em branco só se ela tiver entrado hoje mesmo, senão o tempo de serviço já cumprido é perdido e a próxima promoção pode ficar bloqueada.</p>
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
  const selectTagAutor = document.getElementById('req-tag-autor-select');
  const inputTagCustomizada = document.getElementById('req-tag-customizada');
  const campoPostarComo = document.getElementById('req-campo-postar-como');
  const selectPostarComo = document.getElementById('req-postar-como');
  let meAtual = null;
  const promessaMe = apiFetch('/usuarios/me').then(async (r) => {
    if (!r.ok) return;
    meAtual = await r.json();
    if (meAtual.tag) inputTagAutor.value = meAtual.tag;

    // Membro ativo de um grupo de Órgão de Topo/Setor de Inteligência
    // pode postar com a TAG (código) do grupo em vez da própria.
    // Admin do sistema tem via livre: qualquer grupo, de qualquer
    // tipo, e ainda pode digitar uma TAG totalmente livre.
    const gruposResp = await apiFetch(meAtual.administrador_sistema ? '/grupos' : `/grupos/usuario/${meAtual.id}`);
    const grupos = gruposResp.ok ? await gruposResp.json() : [];
    const gruposComTag = meAtual.administrador_sistema
      ? grupos
      : grupos.filter((g) => g.tipo === 'orgao_topo' || g.tipo === 'setor_inteligencia');

    if (gruposComTag.length || meAtual.administrador_sistema) {
      selectTagAutor.innerHTML = `
        <option value="">Minha TAG${meAtual.tag ? ` (${meAtual.tag})` : ''}</option>
        ${gruposComTag.map((g) => `<option value="${g.id}">${g.codigo} (${g.nome})</option>`).join('')}
        ${meAtual.administrador_sistema ? '<option value="customizada">Outra TAG (digitar)</option>' : ''}
      `;
      selectTagAutor.classList.remove('hidden');
      inputTagAutor.classList.add('hidden');
      selectTagAutor.addEventListener('change', () => {
        inputTagCustomizada.classList.toggle('hidden', selectTagAutor.value !== 'customizada');
      });
    }

    // Admin do sistema pode postar em nome de uma conta institucional.
    if (meAtual.administrador_sistema) {
      const contasResp = await apiFetch('/usuarios?tipo=conta_oficial');
      const contas = contasResp.ok ? await contasResp.json() : [];
      if (contas.length) {
        selectPostarComo.innerHTML = `
          <option value="">Eu mesmo</option>
          ${contas.map((cta) => `<option value="${cta.id}" data-nick="${cta.nick}">${cta.nick}</option>`).join('')}
        `;
        campoPostarComo.classList.remove('hidden');
        selectPostarComo.addEventListener('change', atualizarAvisoPostarComo);
      }
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
  const campoDataIntegracao = document.getElementById('req-campo-data-integracao');
  const campoExoneracao = document.getElementById('req-campo-exoneracao');
  const campoNovoNick = document.getElementById('req-campo-novo-nick');
  const previewEl = document.getElementById('req-alvo-preview');

  document.getElementById('req-exoneracao-tipo')?.addEventListener('change', (e) => {
    document.getElementById('req-campo-exoneracao-data').classList.toggle('hidden', e.target.value !== 'temporaria');
  });

  function atualizarAvisoPostarComo() {
    const aviso = document.getElementById('req-aviso-postar-como');
    const opcaoSelecionada = selectPostarComo.selectedOptions[0];
    if (selectPostarComo.value && opcaoSelecionada) {
      document.getElementById('req-aviso-postar-como-texto').textContent =
        `Este requerimento será postado em nome da conta institucional "${opcaoSelecionada.dataset.nick}".`;
      aviso.classList.remove('hidden');
    } else {
      aviso.classList.add('hidden');
    }
  }

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
    // Se a página permitir (ex: exoneração), tenta antes achar um
    // membro já existente com esse nick, pra mostrar o perfil de
    // verdade em vez do preview genérico do Habblet.
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

        if (config.verificarExistente) {
          const perfilResp = await apiFetch(`/usuarios/nick/${encodeURIComponent(nick)}`);
          if (perfilResp.ok) {
            const perfil = await perfilResp.json();
            const historicoResp = await apiFetch(`/requerimentos/alvo/${perfil.id}`);
            const historico = historicoResp.ok ? await historicoResp.json() : [];
            renderPreviewUsuario(perfil, historico[0]?.criado_em);
            return;
          }
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
    await promessaMe;
    const resp = await apiFetch(`/patentes?corpo=${config.patenteCorpo}`);
    let todasPatentes = resp.ok ? await resp.json() : [];
    if (!meAtual?.administrador_sistema) {
      todasPatentes = todasPatentes.filter((p) => !p.eh_suprema);
    }
    patentesCacheCompleta = todasPatentes;
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
    campoDataIntegracao.classList.toggle('hidden', !(config.tiposComDataIntegracao || []).includes(tipoAtual));
    campoExoneracao.classList.toggle('hidden', !(config.tiposComExoneracao || []).includes(tipoAtual));
    if (campoNovoNick) campoNovoNick.classList.toggle('hidden', !config.usaNovoNick);
    atualizarOpcoesPatenteFiltradas();
  }
  selectTipo.addEventListener('change', atualizarCamposCondicionais);
  atualizarCamposCondicionais();
  atualizarOpcaoVoltaLicenca();

  async function renderCardRecente(r) {
    const alvos = r.alvos_json ? JSON.parse(r.alvos_json) : [];
    const apendice = await buscarApendiceIdentificacao(alvos[0]?.usuario_id);
    return renderCardRequerimento(r, patentesMapa, meAtual, apendice);
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
      ? (await Promise.all(filtrados.map(renderCardRecente))).join('')
      : '<p class="text-sm text-muted">Nenhum requerimento deste tipo ainda.</p>';
  }
  carregarRecentes();

  ligarAcoesRequerimento(document.getElementById('req-recentes'), carregarRecentes);

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
    const grupoTagEscolhidoId = !selectTagAutor.classList.contains('hidden') && selectTagAutor.value && selectTagAutor.value !== 'customizada' ? Number(selectTagAutor.value) : null;
    const tagCustomizadaEscolhida = !selectTagAutor.classList.contains('hidden') && selectTagAutor.value === 'customizada' ? inputTagCustomizada.value.trim() : null;
    if (grupoTagEscolhidoId) {
      dadosEspecificos.tag_utilizada = selectTagAutor.selectedOptions[0].textContent.split(' ')[0];
    } else if (tagCustomizadaEscolhida) {
      dadosEspecificos.tag_utilizada = tagCustomizadaEscolhida;
    } else if (meAtual?.tag) {
      dadosEspecificos.tag_utilizada = meAtual.tag;
    }
    if ((config.tiposComCrime || []).includes(tipo) && document.getElementById('req-provas').value.trim()) {
      dadosEspecificos.provas = document.getElementById('req-provas').value.trim();
    }
    if ((config.tiposComDataRetorno || []).includes(tipo) && document.getElementById('req-data-retorno').value) {
      dadosEspecificos.data_retorno = document.getElementById('req-data-retorno').value;
    }
    if ((config.tiposComDataIntegracao || []).includes(tipo) && document.getElementById('req-data-integracao').value) {
      dadosEspecificos.data = document.getElementById('req-data-integracao').value;
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
      postar_com_tag_grupo_id: grupoTagEscolhidoId || undefined,
      tag_customizada: tagCustomizadaEscolhida || undefined,
      postar_como_conta_id: selectPostarComo.value ? Number(selectPostarComo.value) : undefined,
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
