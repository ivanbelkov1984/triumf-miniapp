// ТРИУМФ — админка мини-приложения: цены, фото, данные карточек, профиль Вадима, история с откатом.
// Показывается только админу: сервер проверяет подпись Telegram и ID (кнопки в интерфейсе — лишь удобство, не защита).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const MEDIA_RE = /^media\/[a-f0-9]{16,64}\.webp$/;
const ASSET_RE = /^assets\/catalog\/(covers|gallery)\/[A-Za-z0-9_\-/.]{1,120}\.(webp|jpg|jpeg|png)$/;
export const okPath = p => typeof p === 'string' && !p.includes('..') && (MEDIA_RE.test(p) || ASSET_RE.test(p));

/* ---------- Клиент API ---------- */
export function createApi(base, getInitData) {
  const root = String(base || '').replace(/\/$/, '');
  const withTimeout = async (fn, ms) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { return await fn(ctl.signal); } catch (e) { if (e.name === 'AbortError') throw new Error('Сервер не отвечает. Попробуйте ещё раз.'); throw e; } finally { clearTimeout(t); }
  };
  const parse = async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { const e = new Error(j.error || `Ошибка ${r.status}`); e.code = j.code; e.status = r.status; throw e; }
    return j;
  };
  return {
    base: root,
    mediaUrl: p => `${root}/${p}`,
    publicData: (ms = 2500) => withTimeout(s => fetch(`${root}/api/public`, { signal: s, cache: 'no-cache' }).then(parse), ms),
    call: (path, body = {}, ms = 15000) => withTimeout(s => fetch(root + path, {
      method: 'POST', signal: s, headers: { 'Content-Type': 'application/json', 'X-Init-Data': getInitData() }, body: JSON.stringify(body) }).then(parse), ms),
    upload: (file, kind = 'photo') => withTimeout(s => {
      const fd = new FormData(); fd.append('file', file, file.name || 'photo');
      return fetch(`${root}/api/admin/upload?kind=${kind}`, { method: 'POST', signal: s, headers: { 'X-Init-Data': getInitData() }, body: fd }).then(parse);
    }, 60000),
  };
}

/* ---------- Правки поверх каталога ---------- */
const fold = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
const COPY_FIELDS = ['price', 'priceUpdatedAt', 'availabilityStatus', 'name', 'brand', 'series', 'description', 'displacementCc', 'powerHp',
  'weightKg', 'seatHeightMm', 'stroke', 'cooling', 'ptsStatus', 'wheelFormat', 'specs'];
export const MODEL_KEYS = [...COPY_FIELDS.filter(k => k !== 'priceUpdatedAt'), 'coverLight', 'gallery'];

export function applyOverrides(models, ov) {
  const map = ov?.models || {};
  for (const m of models) {
    const o = map[m.id]; if (!o) continue;
    for (const k of COPY_FIELDS) if (k in o) m[k] = o[k];
    if (okPath(o.coverLight)) { m.coverLight = o.coverLight; m.coverDark = o.coverLight; }
    if (Array.isArray(o.gallery)) m.gallery = o.gallery.filter(okPath).map(src => ({ src, thumb: src }));
    m.search = `${m.search || ''}${fold(`${m.id} ${m.name} ${m.brand} ${m.series || ''}`)}`;
    m._edited = true;
  }
  return models;
}

/* ---------- Вспомогательное ---------- */
const $ = (s, r = document) => r.querySelector(s);
const parseNum = (s, int = false) => {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || (int && !Number.isInteger(n))) throw new Error(int ? 'Нужно целое число' : 'Нужно число');
  return n;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const STATUS_ORDER = ['in_stock', 'order', 'unavailable'];

function field(id, label, value, attrs = '') {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${esc(value ?? '')}" ${attrs}></div>`;
}
function selectField(id, label, value, options) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options.map(([v, t]) => `<option value="${esc(v)}"${String(value ?? '') === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
}
const thumbSrc = (ctx, p) => ctx.asset(p);

/* ---------- Главная админки ---------- */
const listState = { q: '', shown: 30 };
function renderHome(ctx) {
  const { view } = ctx;
  const q = listState.q.trim().toLowerCase();
  const all = ctx.getModels().filter(m => !q || `${m.id} ${m.name}`.toLowerCase().includes(q));
  const list = all.slice(0, listState.shown);
  view.innerHTML = `<h2 class="sec">Админка</h2>
    <p class="lead-text">Цены, фото и данные карточек. Изменения сразу видны всем клиентам в каталоге.</p>
    <div class="actions">
      <a class="btn" href="#/admin/profile" data-adm-nav>Профиль и логотип</a>
      <a class="btn" href="#/admin/history" data-adm-nav>История изменений</a>
    </div>
    <div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <label class="sr-only" for="adm-q">Поиск модели</label>
      <input id="adm-q" type="search" autocomplete="off" placeholder="Модель или TR-код" value="${esc(listState.q)}"></div>
    <p class="count">${all.length} из ${ctx.getModels().length}</p>
    <div class="adm-list">${list.map(m => `<a class="adm-item" href="#/admin/m/${m.id}" data-adm-nav>
        <img src="${esc(thumbSrc(ctx, m.coverLight))}" alt="" width="64" height="48" loading="lazy">
        <span class="adm-main"><b>${esc(m.name)}</b><small>${m.id} · ${esc(ctx.STATUS[m.availabilityStatus] || '')}${m._edited ? ' · изменено' : ''}</small></span>
        <span class="adm-price">${esc(ctx.formatPrice(m.price))}</span></a>`).join('')}</div>
    ${all.length > list.length ? '<button class="more" type="button" data-adm="more">Показать ещё</button>' : ''}`;
  const input = $('#adm-q');
  input.addEventListener('input', () => { listState.q = input.value; listState.shown = 30; const pos = input.selectionStart; renderHome(ctx); const n = $('#adm-q'); n.focus(); n.setSelectionRange(pos, pos); });
  view.onclick = e => { const b = e.target.closest('[data-adm="more"]'); if (b) { listState.shown += 30; renderHome(ctx); } };
  ctx.setMainButton(null);
  window.scrollTo(0, 0);
}

/* ---------- Редактор карточки ---------- */
function renderModel(ctx, id) {
  const { view } = ctx;
  const m = ctx.getById().get(id);
  if (!m) { view.innerHTML = '<p class="empty">Модель не найдена.</p>'; return; }
  const ed = { gallery: m.gallery.map(g => g.src).filter(okPath), cover: m.coverLight, specs: (m.specs || []).map(r => [...r]) };
  const o = ctx.getOverrides()?.models?.[id];
  view.innerHTML = `<div class="step-head"><h1>${esc(m.name)}</h1><span>${m.id}</span></div>
    ${o ? '<p class="note">У этой модели есть ваши правки. «Вернуть как в каталоге» убирает их все.</p>' : ''}
    <form class="form" id="adm-form" novalidate>
      ${field('f-price', 'Цена, ₽', m.price ?? '', 'inputmode="numeric" autocomplete="off" placeholder="Например, 199000"')}
      ${selectField('f-status', 'Наличие', m.availabilityStatus, STATUS_ORDER.map(k => [k, ctx.STATUS[k]]))}
      ${field('f-name', 'Название', m.name, 'maxlength="120"')}
      ${field('f-brand', 'Бренд', m.brand, 'maxlength="60"')}
      ${field('f-series', 'Серия', m.series, 'maxlength="60"')}
      <div class="field"><label for="f-desc">Описание</label><textarea id="f-desc" maxlength="2000">${esc(m.description || '')}</textarea></div>
      <div class="two">
        ${field('f-cc', 'Объём, см³', m.displacementCc ?? '', 'inputmode="numeric"')}
        ${field('f-hp', 'Мощность, л.с.', m.powerHp ?? '', 'inputmode="decimal"')}
        ${field('f-kg', 'Масса, кг', m.weightKg ?? '', 'inputmode="decimal"')}
        ${field('f-seat', 'Седло, мм', m.seatHeightMm ?? '', 'inputmode="numeric"')}
        ${selectField('f-stroke', 'Такт', m.stroke, [['', 'Не указан'], ['2T', '2Т'], ['4T', '4Т']])}
        ${selectField('f-cool', 'Охлаждение', m.cooling, [['', 'Не указано'], ['air', 'Воздушное'], ['liquid', 'Жидкостное']])}
        ${selectField('f-pts', 'ПТС', m.ptsStatus, [['', 'Не указано'], ['yes', 'С ПТС'], ['none', 'Без ПТС']])}
        ${field('f-wheel', 'Колёса', m.wheelFormat ?? '', 'maxlength="20" placeholder="21/18"')}
      </div>
      <h2 class="sec">Фото</h2>
      <div id="adm-photos"></div>
      <h2 class="sec">Характеристики</h2>
      <div id="adm-specs"></div>
      <div class="actions">
        <button class="btn btn-accent btn-wide" type="submit">Сохранить</button>
        ${o ? '<button class="btn btn-wide" type="button" data-adm="reset">Вернуть как в каталоге</button>' : ''}
        <a class="btn btn-wide" href="#/admin" data-adm-nav>К списку</a>
      </div>
    </form>`;
  const paintPhotos = () => {
    $('#adm-photos').innerHTML = `
      <p class="hint">Главное фото показывается в списке и на карточке в каталоге.</p>
      ${ed.cover ? `<img class="adm-cover" src="${esc(thumbSrc(ctx, ed.cover))}" alt="Главное фото">` : ''}
      <div class="thumbs">${ed.gallery.map((p, i) => `<figure class="thumb">
        <img src="${esc(thumbSrc(ctx, p))}" alt="Фото ${i + 1}" loading="lazy">
        <figcaption><button type="button" data-adm="cover" data-i="${i}" aria-label="Сделать главным, фото ${i + 1}" ${p === ed.cover ? 'aria-pressed="true"' : ''}>★</button>
          <button type="button" data-adm="left" data-i="${i}" aria-label="Сдвинуть влево, фото ${i + 1}">‹</button>
          <button type="button" data-adm="right" data-i="${i}" aria-label="Сдвинуть вправо, фото ${i + 1}">›</button>
          <button type="button" data-adm="del" data-i="${i}" aria-label="Убрать фото ${i + 1}">✕</button></figcaption></figure>`).join('')}</div>
      <div class="actions"><label class="btn btn-wide" for="f-files">Добавить фото</label>
        <input id="f-files" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></div>`;
  };
  const paintSpecs = () => {
    $('#adm-specs').innerHTML = `${ed.specs.map((r, i) => `<div class="spec-row">
        <input value="${esc(r[0])}" data-spec="0" data-i="${i}" aria-label="Название ${i + 1}" maxlength="80">
        <input value="${esc(r[1])}" data-spec="1" data-i="${i}" aria-label="Значение ${i + 1}" maxlength="400">
        <button type="button" data-adm="spec-del" data-i="${i}" aria-label="Убрать строку ${i + 1}">✕</button></div>`).join('')}
      <button class="btn" type="button" data-adm="spec-add">Добавить строку</button>`;
  };
  paintPhotos(); paintSpecs();

  const val = id => $(`#${id}`).value;
  const buildPatch = () => {
    const p = {}, set = (k, v) => { if (!same(m[k] ?? null, v)) p[k] = v; };
    const str = (k, id) => { const v = val(id).trim(); if (!same(m[k] ?? '', v)) p[k] = v; };
    set('price', parseNum(val('f-price'), true));
    set('availabilityStatus', val('f-status'));
    str('name', 'f-name'); str('brand', 'f-brand'); str('series', 'f-series'); str('description', 'f-desc'); str('wheelFormat', 'f-wheel');
    set('displacementCc', parseNum(val('f-cc'), true)); set('powerHp', parseNum(val('f-hp'))); set('weightKg', parseNum(val('f-kg')));
    set('seatHeightMm', parseNum(val('f-seat'), true));
    set('stroke', val('f-stroke') || null); set('cooling', val('f-cool') || null); set('ptsStatus', val('f-pts') || null);
    if (!same(m.gallery.map(g => g.src), ed.gallery)) p.gallery = ed.gallery;
    if (ed.cover && ed.cover !== m.coverLight) p.coverLight = ed.cover;
    const specs = ed.specs.map(r => [String(r[0]).trim(), String(r[1]).trim()]).filter(r => r[0]);
    if (!same(m.specs || [], specs)) p.specs = specs;
    return p;
  };
  let busy = false;
  const save = async () => {
    if (busy) return; busy = true;
    try {
      const patch = buildPatch();
      if (!Object.keys(patch).length) { ctx.toast('Изменений нет.'); return; }
      await ctx.api.call('/api/admin/model', { id, patch });
      ctx.haptic('ok'); await ctx.reload(); ctx.toast('Сохранено. Клиенты уже видят новые данные.');
      location.hash = '#/admin';
    } catch (e) { ctx.fail(e); } finally { busy = false; }
  };
  view.onsubmit = e => { e.preventDefault(); save(); };
  ctx.setMainButton('Сохранить', save);
  view.oninput = e => { const t = e.target; if (t.dataset.spec != null) ed.specs[+t.dataset.i][+t.dataset.spec] = t.value; };
  view.onchange = async e => {
    if (e.target.id !== 'f-files') return;
    const files = [...e.target.files]; if (!files.length) return;
    try {
      for (let i = 0; i < files.length; i++) {
        ctx.toast(`Загружаю фото ${i + 1} из ${files.length}…`, 60000);
        const r = await ctx.api.upload(files[i], 'photo');
        ed.gallery.push(r.path); if (!ed.cover) ed.cover = r.path;
      }
      ctx.toast('Фото загружены. Нажмите «Сохранить».'); paintPhotos();
    } catch (err) { ctx.fail(err); }
  };
  view.onclick = async e => {
    const b = e.target.closest('[data-adm]'); if (!b) return;
    const i = Number(b.dataset.i), a = b.dataset.adm;
    if (a === 'cover') ed.cover = ed.gallery[i];
    else if (a === 'left' && i > 0) [ed.gallery[i - 1], ed.gallery[i]] = [ed.gallery[i], ed.gallery[i - 1]];
    else if (a === 'right' && i < ed.gallery.length - 1) [ed.gallery[i + 1], ed.gallery[i]] = [ed.gallery[i], ed.gallery[i + 1]];
    else if (a === 'del') ed.gallery.splice(i, 1);
    else if (a === 'spec-add') { ed.specs.push(['', '']); paintSpecs(); return; }
    else if (a === 'spec-del') { ed.specs.splice(i, 1); paintSpecs(); return; }
    else if (a === 'reset') {
      if (!(await ctx.confirm('Убрать все ваши правки этой модели и вернуть данные каталога?'))) return;
      try { await ctx.api.call('/api/admin/model', { id, reset: MODEL_KEYS }); await ctx.reload(); ctx.toast('Возвращено как в каталоге.'); location.hash = '#/admin'; } catch (err) { ctx.fail(err); }
      return;
    } else return;
    paintPhotos();
  };
  window.scrollTo(0, 0);
}

/* ---------- Профиль и логотип ---------- */
function renderProfile(ctx) {
  const { view } = ctx;
  const p = ctx.getOverrides()?.profile || {};
  const site = ctx.getSite();
  const ed = { ownerAvatar: p.ownerAvatar || '', logoLight: p.logoLight || '', logoDark: p.logoDark || '' };
  const preview = (key, fallback, cls) => `<img class="${cls}" src="${esc(ed[key] ? ctx.asset(ed[key]) : ctx.asset(fallback))}" alt="">`;
  const paint = () => {
    $('#pf-imgs').innerHTML = `
      <div class="pf-row"><b>Моё фото</b>${preview('ownerAvatar', site.ownerAvatarBase, 'pf-avatar')}
        <label class="btn" for="pf-avatar">Загрузить</label><input id="pf-avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden></div>
      <div class="pf-row"><b>Логотип для светлой темы</b>${preview('logoLight', 'assets/brand/triumf-lockup-light.svg', 'pf-logo pf-logo-l')}
        <label class="btn" for="pf-logo-l">Загрузить</label><input id="pf-logo-l" type="file" accept="image/png,image/webp,image/jpeg" hidden></div>
      <div class="pf-row"><b>Логотип для тёмной темы</b>${preview('logoDark', 'assets/brand/triumf-lockup-dark.svg', 'pf-logo pf-logo-d')}
        <label class="btn" for="pf-logo-d">Загрузить</label><input id="pf-logo-d" type="file" accept="image/png,image/webp,image/jpeg" hidden></div>`;
  };
  view.innerHTML = `<div class="step-head"><h1>Профиль</h1></div>
    <form class="form" id="adm-form" novalidate>
      ${field('pf-name', 'Ваше имя в приложении', p.ownerName ?? ctx.getSite().ownerDisplay ?? 'Вадим', 'maxlength="60"')}
      ${field('pf-salon', 'Название салона', p.salonName ?? site.salonName ?? 'ТРИУМФ', 'maxlength="60"')}
      <div id="pf-imgs"></div>
      <p class="hint">Логотип: PNG или WebP с прозрачным фоном, не меньше 800 px по ширине. Если не загружать, остаётся стандартный.</p>
      <div class="actions"><button class="btn btn-accent btn-wide" type="submit">Сохранить</button>
        ${Object.keys(p).length ? '<button class="btn btn-wide" type="button" data-adm="reset">Вернуть стандартные</button>' : ''}
        <a class="btn btn-wide" href="#/admin" data-adm-nav>К списку</a></div>
    </form>`;
  paint();
  let busy = false;
  const save = async () => {
    if (busy) return; busy = true;
    try {
      const patch = {};
      const name = $('#pf-name').value.trim(), salon = $('#pf-salon').value.trim();
      if (name && name !== (p.ownerName ?? ctx.getSite().ownerDisplay ?? 'Вадим')) patch.ownerName = name;
      if (salon && salon !== (p.salonName ?? site.salonName ?? 'ТРИУМФ')) patch.salonName = salon;
      for (const k of ['ownerAvatar', 'logoLight', 'logoDark']) if (ed[k] && ed[k] !== p[k]) patch[k] = ed[k];
      if (ed.ownerAvatar && ed.ownerAvatar !== p.ownerAvatar) patch.ownerPhoto = ed.ownerAvatar;
      if (!Object.keys(patch).length) { ctx.toast('Изменений нет.'); return; }
      await ctx.api.call('/api/admin/profile', { patch });
      ctx.haptic('ok'); await ctx.reload(); ctx.toast('Сохранено.'); location.hash = '#/admin';
    } catch (e) { ctx.fail(e); } finally { busy = false; }
  };
  view.onsubmit = e => { e.preventDefault(); save(); };
  ctx.setMainButton('Сохранить', save);
  view.onchange = async e => {
    const map = { 'pf-avatar': ['ownerAvatar', 'avatar'], 'pf-logo-l': ['logoLight', 'logo'], 'pf-logo-d': ['logoDark', 'logo'] };
    const m = map[e.target.id]; const f = e.target.files?.[0]; if (!m || !f) return;
    try { ctx.toast('Загружаю…', 60000); const r = await ctx.api.upload(f, m[1]); ed[m[0]] = r.path; paint(); ctx.toast('Загружено. Нажмите «Сохранить».'); } catch (err) { ctx.fail(err); }
  };
  view.onclick = async e => {
    if (!e.target.closest('[data-adm="reset"]')) return;
    if (!(await ctx.confirm('Вернуть имя, фото и логотип к стандартным?'))) return;
    try { await ctx.api.call('/api/admin/profile', { reset: ['salonName', 'ownerName', 'ownerAvatar', 'ownerPhoto', 'logoLight', 'logoDark'] }); await ctx.reload(); ctx.toast('Возвращено.'); location.hash = '#/admin'; } catch (err) { ctx.fail(err); }
  };
  window.scrollTo(0, 0);
}

/* ---------- История и откат ---------- */
const LABELS = { price: 'цена', availabilityStatus: 'наличие', name: 'название', description: 'описание', coverLight: 'главное фото', gallery: 'галерея', specs: 'характеристики' };
function summarize(e) {
  const b = e.before || {}, a = e.after || {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => k !== 'priceUpdatedAt' && !same(b[k], a[k]));
  if (!keys.length) return e.after ? 'без изменений' : 'правки убраны';
  return keys.map(k => k === 'price' ? `цена ${b.price ?? '—'} → ${a.price ?? '—'}` : (LABELS[k] || k)).join(', ');
}
async function renderHistory(ctx) {
  const { view } = ctx;
  view.innerHTML = '<div class="step-head"><h1>История</h1></div><p class="lead-text">Загружаю…</p>';
  ctx.setMainButton(null);
  try {
    const { history } = await ctx.api.call('/api/admin/history', {});
    view.innerHTML = `<div class="step-head"><h1>История</h1><span>${history.length}</span></div>
      <p class="lead-text">«Откатить» возвращает карточку к состоянию до этого изменения.</p>
      <div class="adm-list">${history.map(h => {
        const t = h.target === 'profile' ? 'Профиль' : (ctx.getById().get(h.target.slice(6))?.name || h.target.slice(6));
        return `<div class="adm-item adm-hist"><span class="adm-main"><b>${esc(t)}</b><small>${esc(new Date(h.ts).toLocaleString('ru-RU'))}${h.note ? ' · ' + esc(h.note) : ''}</small>
          <small>${esc(summarize(h))}</small></span><button class="btn" type="button" data-adm="revert" data-id="${esc(h.id)}">Откатить</button></div>`;
      }).join('') || '<p class="empty">Изменений пока нет.</p>'}</div>
      <div class="actions"><a class="btn btn-wide" href="#/admin" data-adm-nav>К списку</a></div>`;
  } catch (e) { ctx.fail(e); return; }
  view.onclick = async e => {
    const b = e.target.closest('[data-adm="revert"]'); if (!b) return;
    if (!(await ctx.confirm('Откатить это изменение?'))) return;
    try { await ctx.api.call('/api/admin/revert', { historyId: b.dataset.id }); await ctx.reload(); ctx.toast('Откат выполнен.'); renderHistory(ctx); } catch (err) { ctx.fail(err); }
  };
}

/* ---------- Мой Telegram ID (для настройки доступа) ---------- */
export function renderId(ctx) {
  const uid = ctx.userId();
  const me = ctx.me() || (uid ? { id: uid, admin: false } : null);
  ctx.view.innerHTML = `<h2 class="sec">Ваш Telegram ID</h2>
    ${me ? `<p class="lead-text">Номер для настройки доступа к админке:</p><p class="m-price" id="my-id">${esc(me.id)}</p>
      <div class="actions"><button class="btn btn-accent btn-wide" type="button" data-adm="copy-id">Скопировать</button></div>
      <p class="note">${me.admin ? 'У вас есть доступ к админке.' : 'Отправьте этот номер тому, кто настраивает приложение. Это не пароль.'}</p>`
      : '<p class="empty">Откройте приложение из Telegram, чтобы увидеть ID.</p>'}`;
  ctx.view.onclick = async e => { if (e.target.closest('[data-adm="copy-id"]')) { try { await navigator.clipboard.writeText(String(me.id)); ctx.toast('Скопировано.'); } catch { ctx.toast(`Ваш ID: ${me.id}`); } } };
  ctx.setMainButton(null);
}

/* ---------- Маршрутизация админки ---------- */
export function renderAdmin(ctx, hash) {
  if (!ctx.me()?.admin) { ctx.view.innerHTML = '<p class="empty">Нет доступа.</p>'; ctx.setMainButton(null); return; }
  const m = hash.match(/^#\/admin\/m\/(TR-\d+)/);
  if (m) return renderModel(ctx, m[1]);
  if (hash.startsWith('#/admin/profile')) return renderProfile(ctx);
  if (hash.startsWith('#/admin/history')) return renderHistory(ctx);
  return renderHome(ctx);
}
