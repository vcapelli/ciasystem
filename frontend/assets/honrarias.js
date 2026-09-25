// Página /listagens/honrarias.html — mostra toda medalha concedida
// (tipo 'temporaria'/'efetiva'/'honraria_particular'/'honra' da tabela
// `medalhas`), separada em duas seções: Honrarias Permanentes (efetiva,
// honraria particular, medalha de honra — nunca expiram) e Honrarias
// Temporárias (só as ainda vigentes; uma temporária vencida some sozinha
// daqui, mas continua no histórico/perfil de quem recebeu).
//
// Bespoke de propósito (não reaproveita montarListagem de listagens.js)
// — o layout de cards com avatar grande não se parece com nenhuma
// listagem existente (grupo por patente/status, ranking, lista flat).

const TITULOS_MEDALHA = {
  temporaria: 'Medalha Temporária',
  efetiva: 'Medalha Efetiva',
  honraria_particular: 'Honraria Particular',
  honra: 'Medalha de Honra',
};

function partesDataHonraria(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (m) return { dia: Number(m[3]), mes: Number(m[2]) - 1, ano: Number(m[1]) };
  const d = new Date(iso);
  return { dia: d.getDate(), mes: d.getMonth(), ano: d.getFullYear() };
}

// "24 à 30 Set 2026" quando início e fim caem no mesmo mês/ano (caso
// comum pra medalha temporária); só repete o "Mmm AAAA" quando o
// intervalo cruza a virada do mês/ano.
function formatarIntervaloHonraria(inicioIso, fimIso) {
  const ini = partesDataHonraria(inicioIso);
  const diaIni = String(ini.dia).padStart(2, '0');
  if (!fimIso) return `${diaIni} ${MESES_CURTOS_REQ[ini.mes]} ${ini.ano}`;
  const fim = partesDataHonraria(fimIso);
  const diaFim = String(fim.dia).padStart(2, '0');
  if (ini.ano === fim.ano && ini.mes === fim.mes) {
    return `${diaIni} à ${diaFim} ${MESES_CURTOS_REQ[fim.mes]} ${fim.ano}`;
  }
  return `${diaIni} ${MESES_CURTOS_REQ[ini.mes]} ${ini.ano} à ${diaFim} ${MESES_CURTOS_REQ[fim.mes]} ${fim.ano}`;
}

function medalhaAindaVigente(m) {
  if (!m.expira_em) return true;
  const fim = partesDataHonraria(m.expira_em);
  const fimMs = Date.UTC(fim.ano, fim.mes, fim.dia, 23, 59, 59);
  return fimMs >= Date.now();
}

function renderCardHonraria(m) {
  // nick/tag/motivo são texto livre (motivo vem de
  // requerimentos.fundamentacao) — sempre escapar antes de interpolar.
  const nickEsc = escapeHtml(m.nick);
  const tagEsc = m.tag ? escapeHtml(m.tag) : '';
  const motivoEsc = escapeHtml(m.motivo || '');
  const avatar = m.figure ? avatarUrl(m.figure, 'mini', '2') : null;

  return `
    <div class="bg-card border border-border rounded-2xl shadow-sm p-5 flex flex-col items-center text-center gap-3">
      <span class="group h-32 w-32 rounded-full bg-basebg border border-border overflow-hidden inline-block shrink-0">
        ${avatar
          ? `<img src="${avatar}" class="w-full h-[190%] object-cover object-top -mt-8 transition-transform duration-300 group-hover:-translate-y-[18px]" alt="">`
          : `<span class="w-full h-full flex items-center justify-center text-2xl font-bold">${nickEsc.slice(0, 2).toUpperCase()}</span>`}
      </span>
      <span class="text-sm font-semibold px-3 py-1 rounded-full bg-accent/15 text-accent">${nickEsc}${tagEsc ? ` [${tagEsc}]` : ''}</span>
      <p class="text-sm text-dark min-h-[1.25rem]">${motivoEsc || '<span class="text-muted italic">Sem motivo registrado.</span>'}</p>
      ${m.expira_em ? `
        <p class="text-xs text-muted flex items-center gap-1.5">
          <i class="fa-regular fa-clock"></i> ${formatarIntervaloHonraria(m.data_concessao, m.expira_em)}
        </p>
      ` : ''}
    </div>
  `;
}

function renderSecaoHonraria(titulo, itens) {
  return `
    <div class="mb-8">
      <h2 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">${titulo} (${itens.length})</h2>
      ${itens.length
        ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${itens.map(renderCardHonraria).join('')}</div>`
        : '<p class="text-sm text-muted">Nenhuma honraria concedida ainda.</p>'}
    </div>
  `;
}

async function montarHonrarias() {
  const raiz = document.getElementById('honrarias-raiz');
  raiz.innerHTML = '<p class="text-sm text-muted">Carregando…</p>';

  const resp = await apiFetch('/medalhas');
  if (!resp.ok) {
    raiz.innerHTML = '<p class="text-sm text-red-400">Não foi possível carregar as honrarias.</p>';
    return;
  }

  const todas = await resp.json();
  const permanentes = todas.filter((m) => m.tipo !== 'temporaria');
  const temporarias = todas.filter((m) => m.tipo === 'temporaria' && medalhaAindaVigente(m));

  raiz.innerHTML = renderSecaoHonraria('Honrarias Permanentes', permanentes)
    + renderSecaoHonraria('Honrarias Temporárias', temporarias);
}
