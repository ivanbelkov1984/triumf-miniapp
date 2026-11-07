// ТРИУМФ — мини-приложение Telegram: каталог, подбор за 4 вопроса, избранное, заявка в мотосалон.
// Данные — те же, что у сайта (../data). Сервер не нужен: заявку отправляет сам клиент из своего Telegram.
// Слой 2 (по решению владельца): если задан TG_CONFIG.leadEndpoint, заявка дополнительно уходит в мотосалон ботом.
import { STATUS, KIND, CATEGORY, SORTS, applyAvailability, queryMatches, sortModels, formatPrice, formatDate,
  buildMessage, plural } from '../assets/js/core.js';
import { TG_CONFIG as C } from './config.js';
import { createApi, applyOverrides, renderAdmin, renderId, okPath } from './admin.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
/** Картинки каталога лежат рядом с приложением, загруженные админом — на сервере (media/…). */
let api = null;
const asset = p => !p ? '' : /^media\//.test(p) ? (api ? api.mediaUrl(p) : '') : '../' + p;
/** Тема Telegram (или системная — для сайта в обычном браузере) и обложка модели под неё. */
function isDarkTheme() { return tg ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function coverFor(m) { return isDarkTheme() ? (m.coverDark || m.coverLight) : (m.coverLight || m.coverDark); }
let galManualNav = false; // true — пользователь сам листал карусель модели; тогда смена темы не переключает кадр
let base = null, overrides = null, meState; // base — исходный каталог; overrides — правки с сервера; meState: undefined = проверяется, null = не админ/нет связи
const modelsWord = n => plural(n, ['модель', 'модели', 'моделей']);

let models = [], byId = new Map(), site = {}, catalogDate = '';
const state = { q: '', cat: 'all', sort: 'availability', shown: 20, listScroll: 0 };
const pick = { step: 0, answers: {} };
let favs = new Set();

/* ---------- Telegram ---------- */
let tg = null;
const inTelegram = () => !!(tg && tg.initData);
const can = v => !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v));
const haptic = (kind = 'light') => { try { tg?.HapticFeedback?.[kind === 'ok' ? 'notificationOccurred' : 'impactOccurred'](kind === 'ok' ? 'success' : kind); } catch {} };
function waitTelegram(ms = 1500) {
  return new Promise(res => {
    const t0 = Date.now();
    (function poll() { if (window.Telegram?.WebApp) return res(window.Telegram.WebApp); if (Date.now() - t0 > ms) return res(null); setTimeout(poll, 50); })();
  });
}
function openLink(url) {
  if (inTelegram() && /^https:\/\/t\.me\//.test(url)) return tg.openTelegramLink(url);
  if (inTelegram()) return tg.openLink(url);
  window.open(url, '_blank', 'noopener');
}
let mainHandler = null;
function setMainButton(text, handler) {
  if (!inTelegram()) return false;
  const mb = tg.MainButton;
  if (mainHandler) mb.offClick(mainHandler);
  if (!text) { mainHandler = null; mb.hide(); return true; }
  mainHandler = () => { haptic('medium'); handler(); };
  mb.setParams({ text, color: '#FF6A00', text_color: '#171B20', is_visible: true, is_active: true });
  mb.onClick(mainHandler);
  return true;
}

/* ---------- Хранилище избранного: облако Telegram или браузер ---------- */
const FAV_KEY = 'triumf_favs';
function loadFavs() {
  return new Promise(res => {
    const local = () => { try { res(new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'))); } catch { res(new Set()); } };
    if (inTelegram() && can('6.9') && tg.CloudStorage) tg.CloudStorage.getItem(FAV_KEY, (err, v) => { if (err || !v) return local(); try { res(new Set(JSON.parse(v))); } catch { local(); } });
    else local();
  });
}
function saveFavs() {
  const v = JSON.stringify([...favs]);
  try { localStorage.setItem(FAV_KEY, v); } catch {}
  if (inTelegram() && can('6.9') && tg.CloudStorage) tg.CloudStorage.setItem(FAV_KEY, v, () => {});
  const b = $('[data-fav-count]'); b.textContent = favs.size; b.hidden = !favs.size;
}
function toggleFav(id) { favs.has(id) ? favs.delete(id) : favs.add(id); haptic('light'); saveFavs(); }

/* ---------- Сообщения ---------- */
let toastTimer;
function toast(text, ms = 4500) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { const a = document.createElement('textarea'); a.value = text; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.append(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok; } catch { return false; }
}
/** Источник перехода: ?src=channel, ?startapp=TR-011__ad_name или start_param=src_channel. Только a-z, 0-9, _ и -, до 32 знаков. */
const cleanSrc = v => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
let leadSrc = '';
function parseStart(raw) {
  const [first = '', ...rest] = String(raw || '').split('__');
  const isSrcOnly = /^src_/i.test(first);
  return { model: isSrcOnly ? '' : first, src: cleanSrc(isSrcOnly ? first.slice(4) : rest.join('_')) };
}
const appLink = (id, src) => {
  const s = cleanSrc(src);
  if (C.appShortName) { const p = id ? (s ? `${id}__${s}` : id) : (s ? `src_${s}` : ''); return `https://t.me/${C.botUsername}/${C.appShortName}${p ? '?startapp=' + encodeURIComponent(p) : ''}`; }
  const q = [id && 'model=' + encodeURIComponent(id), s && 'src=' + s].filter(Boolean).join('&');
  return `${C.publicUrl}${q ? '?' + q : ''}`;
};
const who = () => { const u = tg?.initDataUnsafe?.user; return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') + (u.username ? ` (@${u.username})` : '') : ''; };

/** Заявка в мотосалон. Без сервера: готовый текст в чат. Со слоем 2: ещё и мгновенное уведомление ботом. */
async function sendToVadim(text, meta = {}) {
  if (leadSrc) { text += `
Источник: ${leadSrc}`; meta = { ...meta, src: leadSrc }; }
  if (C.leadEndpoint) {
    try {
      const r = await fetch(C.leadEndpoint, { method: 'POST', body: JSON.stringify({ type: 'lead', text, meta, initData: tg?.initData || '' }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { haptic('ok'); return notify(`Заявка отправлена. Вам ответят в рабочее время, ${site.hours || '09:00–19:00'}.`); }
    } catch {}
  }
  if (C.vadimUsername) return openLink(`https://t.me/${C.vadimUsername}?text=${encodeURIComponent(text)}`);
  const copied = await copyText(text);
  const msg = copied ? 'Текст заявки скопирован. Откроется чат — вставьте текст и отправьте.' : 'Откроется чат. Напишите, какая модель интересует.';
  if (inTelegram() && tg.showPopup) tg.showPopup({ title: 'Заявка в мотосалон', message: msg, buttons: [{ id: 'go', type: 'default', text: 'Открыть чат' }, { type: 'cancel' }] }, id => { if (id === 'go') openLink(site.telegram); });
  else { toast(msg, 6000); openLink(site.telegram); }
}
function notify(text) { if (inTelegram() && tg.showAlert) tg.showAlert(text); else toast(text); }

/* ---------- Карточки ---------- */
const factsLine = m => m.electric
  ? [m.electric.power, m.electric.speed?.replace(/^до\s*/i, 'до ')].filter(Boolean).join(' · ')
  : [m.displacementCc && `${m.displacementCc} см³`, m.powerHp != null && `${String(m.powerHp).replace('.', ',')} л.с.`, m.stroke && m.stroke.replace('T', 'Т')].filter(Boolean).join(' · ');
const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
function card(m, why = []) {
  return `<article class="card" data-open="${m.id}">
    <div class="card-img"><img src="${esc(asset(coverFor(m)))}" alt="${esc(m.name)}" loading="lazy" decoding="async" width="600" height="450"></div>
    <div class="card-body">
      <span class="card-kind">${esc(KIND[m.category] || '')} · ${m.id}</span>
      <span class="card-name">${esc(m.name)}</span>
      <span class="card-facts">${esc(factsLine(m))}</span>
      <span class="card-price">${esc(formatPrice(m.price))}</span>
      <span class="status" data-s="${m.availabilityStatus}">${esc(STATUS[m.availabilityStatus] || STATUS.order)}</span>
      ${why.length ? `<span class="why">${why.map(w => `<span>${esc(w)}</span>`).join('')}</span>` : ''}
    </div>
    <button class="fav" type="button" data-fav="${m.id}" aria-pressed="${favs.has(m.id)}" aria-label="В избранное: ${esc(m.name)}">${heart}</button>
  </article>`;
}

/* ---------- Каталог ---------- */
function filtered() {
  const list = models.filter(m => (state.cat === 'all' || m.category === state.cat) && queryMatches(m, state.q));
  return sortModels(list, state.sort);
}
function renderCatalog() {
  const list = filtered();
  const counts = { all: models.length }; for (const m of models) counts[m.category] = (counts[m.category] || 0) + 1;
  view.innerHTML = `
    <div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <label class="sr-only" for="q">Поиск по каталогу</label>
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Модель, мотор или TR-код" value="${esc(state.q)}"></div>
    <div class="chips" role="group" aria-label="Категория">${Object.keys(CATEGORY).map(k => `<button class="chip" type="button" data-cat="${k}" aria-pressed="${state.cat === k}">${k === 'all' ? 'Все' : esc(CATEGORY[k])} <small>${counts[k] || 0}</small></button>`).join('')}</div>
    ${state.q || state.cat !== 'all' ? '' : `<button class="pick-cta" type="button" data-go="#/pick"><span><b>Подобрать за 4 вопроса</b><span>Рост, опыт, где ездить и бюджет — покажем подходящие модели</span></span><i aria-hidden="true">›</i></button>`}
    <div class="row"><p class="count" id="count">Найдено: ${list.length} ${modelsWord(list.length)}</p>
      <label class="sr-only" for="sort">Сортировка</label><select class="sort" id="sort">${Object.entries(SORTS).filter(([k]) => !/seat|weight/.test(k)).map(([k, v]) => `<option value="${k}" ${k === state.sort ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
    ${list.length ? `<div class="grid" id="grid">${list.slice(0, state.shown).map(m => card(m)).join('')}</div>` : `<p class="empty">Ничего не нашлось. Измените запрос или напишите нам — подберём.</p>`}
    ${list.length > state.shown ? `<button class="more" type="button" data-more>Показать ещё ${Math.min(20, list.length - state.shown)}</button>` : ''}
    <p class="note">Цены — по каталогу поставщика на ${esc(catalogDate)}. «Под заказ» — срок и цену поставки подтвердят при обращении. Информация не является публичной офертой.</p>`;
  const q = $('#q');
  q.addEventListener('input', () => { state.q = q.value; state.shown = 20; const pos = q.selectionStart; renderCatalog(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderCatalog(); });
  requestAnimationFrame(() => window.scrollTo(0, state.listScroll));
}

/* ---------- Модель ---------- */
const COOL_SHORT = { air: 'Воздух', liquid: 'Жидкость' };
const PTS_SHORT = { yes: 'С ПТС', none: 'Без ПТС' };
function factBoxes(m) {
  const e = m.electric;
  const f = e
    ? [[e.power, 'Мощность'], [e.speed, 'Скорость'], [e.range?.split(',')[0], 'Запас хода'], [e.charge, 'Зарядка'], [e.battery?.split(',').slice(0, 2).join(','), 'Батарея'], [m.wheelFormat, 'Колёса']]
    : [[m.displacementCc && `${m.displacementCc} см³`, 'Объём'], [m.powerHp != null && `${String(m.powerHp).replace('.', ',')} л.с.`, 'Мощность'], [m.stroke && m.stroke.replace('T', 'Т'), 'Такт'],
       [COOL_SHORT[m.cooling], 'Охлаждение'], [m.wheelFormat, 'Колёса'], [m.weightKg && `${m.weightKg} кг`, 'Масса'], [m.seatHeightMm && `${m.seatHeightMm} мм`, 'Седло'], [PTS_SHORT[m.ptsStatus], 'Документы']];
  return f.filter(([v]) => v).slice(0, 6).map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
}
function renderModel(id) {
  const m = byId.get(id);
  if (!m) { view.innerHTML = '<p class="empty">Модель не найдена.</p>'; return; }
  // Фиксированный порядок кадров: белый фон → чёрный фон → гараж (как в m.gallery). Старое поле coverLight — запасной вариант, если галереи нет.
  const pics = (m.gallery?.length ? m.gallery.map(g => g.src) : [m.coverLight, m.coverDark]).filter(Boolean);
  galManualNav = false;
  const startIdx = isDarkTheme() ? Math.min(1, pics.length - 1) : 0;
  view.innerHTML = `
    <div class="gallery" id="gal" tabindex="0" role="region" aria-label="Фото модели, листайте вбок или нажмите для полноэкранного просмотра">${pics.map((p, i) => `<img src="${esc(asset(p))}" alt="${esc(m.name)}, фото ${i + 1}" ${i ? 'loading="lazy"' : ''} decoding="async" data-lb-open="${i}">`).join('')}</div>
    <p class="g-count" id="gc">${startIdx + 1} / ${pics.length}</p>
    <div class="m-head"><span class="m-kind">${esc(KIND[m.category] || '')} · ${m.id}</span>
      <h1 class="m-name">${esc(m.name)}</h1>
      <span class="status" data-s="${m.availabilityStatus}">${esc(STATUS[m.availabilityStatus])}</span></div>
    <p class="m-price">${esc(formatPrice(m.price))}<small>по каталогу поставщика на ${esc(formatDate(m.priceUpdatedAt) || catalogDate)}</small></p>
    <div class="facts">${factBoxes(m)}</div>
    <div class="actions">
      ${inTelegram() ? '' : `<button class="btn btn-accent btn-wide" type="button" data-lead="${m.id}">Узнать наличие</button>`}
      <button class="btn" type="button" data-fav="${m.id}" aria-pressed="${favs.has(m.id)}">${favs.has(m.id) ? 'В избранном' : 'В избранное'}</button>
      <button class="btn" type="button" data-share="${m.id}">Поделиться</button>
      ${site.phone?.tel ? `<a class="btn btn-wide" href="${esc(site.phone.tel)}" data-call>Позвонить ${esc(site.phone.display)}</a>` : ''}
    </div>
    ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
    ${m.specs?.length ? `<details class="specs"><summary>Все характеристики (${m.specs.length})</summary><table>${m.specs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>` : ''}
    <p class="note">Характеристики — по данным поставщика. Наличие, комплектацию и цену подтверждают при обращении. Не является публичной офертой.</p>`;
  const gal = $('#gal');
  gal.addEventListener('scroll', () => { $('#gc').textContent = `${Math.round(gal.scrollLeft / gal.clientWidth) + 1} / ${pics.length}`; }, { passive: true });
  gal.addEventListener('pointerdown', () => { galManualNav = true; }, { passive: true });
  gal.addEventListener('click', e => { const t = e.target.closest('[data-lb-open]'); if (t) openLightbox(pics, m.name, Number(t.dataset.lbOpen)); });
  if (startIdx) requestAnimationFrame(() => gal.scrollTo({ left: gal.clientWidth * startIdx, behavior: 'auto' }));
  setMainButton('Узнать наличие', () => lead(m));
  window.scrollTo(0, 0);
}

/* ---------- Полноэкранный просмотр фото: 3 кадра, стрелки, колесо/клавиатура, зум и перемещение ---------- */
const LB_MIN = 1, LB_MAX = 4, LB_STEP = 0.6;
let lb = null; // { pics, name, idx, zoom, panX, panY }
function lbEl() {
  let el = $('#lightbox');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'lightbox'; el.className = 'lightbox'; el.hidden = true;
  el.innerHTML = `
    <button class="lb-btn lb-close" type="button" aria-label="Закрыть просмотр">✕</button>
    <button class="lb-btn lb-nav lb-prev" type="button" aria-label="Предыдущее фото">‹</button>
    <div class="lb-stage"><img class="lb-img" alt=""></div>
    <button class="lb-btn lb-nav lb-next" type="button" aria-label="Следующее фото">›</button>
    <div class="lb-bar">
      <button class="lb-btn lb-zoom" data-lb-zoom="-1" type="button" aria-label="Уменьшить">−</button>
      <span class="lb-count"></span>
      <button class="lb-btn lb-zoom" data-lb-zoom="1" type="button" aria-label="Увеличить">+</button>
    </div>`;
  document.body.append(el);
  el.addEventListener('click', e => { if (e.target === el || e.target.classList.contains('lb-stage')) lbClose(); });
  el.querySelector('.lb-close').addEventListener('click', lbClose);
  el.querySelector('.lb-prev').addEventListener('click', () => lbGo(-1));
  el.querySelector('.lb-next').addEventListener('click', () => lbGo(1));
  el.querySelectorAll('[data-lb-zoom]').forEach(b => b.addEventListener('click', () => lbZoom(Number(b.dataset.lbZoom) * LB_STEP)));
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) lbZoom(e.deltaY < 0 ? LB_STEP : -LB_STEP);
    else lbGo(e.deltaX > 0 ? 1 : -1);
  }, { passive: false });
  const img = el.querySelector('.lb-img');
  let dragging = false, sx = 0, sy = 0, spx = 0, spy = 0, moved = false, lastTap = 0;
  img.addEventListener('pointerdown', e => { if (!lb) return; dragging = true; moved = false; sx = e.clientX; sy = e.clientY; spx = lb.panX; spy = lb.panY; try { img.setPointerCapture(e.pointerId); } catch {} });
  img.addEventListener('pointermove', e => {
    if (!dragging || !lb) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (lb.zoom > 1) { lb.panX = spx + dx; lb.panY = spy + dy; lbRender(); }
  });
  img.addEventListener('pointerup', () => {
    dragging = false;
    if (moved) return;
    const now = Date.now();
    if (now - lastTap < 350) { lbZoom(lb.zoom > 1 ? LB_MIN - lb.zoom : LB_STEP * 2); lastTap = 0; } else lastTap = now;
  });
  return el;
}
function lbClampPan() {
  const max = 140 * Math.max(0, lb.zoom - 1);
  lb.panX = Math.max(-max, Math.min(max, lb.panX));
  lb.panY = Math.max(-max, Math.min(max, lb.panY));
}
function lbRender() {
  const el = lbEl(); if (!lb) return;
  const img = el.querySelector('.lb-img');
  img.src = esc(asset(lb.pics[lb.idx]));
  img.alt = `${esc(lb.name)}, фото ${lb.idx + 1}`;
  lbClampPan();
  img.style.transform = `translate(${lb.panX}px, ${lb.panY}px) scale(${lb.zoom})`;
  img.style.cursor = lb.zoom > 1 ? 'grab' : 'zoom-in';
  el.querySelector('.lb-count').textContent = `${lb.idx + 1} / ${lb.pics.length}`;
  const multi = lb.pics.length > 1;
  el.querySelector('.lb-prev').hidden = !multi;
  el.querySelector('.lb-next').hidden = !multi;
}
function lbGo(dir) {
  if (!lb) return;
  lb.idx = (lb.idx + dir + lb.pics.length) % lb.pics.length;
  lb.zoom = 1; lb.panX = 0; lb.panY = 0;
  galManualNav = true;
  syncGalleryToIndex(lb.idx);
  lbRender();
}
function lbZoom(delta) {
  if (!lb) return;
  lb.zoom = Math.max(LB_MIN, Math.min(LB_MAX, +(lb.zoom + delta).toFixed(2)));
  if (lb.zoom <= 1) { lb.zoom = 1; lb.panX = 0; lb.panY = 0; }
  lbRender();
}
function lbKey(e) {
  if (!lb) return;
  if (e.key === 'Escape') return lbClose();
  if (e.key === 'ArrowLeft') return lbGo(-1);
  if (e.key === 'ArrowRight') return lbGo(1);
  if (e.key === '+' || e.key === '=') return lbZoom(LB_STEP);
  if (e.key === '-' || e.key === '_') return lbZoom(-LB_STEP);
}
function openLightbox(pics, name, startIndex) {
  lb = { pics, name, idx: Math.max(0, Math.min(startIndex, pics.length - 1)), zoom: 1, panX: 0, panY: 0 };
  const el = lbEl();
  el.hidden = false;
  document.documentElement.classList.add('lb-open');
  document.addEventListener('keydown', lbKey);
  lbRender();
}
function lbClose() {
  const el = $('#lightbox'); if (el) el.hidden = true;
  document.documentElement.classList.remove('lb-open');
  document.removeEventListener('keydown', lbKey);
  lb = null;
}
function syncGalleryToIndex(idx) {
  const gal = $('#gal'); if (!gal) return;
  gal.scrollTo({ left: gal.clientWidth * idx, behavior: 'auto' });
  const gc = $('#gc'); if (gc) gc.textContent = `${idx + 1} / ${gal.children.length}`;
}
/** Смена темы: перекрасить обложки карточек и (если пользователь не листал сам) кадр карусели модели. */
function refreshCoverImages() {
  document.querySelectorAll('.card[data-open]').forEach(el => {
    const m = byId.get(el.dataset.open);
    const img = el.querySelector('.card-img img');
    if (m && img) img.src = esc(asset(coverFor(m)));
  });
}
function refreshGalleryTheme() {
  if (galManualNav) return;
  const gal = $('#gal'); if (!gal) return;
  const idx = isDarkTheme() ? Math.min(1, gal.children.length - 1) : 0;
  gal.scrollTo({ left: gal.clientWidth * idx, behavior: 'auto' });
  const gc = $('#gc'); if (gc) gc.textContent = `${idx + 1} / ${gal.children.length}`;
}
function lead(m) {
  const text = buildMessage({ model: m, url: appLink(m.id) }) + (who() ? `\nПишу из каталога в Telegram: ${who()}.` : '');
  sendToVadim(text, { kind: 'model', id: m.id, name: m.name, price: m.price });
}
function share(m) {
  const url = appLink(m.id, 'share'), text = `${m.name} — ${formatPrice(m.price)} в каталоге мотосалона ТРИУМФ`;
  openLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

/* ---------- Подбор за 4 вопроса ---------- */
const Q = [
  { key: 'rider', title: 'Кто поедет?', opts: [
    ['kid', 'Ребёнок 7–12 лет', 'Первый мотоцикл, рост до ~150 см'], ['teen', 'Подросток или невысокий взрослый', 'Рост ~150–170 см'],
    ['new', 'Взрослый, опыта мало', 'Нужна послушная, прощающая ошибки техника'], ['pro', 'Опытный райдер', 'Нужны мощность и подвеска']] },
  { key: 'where', title: 'Где будете ездить?', opts: [
    ['forest', 'Лес, горы, эндуро', 'Корни, камни, подъёмы'], ['track', 'Кроссовая трасса', 'Прыжки, скорость, ровный грунт'],
    ['easy', 'Дача, поля, прогулки', 'Спокойно, без спорта'], ['quiet', 'Тихо и без бензина', 'Электро: без шума и выхлопа']] },
  { key: 'budget', title: 'Бюджет?', opts: [
    ['150', 'До 150 000 ₽', ''], ['250', 'До 250 000 ₽', ''], ['400', 'До 400 000 ₽', ''], ['any', 'Не важно', 'Покажем лучшее под задачу']] },
  { key: 'pts', title: 'Нужен ПТС?', opts: [
    ['yes', 'Да, буду ездить по дорогам', 'ПТС есть не у всех моделей — уточним при обращении'], ['no', 'Нет, только бездорожье', 'Спортинвентарь без регистрации'], ['any', 'Пока не знаю', '']] },
];
const LABEL = Object.fromEntries(Q.flatMap(q => q.opts.map(([v, t]) => [`${q.key}:${v}`, t])));

/** Баллы модели по ответам. Неизвестные поля не штрафуются, совпадения поднимают в выдаче. Возвращает null, если модель не подходит. */
export function scoreModel(m, a) {
  const why = []; let s = 0;
  const cc = m.displacementCc, el = m.category === 'electro', pit = m.category === 'pit';
  if (a.budget && a.budget !== 'any') { if (m.price != null && m.price > Number(a.budget) * 1000) return null; s += 1; }
  switch (a.rider) {
    case 'kid': if (!(pit && (!cc || cc <= 125))) return null; s += 3; why.push('детский размер'); break;
    case 'teen': if (pit || el || (cc && cc <= 190)) { s += 3; why.push(el ? 'лёгкий, 66–67 кг' : 'по росту'); } else if (cc && cc > 250) return null; break;
    case 'new': if (pit && cc && cc < 125) return null; if (el || (cc && cc >= 150 && cc <= 300)) { s += 2; why.push('для старта'); } if (m.stroke === '4T') { s += 2; why.push('4Т — мягкая тяга'); } if (m.stroke === '2T') s -= 2; break;
    case 'pro': if (pit || (cc && cc < 250)) return null; if (cc && cc >= 280) { s += 2; why.push(`${cc} см³`); } if (m.stroke === '2T') { s += 1; why.push('2Т — резкий характер'); } if (m.powerHp >= 30) { s += 2; why.push(`${String(m.powerHp).replace('.', ',')} л.с.`); } break;
  }
  switch (a.where) {
    case 'quiet': if (!el) return null; s += 4; why.push('тихий электро'); break;
    case 'forest': if (el) { s += 1; why.push('тихо в лесу'); } if (m.cooling === 'liquid') { s += 1; why.push('жидкостное охлаждение'); } if (m.wheelFormat === '21/18') { s += 1; why.push('колёса 21/18'); } break;
    case 'track': if (m.stroke === '2T' || m.powerHp >= 30) { s += 2; why.push('для трассы'); } break;
    case 'easy': if (m.stroke === '4T') s += 1; if (m.cooling === 'air') { s += 1; why.push('простое обслуживание'); } break;
  }
  if (a.pts === 'yes') { if (m.ptsStatus === 'yes') { s += 4; why.push('есть ПТС'); } else if (m.ptsStatus === 'none') return null; }
  if (a.pts === 'no' && m.ptsStatus === 'none') s += 1;
  if (m.availabilityStatus === 'in_stock') { s += 2; why.push('в наличии'); }
  if (m.availabilityStatus === 'unavailable') s -= 3;
  return { m, s, why: why.slice(0, 3) };
}
function pickResults() {
  return models.map(m => scoreModel(m, pick.answers)).filter(Boolean)
    .sort((x, y) => y.s - x.s || (x.m.price ?? 1e9) - (y.m.price ?? 1e9)).slice(0, 6);
}
function renderPick() {
  if (pick.step < Q.length) {
    const q = Q[pick.step];
    view.innerHTML = `<div class="step-head"><h1>${esc(q.title)}</h1><span>${pick.step + 1} из ${Q.length}</span></div>
      <div class="progress" aria-hidden="true"><i style="width:${(pick.step / Q.length) * 100}%"></i></div>
      <div class="options" role="group" aria-label="${esc(q.title)}">${q.opts.map(([v, t, d]) => `<button class="opt" type="button" data-answer="${q.key}:${v}" aria-pressed="${pick.answers[q.key] === v}"><b>${esc(t)}</b>${d ? `<span>${esc(d)}</span>` : ''}</button>`).join('')}</div>`;
    setMainButton(null);
    window.scrollTo(0, 0);
    return;
  }
  const res = pickResults();
  const summary = Q.map(q => LABEL[`${q.key}:${pick.answers[q.key]}`]).filter(Boolean).join(' · ');
  view.innerHTML = `<div class="step-head"><h1>Подходит вам</h1><span>${res.length} ${modelsWord(res.length)}</span></div>
    <p class="answers">${esc(summary)} · <a href="#/pick" data-restart>изменить</a></p>
    ${res.length ? `<div class="grid">${res.map(r => card(r.m, r.why)).join('')}</div>` : `<p class="empty">Под такие условия в каталоге ничего нет. Отправьте подбор — вам предложат вариант под заказ.</p>`}
    ${inTelegram() ? '' : `<div class="actions"><button class="btn btn-accent btn-wide" type="button" data-send-pick>Отправить подбор</button></div>`}
    <p class="note">Подбор — ориентир по данным поставщика: у части моделей не указаны ПТС, такт и размер. Окончательно модель подтвердят при обращении.</p>`;
  setMainButton('Отправить подбор', sendPick);
  window.scrollTo(0, 0);
}
function sendPick() {
  const res = pickResults().slice(0, 3);
  const lines = ['Здравствуйте!', 'Подобрал технику в каталоге ТРИУМФ в Telegram:'];
  for (const q of Q) { const l = LABEL[`${q.key}:${pick.answers[q.key]}`]; if (l) lines.push(`— ${q.title} ${l}`); }
  if (res.length) { lines.push('Понравились:'); res.forEach(r => lines.push(`• ${r.m.name}, ${r.m.id} — ${formatPrice(r.m.price)}`)); }
  lines.push('Подскажите, что из этого есть и что посоветуете.');
  if (who()) lines.push(`Пишу из Telegram: ${who()}.`);
  sendToVadim(lines.join('\n'), { kind: 'pick', answers: pick.answers, ids: res.map(r => r.m.id) });
}

/* ---------- Избранное и связь с мотосалоном ---------- */
function renderFav() {
  const list = models.filter(m => favs.has(m.id));
  view.innerHTML = `<div class="step-head"><h1>Избранное</h1><span>${list.length} ${modelsWord(list.length)}</span></div>
    ${list.length ? `<div class="grid">${list.map(m => card(m)).join('')}</div>` : '<p class="empty">Нажмите ♡ на карточке, чтобы сохранить модель. Избранное хранится в вашем Telegram.</p>'}
    ${list.length && !inTelegram() ? '<div class="actions"><button class="btn btn-accent btn-wide" type="button" data-send-favs>Спросить об избранном</button></div>' : ''}`;
  setMainButton(list.length ? 'Спросить об избранном' : null, sendFavs);
}
function sendFavs() {
  const list = models.filter(m => favs.has(m.id));
  const lines = ['Здравствуйте!', 'Присмотрел в каталоге ТРИУМФ:', ...list.map(m => `• ${m.name}, ${m.id} — ${formatPrice(m.price)}`), 'Подскажите наличие и что лучше выбрать.'];
  if (who()) lines.push(`Пишу из Telegram: ${who()}.`);
  sendToVadim(lines.join('\n'), { kind: 'favs', ids: list.map(m => m.id) });
}
function renderContact() {
  const d = site.delivery || {};
  view.innerHTML = `<div class="vadim"><div><b>${esc(site.salonName)}</b><span>Мотосалон · ${esc(site.hours)}</span></div></div>
    <div class="actions">
      <button class="btn btn-accent btn-wide" type="button" data-write>Написать в Telegram</button>
      ${site.phone?.tel ? `<a class="btn" href="${esc(site.phone.tel)}" data-call>Позвонить</a>` : ''}
      <button class="btn" type="button" data-link="${esc(C.channelUrl)}">Канал салона</button>
      ${C.siteUrl ? '<button class="btn btn-wide" type="button" data-site>Открыть сайт</button>' : ''}
    </div>
    <h2 class="sec">Как купить</h2>
    <div class="info">
      <p><b>Подбор.</b> Поможем выбрать по росту, опыту и задачам — напишите или пройдите подбор.</p>
      <p><b>Наличие и цена.</b> Цены — по каталогу поставщика. Модели «под заказ» привезём, срок и итоговую цену подтвердим в переписке.</p>
      <p><b>Подготовка.</b> Смазка, проверка и протяжка перед выдачей входят в стоимость.</p>
      <p><b>Доставка.</b> До ${d.freeRadiusKm || 150} км бесплатно при стоимости техники от ${new Intl.NumberFormat('ru-RU').format(d.freeFromPrice || 100000)} ₽, дальше — ${d.pricePerKm || 40} ₽/км.</p>
      <p><b>Визит.</b> ${esc(site.visitText || '')}</p>
    </div>
    <p class="note">Мини-приложение не собирает персональные данные: избранное хранится в вашем Telegram, сообщения вы отправляете сами.${C.siteUrl ? ' <a href="#" data-link-site="privacy.html">Конфиденциальность</a> · <a href="#" data-link-site="terms.html">Правовая информация</a>' : ' Информация не является публичной офертой.'}</p>`;
  setMainButton(null);
}

/* ---------- Сервис ---------- */
const svc = { model: '', run: '', issue: '', when: '' };
const WHEN = ['Как можно скорее', 'На этой неделе', 'На следующей неделе', 'Договоримся в переписке'];
function renderService() {
  const names = [...byId.values()].map(m => m.name);
  view.innerHTML = `<h2 class="sec">Сервис и ремонт</h2>
    <p class="lead-text">Опишите технику и неисправность — заявка уйдёт в мотосалон готовым текстом. Цену и срок назовут после осмотра.</p>
    <form class="form" data-svc-form novalidate>
      <div class="field"><label for="svc-model">Модель</label>
        <input id="svc-model" name="model" list="svc-models" autocomplete="off" placeholder="Например, JHLofr LX MT300" value="${esc(svc.model)}">
        <datalist id="svc-models">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div class="field"><label for="svc-run">Пробег или моточасы</label>
        <input id="svc-run" name="run" inputmode="text" placeholder="Например, 40 моточасов" value="${esc(svc.run)}"></div>
      <div class="field"><label for="svc-issue">Что случилось <span aria-hidden="true">*</span></label>
        <textarea id="svc-issue" name="issue" required aria-describedby="svc-issue-hint svc-issue-err" placeholder="Например, не заводится после зимы, течёт масло, нужно ТО">${esc(svc.issue)}</textarea>
        <span class="hint" id="svc-issue-hint">Фото и видео можно отправить в чате после заявки.</span>
        <span class="err" id="svc-issue-err" role="alert" hidden>Опишите, что случилось, — хотя бы пару слов.</span></div>
      <div class="field"><label for="svc-when">Когда удобно привезти</label>
        <select id="svc-when" name="when">${WHEN.map(w => `<option${w === svc.when ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select></div>
      <div class="actions">
        <button class="btn btn-accent btn-wide" type="submit">Отправить заявку</button>
        ${C.serviceChatUrl ? '<button class="btn btn-wide" type="button" data-link="' + esc(C.serviceChatUrl) + '">Сервисный чат</button>' : ''}
      </div>
    </form>
    <p class="note">Данные никуда не сохраняются: заявку вы отправляете сами.</p>`;
  setMainButton(null);
}
function sendService(form) {
  const f = Object.fromEntries(new FormData(form));
  Object.assign(svc, f);
  const issue = form.querySelector('#svc-issue'), err = form.querySelector('#svc-issue-err');
  if (!String(f.issue || '').trim()) { issue.setAttribute('aria-invalid', 'true'); err.hidden = false; issue.focus(); haptic('heavy'); return; }
  issue.removeAttribute('aria-invalid'); err.hidden = true;
  const lines = ['Здравствуйте! Заявка на сервис.'];
  if (f.model.trim()) lines.push(`Модель: ${f.model.trim()}`);
  if (f.run.trim()) lines.push(`Пробег / моточасы: ${f.run.trim()}`);
  lines.push(`Что случилось: ${f.issue.trim()}`, `Когда удобно привезти: ${f.when}`);
  if (who()) lines.push(`Пишу из Telegram: ${who()}.`);
  sendToVadim(lines.join('\n'), { kind: 'service', model: f.model.trim() });
}
document.addEventListener('submit', e => { if (e.target.matches('[data-svc-form]')) { e.preventDefault(); sendService(e.target); } });
document.addEventListener('input', e => { const f = e.target.closest('[data-svc-form]'); if (f && e.target.name in svc) svc[e.target.name] = e.target.value; });

/* ---------- Навигация ---------- */
/** Всё, что нужно админке от приложения. */
const adminCtx = {
  get view() { return view; }, get api() { return api; }, STATUS, asset, formatPrice, toast, haptic, setMainButton,
  getModels: () => models, getById: () => byId, getOverrides: () => overrides, getSite: () => site,
  me: () => meState, userId: () => tg?.initDataUnsafe?.user?.id ?? null,
  confirm: msg => new Promise(res => (inTelegram() && tg.showConfirm ? tg.showConfirm(msg, ok => res(!!ok)) : res(window.confirm(msg)))),
  fail(e) { haptic('error'); toast(e?.message || 'Не получилось. Попробуйте ещё раз.', 7000); },
  reload,
};
async function reload() {
  const ov = await api.publicData(8000);
  overrides = ov;
  build();
  paintBrand();
  route();
}

function route() {
  const h = location.hash || '#/';
  view.onclick = view.onsubmit = view.oninput = view.onchange = null; // обработчики админки не должны жить на других экранах
  const isAdmin = h.startsWith('#/admin');
  const tab = isAdmin ? 'admin' : h.startsWith('#/pick') ? 'pick' : h.startsWith('#/fav') ? 'fav' : h.startsWith('#/service') ? 'service' : h.startsWith('#/contact') ? 'contact' : h.startsWith('#/id') ? '' : 'catalog';
  document.querySelectorAll('.tabs a').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  const m = h.match(/^#\/m\/(TR-\d+)/);
  const deep = !!m || (tab === 'pick' && pick.step > 0) || /^#\/admin\/./.test(h);
  if (inTelegram()) { deep ? tg.BackButton.show() : tg.BackButton.hide(); }
  if (m) return renderModel(m[1]);
  setMainButton(null);
  if (isAdmin) {
    if (meState === undefined) { view.innerHTML = '<p class="empty">Проверяю доступ…</p>'; return; }
    return renderAdmin(adminCtx, h);
  }
  if (h.startsWith('#/id')) return renderId(adminCtx);
  if (tab === 'pick') return renderPick();
  if (tab === 'fav') return renderFav();
  if (tab === 'service') return renderService();
  if (tab === 'contact') return renderContact();
  return renderCatalog();
}
function back() {
  haptic('light');
  if (location.hash.startsWith('#/pick') && pick.step > 0) { pick.step--; return route(); }
  history.length > 1 ? history.back() : (location.hash = '#/');
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-fav],[data-open],[data-cat],[data-more],[data-go],[data-answer],[data-restart],[data-lead],[data-share],[data-send-pick],[data-send-favs],[data-write],[data-link],[data-site],[data-link-site],[data-call]');
  if (!t) return;
  const d = t.dataset;
  if (d.fav) { e.stopPropagation(); toggleFav(d.fav); t.setAttribute('aria-pressed', favs.has(d.fav)); if (t.classList.contains('btn')) t.textContent = favs.has(d.fav) ? 'В избранном' : 'В избранное'; if (location.hash.startsWith('#/fav')) renderFav(); return; }
  if (d.open) { state.listScroll = window.scrollY; haptic('light'); location.hash = `#/m/${d.open}`; return; }
  if (d.cat) { state.cat = d.cat; state.shown = 20; state.listScroll = 0; haptic('light'); return renderCatalog(); }
  if ('more' in d) { state.shown += 20; state.listScroll = window.scrollY; return renderCatalog(); }
  if (d.go) { location.hash = d.go; return; }
  if (d.answer) { const [k, v] = d.answer.split(':'); pick.answers[k] = v; pick.step = Math.min(Q.length, pick.step + 1); haptic('light'); return route(); }
  if ('restart' in d) { e.preventDefault(); pick.step = 0; pick.answers = {}; return route(); }
  if (d.lead) return lead(byId.get(d.lead));
  if (d.share) return share(byId.get(d.share));
  if ('sendPick' in d) return sendPick();
  if ('sendFavs' in d) return sendFavs();
  if ('write' in d) return sendToVadim(buildMessage({ topic: 'Подбор техники' }) + (who() ? `\nПишу из Telegram: ${who()}.` : ''), { kind: 'contact' });
  if (d.link) return openLink(d.link);
  if ('site' in d) return openLink(new URL(C.siteUrl, location.href).href);
  if (d.linkSite) { e.preventDefault(); return openLink(new URL('../' + d.linkSite, location.href).href); }
  if ('call' in d && site.phone?.display) { copyText(site.phone?.display || ''); toast(`Номер ${site.phone?.display} скопирован — если звонок не открылся, наберите его вручную.`); }
});
addEventListener('hashchange', route);

/* ---------- Старт ---------- */
(async function start() {
  api = C.apiBase ? createApi(C.apiBase, () => tg?.initData || '') : null;
  const [cat, av, cfg, ov] = await Promise.all([
    fetch('../data/catalog.json').then(r => r.json()),
    fetch('../data/availability.json').then(r => r.json()).catch(() => ({})),
    fetch('../data/site-config.json').then(r => r.json()),
    api ? api.publicData(2500).catch(() => null) : null, // сервер недоступен — показываем каталог без правок
  ]);
  base = { models: cat.models, statuses: av.statuses || {} };
  overrides = ov;
  site = cfg; site.salonName = 'ТРИУМФ';
  catalogDate = formatDate(cat.catalogCheckedAt) || '';
  build();
  tg = await waitTelegram();
  if (tg) {
    tg.ready(); tg.expand();
    try { if (can('7.7')) tg.disableVerticalSwipes(); } catch {}
    try { tg.setHeaderColor('bg_color'); tg.setBackgroundColor('bg_color'); } catch {}
    tg.BackButton.onClick(back);
    tg.onEvent('themeChanged', () => { paintBrand(); refreshCoverImages(); refreshGalleryTheme(); });
    const sp = parseStart(tg.initDataUnsafe?.start_param);
    if (sp.src) leadSrc = sp.src;
    if (sp.model === 'id') location.hash = '#/id';
    else if (sp.model && byId.has(sp.model) && !location.hash.startsWith('#/m/')) location.hash = `#/m/${sp.model}`;
  }
  paintBrand();
  // Сайт в обычном браузере (та же сборка): тема меняется ОС/браузером, а не событием Telegram.
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paintBrand(); refreshCoverImages(); refreshGalleryTheme(); }); } catch {}
  const qs = new URLSearchParams(location.search);
  if (!leadSrc && qs.get('src')) leadSrc = cleanSrc(qs.get('src'));
  const q = qs.get('model');
  if (q === 'id') location.hash = '#/id';
  else if (q && byId.has(q) && !location.hash.startsWith('#/m/')) location.hash = `#/m/${q}`;
  favs = await loadFavs(); saveFavs();
  // Проверка админа: сервер сверяет подпись Telegram и ID. Вкладка «Админ» нужна только как удобство.
  if (api && inTelegram()) {
    api.call('/api/me', {}, 6000).then(r => { meState = r; }).catch(() => { meState = null; }).then(() => {
      document.querySelector('.tabs').classList.toggle('six', !!meState?.admin);
      document.querySelector('[data-tab="admin"]').hidden = !meState?.admin;
      route();
    });
  } else meState = null;
  route();
})();

/** Собрать каталог из исходных данных и правок. */
function build() {
  models = applyOverrides(applyAvailability(structuredClone(base.models), base.statuses), overrides);
  byId = new Map(models.map(m => [m.id, m]));
}
/** Название салона и логотип из профиля (если его меняли) и тема. */
function paintBrand() {
  const p = overrides?.profile || {};
  site.salonName = p.salonName || 'ТРИУМФ';
  const dark = tg ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const custom = dark ? (p.logoDark || p.logoLight) : (p.logoLight || p.logoDark);
  const logo = $('[data-logo]');
  logo.src = okPath(custom) ? asset(custom) : `../assets/brand/triumf-lockup-${dark ? 'dark' : 'light'}.svg`;
  logo.alt = `${site.salonName} — мотосалон`;
}
