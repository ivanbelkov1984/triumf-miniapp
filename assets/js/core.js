// Чистая логика каталога без DOM: фильтры, фасеты, сортировка, пагинация, URL-состояние,
// текст сообщения Вадиму и ориентир стоимости доставки. Используется сайтом и unit-тестами.

const twins = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x' };
export const fold = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е')
  .replace(/см3|см³|куб\.?\s*см/g, 'cc').replace(/[авекмнорстух]/g, c => twins[c]).replace(/[^\p{L}\p{N}]/gu, '');

export const PAGE_SIZE = 24;
export const COMPARE_MAX = 4;
export const COMPARE_MIN = 2;

// Три статуса владельца. Вадим меняет их в data/availability.json без пересборки сайта.
export const STATUS = {
  in_stock: 'В наличии',
  order: 'Под заказ',
  unavailable: 'Нет в наличии',
};
export const STATUS_RANK = { in_stock: 0, order: 1, unavailable: 2 };

export const CATEGORY = { all: 'Вся мототехника', moto: 'Мотоциклы', pit: 'Питбайки', electro: 'Электро' };
export const KIND = { moto: 'Мотоцикл', pit: 'Питбайк', electro: 'Электромотоцикл' };

/** Статусы из data/availability.json поверх каталога. Неизвестные коды и модели игнорируются. */
export function applyAvailability(models, overrides = {}) {
  for (const m of models) { const s = overrides[m.id]; if (STATUS[s]) m.availabilityStatus = s; }
  return models;
}
export const SIZE = { full: 'Полноразмерный', mid: 'Среднеразмерный', pit: 'Питбайк' };
export const COOLING = { air: 'Воздушное', liquid: 'Жидкостное' };
export const FUEL = { carb: 'Карбюратор', injector: 'Инжектор' };
export const STROKE = { '2T': '2Т', '4T': '4Т' };
export const PTS = { yes: 'С ПТС', none: 'Без ПТС (спортинвентарь)' };
export const CC_BUCKETS = [
  ['u150', 'до 150 см³', v => v <= 150],
  ['u250', '151–250 см³', v => v > 150 && v <= 250],
  ['u300', '251–300 см³', v => v > 250 && v <= 300],
  ['o300', 'больше 300 см³', v => v > 300],
];

/** Описание фасетных фильтров. Фильтр показывается, только если у него есть достоверные значения. */
export const FACETS = [
  { key: 'brand', label: 'Бренд', get: m => m.brand },
  { key: 'size', label: 'Размер', get: m => m.sizeClass, labels: SIZE },
  { key: 'avail', label: 'Наличие', get: m => m.availabilityStatus, labels: STATUS, hideIfSingle: true },
  { key: 'cc', label: 'Объём двигателя', get: m => m.displacementCc == null ? null : (CC_BUCKETS.find(([, , t]) => t(m.displacementCc)) || [null])[0], labels: Object.fromEntries(CC_BUCKETS.map(([k, l]) => [k, l])) },
  { key: 'stroke', label: 'Тактность', get: m => m.stroke, labels: STROKE },
  { key: 'cool', label: 'Охлаждение', get: m => m.cooling, labels: COOLING },
  { key: 'fuel', label: 'Подача топлива', get: m => m.fuelSystem, labels: FUEL },
  { key: 'wheel', label: 'Формат колёс', get: m => m.wheelFormat },
  { key: 'pts', label: 'ПТС', get: m => m.ptsStatus, labels: PTS },
];
export const RANGES = [
  { key: 'price', label: 'Цена, ₽', get: m => m.price, step: 1000 },
  { key: 'hp', label: 'Мощность, л.с.', get: m => m.powerHp, step: 1 },
  { key: 'seat', label: 'Высота седла, мм', get: m => m.seatHeightMm, step: 10 },
];

export const SORTS = {
  availability: 'Сначала доступные',
  price_asc: 'Цена: по возрастанию',
  price_desc: 'Цена: по убыванию',
  power_desc: 'Мощность: сначала больше',
  power_asc: 'Мощность: сначала меньше',
  cc_desc: 'Объём: сначала больше',
  cc_asc: 'Объём: сначала меньше',
  seat_asc: 'Высота седла: ниже',
  weight_asc: 'Масса: легче',
  name: 'Название: А–Я',
};
const SORT_FIELD = { price: 'price', power: 'powerHp', cc: 'displacementCc', seat: 'seatHeightMm', weight: 'weightKg' };

export const emptyState = () => ({ q: '', cat: 'all', sort: 'availability', page: 1, fav: false, facets: {}, ranges: {} });

/** URL → состояние каталога. Неизвестные значения игнорируются. */
export function parseState(search) {
  const p = new URLSearchParams(search);
  const s = emptyState();
  s.q = (p.get('q') || '').slice(0, 80);
  if (CATEGORY[p.get('cat')]) s.cat = p.get('cat');
  if (SORTS[p.get('sort')]) s.sort = p.get('sort');
  const page = Number(p.get('page'));
  if (Number.isInteger(page) && page > 0) s.page = page;
  s.fav = p.get('fav') === '1';
  for (const f of FACETS) {
    const v = p.get(f.key);
    if (v) s.facets[f.key] = v.split(',').filter(Boolean).slice(0, 20);
  }
  for (const r of RANGES) {
    const v = p.get(r.key);
    if (!v) continue;
    const [a, b] = v.split('-').map(x => (x === '' ? null : Number(x)));
    const min = Number.isFinite(a) ? a : null, max = Number.isFinite(b) ? b : null;
    if (min != null || max != null) s.ranges[r.key] = { min, max };
  }
  return s;
}

/** Состояние → строка запроса (только непустые значения, порядок стабилен). */
export function stateToSearch(s, extra = {}) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.cat !== 'all') p.set('cat', s.cat);
  for (const f of FACETS) if (s.facets[f.key]?.length) p.set(f.key, s.facets[f.key].join(','));
  for (const r of RANGES) {
    const v = s.ranges[r.key];
    if (v && (v.min != null || v.max != null)) p.set(r.key, `${v.min ?? ''}-${v.max ?? ''}`);
  }
  if (s.fav) p.set('fav', '1');
  if (s.sort !== 'availability') p.set('sort', s.sort);
  if (s.page > 1) p.set('page', String(s.page));
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') p.set(k, v);
  const out = p.toString();
  return out ? '?' + out : '';
}

export function queryMatches(m, q) {
  const joined = String(q || '').replace(/(\d+)\s*(?:см3|см³|cc|сс|куб\.?\s*см)/gi, '$1cc');
  const tokens = joined.trim().split(/\s+/).map(fold).filter(Boolean);
  return tokens.every(t => m.search.includes(t));
}

/** Модель проходит все условия, кроме, возможно, одного фасета (для подсчёта вариантов). */
export function matches(m, s, favorites = new Set(), except = null) {
  if (s.cat !== 'all' && m.category !== s.cat) return false;
  if (s.fav && !favorites.has(m.id)) return false;
  if (s.q && !queryMatches(m, s.q)) return false;
  for (const f of FACETS) {
    if (f.key === except) continue;
    const sel = s.facets[f.key];
    if (sel?.length && !sel.includes(String(f.get(m)))) return false;
  }
  for (const r of RANGES) {
    if (r.key === except) continue;
    const v = s.ranges[r.key];
    if (!v) continue;
    const x = r.get(m);
    if (x == null) return false;
    if (v.min != null && x < v.min) return false;
    if (v.max != null && x > v.max) return false;
  }
  return true;
}

export const filterModels = (models, s, favorites) => models.filter(m => matches(m, s, favorites));

/** Количество моделей для каждого значения фасета при остальных выбранных условиях. */
export function facetCounts(models, s, favorites) {
  const out = {};
  for (const f of FACETS) {
    const all = new Map();
    for (const m of models) { const v = f.get(m); if (v != null) all.set(String(v), 0); }
    for (const m of models) {
      if (!matches(m, s, favorites, f.key)) continue;
      const v = f.get(m);
      if (v != null) all.set(String(v), (all.get(String(v)) || 0) + 1);
    }
    out[f.key] = all;
  }
  out.cat = { all: 0, moto: 0, pit: 0, electro: 0 };
  for (const m of models) {
    if (!matches(m, { ...s, cat: 'all' }, favorites)) continue;
    out.cat.all++; out.cat[m.category]++;
  }
  return out;
}

export function rangeBounds(models) {
  const out = {};
  for (const r of RANGES) {
    const vals = models.map(r.get).filter(v => v != null && Number.isFinite(v));
    out[r.key] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), count: vals.length } : null;
  }
  return out;
}

/** Сортировка: группы наличия сохраняются; неизвестные значения — в конце группы. */
export function sortModels(models, sort = 'availability') {
  const [field, dir] = sort.split('_');
  const key = SORT_FIELD[field];
  return [...models].sort((a, b) => {
    const g = (STATUS_RANK[a.availabilityStatus] ?? 1) - (STATUS_RANK[b.availabilityStatus] ?? 1);
    if (g) return g;
    if (sort === 'name') return a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id, undefined, { numeric: true });
    if (key) {
      const av = a[key], bv = b[key];
      const am = av == null || !Number.isFinite(av), bm = bv == null || !Number.isFinite(bv);
      if (am !== bm) return am ? 1 : -1;
      if (!am && av !== bv) return dir === 'desc' ? bv - av : av - bv;
    }
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export function paginate(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, items: list.slice((p - 1) * size, p * size), from: list.length ? (p - 1) * size + 1 : 0, to: Math.min(p * size, list.length) };
}

/** Номера страниц с многоточием: 1 … 4 5 6 … 10 */
export function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1]);
  const nums = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const modelsWord = n => plural(n, ['модель', 'модели', 'моделей']);

export const formatPrice = v => v == null ? 'Цена по запросу' : new Intl.NumberFormat('ru-RU').format(v) + ' ₽';
export const formatDate = iso => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}.${m}.${y}` : ''; };

/** Текст сообщения Вадиму. Ничего не отправляется автоматически. */
export function buildMessage({ model, url, name, phone, topic } = {}) {
  const lines = ['Здравствуйте, Вадим!'];
  if (model) {
    lines.push(`Интересует ${model.name}, ${model.id}.`);
    lines.push('Подскажите актуальное наличие, цену и комплектацию.');
    if (url) lines.push(`Ссылка: ${url}`);
  } else {
    lines.push(topic ? `Тема: ${topic}.` : 'Хочу задать вопрос о технике.');
  }
  const who = [name && name.trim() ? `Меня зовут ${name.trim()}.` : '', phone && phone.trim() ? `Мой номер: ${phone.trim()}.` : ''].filter(Boolean).join(' ');
  if (who) lines.push(who);
  return lines.join('\n');
}

/** Нормализация номера посетителя: только цифры и ведущий +. Не сохраняется. */
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return '+7' + digits.slice(1);
  if (digits.length === 10) return '+7' + digits;
  return digits.length >= 10 && digits.length <= 15 ? '+' + digits : null;
}

/** Ориентир стоимости доставки по условиям Вадима. Заказ и оплату не оформляет. */
export function deliveryEstimate(km, price, cfg) {
  const d = Number(km), p = Number(price);
  if (!Number.isFinite(d) || d < 0) return { ok: false, reason: 'Укажите расстояние в километрах.' };
  if (!Number.isFinite(p) || p <= 0) return { ok: false, reason: 'Укажите стоимость техники.' };
  if (p < cfg.freeFromPrice) return { ok: false, reason: `Для техники дешевле ${new Intl.NumberFormat('ru-RU').format(cfg.freeFromPrice)} ₽ стоимость доставки согласуется с Вадимом.` };
  const paidKm = Math.max(0, Math.ceil(d) - cfg.freeRadiusKm);
  return { ok: true, freeKm: Math.min(Math.ceil(d), cfg.freeRadiusKm), paidKm, cost: paidKm * cfg.pricePerKm, deposit: cfg.depositRub };
}

/** Строки сравнения: параметр → значения по моделям, признак различия. */
export function compareRows(models) {
  const keys = [];
  for (const m of models) for (const [k] of m.specs) if (!keys.includes(k)) keys.push(k);
  const norm = v => fold(v || '');
  return keys.map(k => {
    const values = models.map(m => m.specs.find(([kk]) => kk === k)?.[1] ?? null);
    const known = values.filter(v => v != null).map(norm);
    return { key: k, values, different: new Set(values.map(v => (v == null ? '∅' : norm(v)))).size > 1 && known.length > 0 };
  });
}
