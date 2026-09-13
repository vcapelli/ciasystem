// tweets.js — card de tweet compartilhado entre /feed.html e a aba
// "Feed" do perfil, pra ficarem idênticos (inclusive nos repostados).

function tempoRelativoTweet(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} hora${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d === 1 ? '' : 's'}`;
}

function renderAvatarTweet(nick, figure, tamanho) {
  const avatar = figure ? avatarUrl(figure, 'mini', '2') : null;
  const classeTamanho = tamanho === 'pequeno' ? 'h-7 w-7' : 'h-11 w-11';
  const margemTopo = tamanho === 'pequeno' ? '-mt-2' : '-mt-3';
  return `
    <span class="${classeTamanho} rounded-full bg-basebg border border-border overflow-hidden inline-block shrink-0">
      ${avatar
        ? `<img src="${avatar}" class="w-full h-[190%] object-cover object-top ${margemTopo} transition-transform duration-300 hover:-translate-y-[8px]" alt="">`
        : `<span class="w-full h-full flex items-center justify-center text-[0.6rem] font-bold">${nick.slice(0,2).toUpperCase()}</span>`}
    </span>
  `;
}

// Busca a figure de cada autor_nick distinto num array de tweets, em
// paralelo, e preenche t.autor_figure em cada um (mutando o array).
async function preencherFigurasTweets(tweets) {
  const nicksUnicos = [...new Set(tweets.map((t) => t.autor_nick))];
  const figurasPorNick = {};
  await Promise.all(nicksUnicos.map(async (nick) => {
    try {
      const r = await apiFetch(`/usuarios/nick/${encodeURIComponent(nick)}`);
      figurasPorNick[nick] = r.ok ? (await r.json()).figure : null;
    } catch { figurasPorNick[nick] = null; }
  }));
  tweets.forEach((t) => { t.autor_figure = figurasPorNick[t.autor_nick]; });
}

function renderComentario(r) {
  return `
    <div class="flex items-start gap-2 px-4 py-2">
      ${renderAvatarTweet(r.autor_nick, r.autor_figure, 'pequeno')}
      <div class="min-w-0">
        <p class="text-xs font-semibold">${r.autor_nick}</p>
        <p class="text-xs whitespace-pre-wrap break-words">${r.conteudo}</p>
      </div>
    </div>
  `;
}

// `cabecalhoRepostagem`, se passado, é o nick de quem repostou —
// desenha o aviso "{nick} repostou:" acima do card, que fica igual ao
// post original por baixo.
function renderCardTweet(t, cabecalhoRepostagem) {
  return `
    <div>
      ${cabecalhoRepostagem ? `
        <p class="text-xs text-muted font-semibold flex items-center gap-1.5 mb-1.5 px-1">
          <i class="fa-solid fa-retweet"></i> ${cabecalhoRepostagem} repostou:
        </p>
      ` : ''}
      <div class="bg-card border border-border rounded-2xl p-4" data-tweet-id="${t.id}">
        <div class="flex items-center gap-2.5 mb-1">
          ${renderAvatarTweet(t.autor_nick, t.autor_figure, 'grande')}
          <div>
            <p class="font-semibold text-sm">${t.autor_nick}${t.autor_patente_nome ? ` <span class="text-muted font-normal">· ${t.autor_patente_nome}</span>` : ''}</p>
          </div>
        </div>
        <p class="text-xs text-muted flex items-center gap-1 mb-2"><i class="fa-regular fa-clock"></i> ${tempoRelativoTweet(t.criado_em)}</p>
        ${t.conteudo ? `<p class="text-sm whitespace-pre-wrap">${t.conteudo}</p>` : ''}
        <hr class="border-border my-3">
        <div class="flex items-center gap-6 text-xs text-muted">
          <button class="btn-curtir relative flex items-center gap-1.5 transition-colors ${t.curtido_por_mim ? 'text-accent' : 'hover:text-dark'}" data-id="${t.id}" data-tooltip="curtidas">
            <i class="${t.curtido_por_mim ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i> <span class="contador-curtidas">${t.curtidas}</span>
          </button>
          <button class="btn-comentar flex items-center gap-1.5 hover:text-dark transition-colors" data-id="${t.id}">
            <i class="fa-regular fa-comment"></i> <span class="contador-respostas">${t.respostas}</span>
          </button>
          <span class="relative flex items-center gap-1.5 hover:text-dark transition-colors" data-tooltip="retweets">
            <i class="fa-solid fa-retweet"></i> ${t.retweets}
          </span>
        </div>
        <div id="comentarios-${t.id}" class="hidden mt-3 -mx-4 -mb-4 border-t border-border"></div>
      </div>
    </div>
  `;
}

// ---------- Tooltip de "quem curtiu/retuitou" ----------
const _cacheListaPessoasTweet = {};
async function _buscarListaPessoasTweet(tweetId, tipo) {
  const chave = `${tipo}-${tweetId}`;
  if (_cacheListaPessoasTweet[chave]) return _cacheListaPessoasTweet[chave];
  const resp = await apiFetch(`/tweets/${tweetId}/${tipo}`);
  const lista = resp.ok ? await resp.json() : [];
  _cacheListaPessoasTweet[chave] = lista;
  return lista;
}

function _ligarTooltipPessoasTweet(botao, tweetId, tipo) {
  let tooltip = null;
  let carregado = false;
  botao.addEventListener('mouseenter', async () => {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'absolute z-20 bottom-full left-0 mb-2 w-56 bg-card border border-border rounded-xl shadow-lg overflow-hidden';
      botao.style.position = 'relative';
      botao.appendChild(tooltip);
    }
    tooltip.classList.remove('hidden');
    if (carregado) return;
    tooltip.innerHTML = '<p class="text-xs text-muted p-3">Carregando…</p>';
    const lista = await _buscarListaPessoasTweet(tweetId, tipo);
    carregado = true;
    tooltip.innerHTML = `
      <p class="text-xs font-semibold px-3 py-2 border-b border-border">${tipo === 'curtidas' ? 'Curtiram' : 'Retuitaram'} (${lista.length})</p>
      <div class="max-h-48 overflow-y-auto">
        ${lista.length ? lista.map((p) => `
          <a href="/perfil/${p.nick}" class="flex items-center gap-2 px-3 py-2 hover:bg-basebg transition-colors">
            <span class="h-7 w-7 rounded-full bg-basebg border border-border flex items-center justify-center text-[0.6rem] font-bold shrink-0">${p.nick.slice(0,2).toUpperCase()}</span>
            <span class="min-w-0">
              <p class="text-xs font-semibold truncate">${p.nick}</p>
              <p class="text-[0.65rem] text-muted truncate">${p.patente_nome || '—'}</p>
            </span>
          </a>
        `).join('') : `<p class="text-xs text-muted p-3">${tipo === 'curtidas' ? 'Ninguém curtiu ainda.' : 'Ninguém retuitou ainda.'}</p>`}
      </div>
    `;
  });
  botao.addEventListener('mouseleave', () => { if (tooltip) tooltip.classList.add('hidden'); });
}

// ---------- Comentários (abre/fecha o apêndice, lista, envia) ----------
async function _abrirComentarios(tweetId, me) {
  const container = document.getElementById(`comentarios-${tweetId}`);
  const abrindo = container.classList.contains('hidden');
  container.classList.add('hidden');
  if (!abrindo) return;
  container.classList.remove('hidden');
  container.innerHTML = '<p class="text-xs text-muted p-4">Carregando…</p>';

  const resp = await apiFetch(`/tweets/${tweetId}/respostas`);
  const respostas = resp.ok ? await resp.json() : [];
  await preencherFigurasTweets(respostas);

  container.innerHTML = `
    <div class="divide-y divide-border">${respostas.map(renderComentario).join('')}</div>
    <div class="flex items-start gap-2 px-4 py-3 border-t border-border">
      ${renderAvatarTweet(me.nick, me.figure, 'pequeno')}
      <form data-form-comentario="${tweetId}" class="flex-1">
        <textarea maxlength="150" rows="2" placeholder="Escreva um comentário…"
          class="w-full bg-transparent resize-none text-sm placeholder:text-muted/60 focus:outline-none"></textarea>
        <div class="flex items-center justify-between">
          <p class="text-[0.65rem] text-muted"><span class="contador-caracteres">0</span>/150</p>
          <button type="submit" class="text-xs font-semibold bg-accent hover:bg-accent-dark text-white rounded-lg px-3 py-1.5 transition-colors">Comentar</button>
        </div>
      </form>
    </div>
  `;

  const textarea = container.querySelector('textarea');
  const contador = container.querySelector('.contador-caracteres');
  textarea.addEventListener('input', () => { contador.textContent = textarea.value.length; });

  container.querySelector('[data-form-comentario]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const conteudo = textarea.value.trim();
    if (!conteudo) return;
    const respComentar = await apiFetch('/tweets', {
      method: 'POST',
      body: JSON.stringify({ conteudo, resposta_a_id: Number(tweetId) }),
    });
    if (!respComentar.ok) return;

    const card = container.closest('[data-tweet-id]');
    const contadorRespostas = card.querySelector('.contador-respostas');
    contadorRespostas.textContent = Number(contadorRespostas.textContent) + 1;

    container.classList.add('hidden');
    _abrirComentarios(tweetId, me);
  });
}

// Liga todos os botões (curtir, tooltip, comentar) dentro de um
// container que já tenha cards renderizados por renderCardTweet.
function ligarAcoesTweet(raiz, me) {
  raiz.querySelectorAll('.btn-curtir').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const resp = await apiFetch(`/tweets/${btn.dataset.id}/curtir`, { method: 'POST' });
      if (!resp.ok) return;
      const { curtido } = await resp.json();
      const contador = btn.querySelector('.contador-curtidas');
      contador.textContent = Number(contador.textContent) + (curtido ? 1 : -1);
      btn.classList.toggle('text-accent', curtido);
      btn.querySelector('i').className = curtido ? 'fa-solid fa-thumbs-up' : 'fa-regular fa-thumbs-up';
    });
  });

  raiz.querySelectorAll('[data-tooltip="curtidas"]').forEach((el) => {
    _ligarTooltipPessoasTweet(el, el.closest('[data-tweet-id]').dataset.tweetId, 'curtidas');
  });
  raiz.querySelectorAll('[data-tooltip="retweets"]').forEach((el) => {
    _ligarTooltipPessoasTweet(el, el.closest('[data-tweet-id]').dataset.tweetId, 'retweets');
  });

  raiz.querySelectorAll('.btn-comentar').forEach((btn) => {
    btn.addEventListener('click', () => _abrirComentarios(btn.dataset.id, me));
  });
}
