'use strict';

/* ============================================================
   Cüzdan — banka hesapları, nakit ve kredi kartları tek yerde
   Gelir / gider kayıtları hesap bakiyelerini günceller.
   Veri: yalnızca localStorage. Sunucu yok.
   ============================================================ */

const STORAGE_KEY = 'cuzdan.v1';

const CATEGORIES = [
  { id: 'market',    name: 'Market',    emoji: '🛒', color: '#30d158' },
  { id: 'yemek',     name: 'Yemek',     emoji: '🍔', color: '#ff9f0a' },
  { id: 'ulasim',    name: 'Ulaşım',    emoji: '🚌', color: '#0a84ff' },
  { id: 'fatura',    name: 'Fatura',    emoji: '🧾', color: '#bf5af2' },
  { id: 'alisveris', name: 'Alışveriş', emoji: '🛍️', color: '#ff375f' },
  { id: 'eglence',   name: 'Eğlence',   emoji: '🎬', color: '#5e5ce6' },
  { id: 'saglik',    name: 'Sağlık',    emoji: '💊', color: '#64d2ff' },
  { id: 'diger',     name: 'Diğer',     emoji: '✨', color: '#8e8e93' },
];

const CAT_BY_ID = {};
for (const c of CATEGORIES) CAT_BY_ID[c.id] = c;

const TYPE_LABEL = { expense: 'Gider', income: 'Gelir' };

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const moneyFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

/* ---------------- küçük yardımcılar ---------------- */

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function pad2(n) { return String(n).padStart(2, '0'); }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return moneyFmt.format(Number(n));
}
function fmtTL(n) { return fmt(n) + ' ₺'; }

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function hexToRgba(hex, alpha) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
  const num = parseInt(h, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

/* "1.250,50" / "1250.50" / "1250,5" gibi girişleri sayıya çevirir */
function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s\u00A0₺]/g, '').replace(/TL/gi, '');
  if (!s) return null;
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;

  const hasComma = s.indexOf(',') !== -1;
  const hasDot = s.indexOf('.') !== -1;

  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length > 2) s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    else s = parts.join('.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts[1] && parts[1].length === 3)) s = parts.join('');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------------- tarih yardımcıları ---------------- */

function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function monthKeyOf(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function currentMonthKey() { return monthKeyOf(new Date()); }
function daysInMonthKey(key) {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1], 0).getDate();
}
function shiftMonth(key, delta) {
  const parts = key.split('-').map(Number);
  return monthKeyOf(new Date(parts[0], parts[1] - 1 + delta, 1));
}
function isMonthKey(key) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(key); }
function monthLabel(key) {
  const parts = key.split('-').map(Number);
  return MONTHS[parts[1] - 1] + ' ' + parts[0];
}
function isSameDay(ts, d) {
  const x = new Date(ts);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
}

/* ---------------- durum ---------------- */

let state = loadState();
let activeCat = 'market';
let activeType = 'expense';
let histMonth = currentMonthKey();
let editingId = null;
let lastDeleted = null;
let toastTimer = null;
let sheetHideTimer = null;

function defaultAccounts() {
  return [
    { id: 'akbank', name: 'Akbank Kart', kind: 'cash', balance: 0 },
    { id: 'akbank-cc', name: 'Akbank Kredi Kartı', kind: 'card', balance: 0 },
    { id: 'nakit', name: 'Nakit', kind: 'cash', balance: 0 },
    { id: 'yapikredi', name: 'YapıKredi', kind: 'cash', balance: 0 },
    { id: 'ziraat-cc', name: 'ZiraatBank Kredi Kartı', kind: 'card', balance: 0 },
  ];
}

function defaultState() {
  return { version: 4, theme: 'auto', accounts: defaultAccounts(), months: {} };
}

function toAmountOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? round2(n) : null;
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const kind = raw.kind === 'card' ? 'card' : 'cash';
  let balance = round2(raw.balance);
  if (kind === 'card') balance = Math.max(0, balance);

  return {
    id: String(raw.id || uid()),
    name: String(raw.name || 'Hesap').slice(0, 30),
    kind: kind,
    balance: balance,
  };
}

function normalizeState(raw) {
  const out = defaultState();
  if (!raw || typeof raw !== 'object') return out;

  if (['auto', 'dark', 'light'].indexOf(raw.theme) !== -1) out.theme = raw.theme;

  if (Array.isArray(raw.accounts) && raw.accounts.length) {
    out.accounts = raw.accounts.map(normalizeAccount).filter(Boolean);
  }
  if (!out.accounts.length) out.accounts = defaultAccounts();

  /* Eski tek hesap modelinden (nakit + kart borcu) bakiye taşı */
  if (!Array.isArray(raw.accounts)) {
    const cashAcc = out.accounts.find(function (a) { return a.id === 'nakit'; });
    if (cashAcc && raw.cash != null) cashAcc.balance = round2(raw.cash);

    const cardAcc = out.accounts.find(function (a) { return a.id === 'akbank-cc'; });
    const oldDebt = raw.cardDebt != null ? raw.cardDebt : raw.cardMonthly;
    if (cardAcc && oldDebt != null) cardAcc.balance = Math.max(0, round2(oldDebt));
  }

  const ids = {};
  out.accounts.forEach(function (a) { ids[a.id] = true; });

  const months = (raw.months && typeof raw.months === 'object') ? raw.months : {};

  Object.keys(months).forEach(function (key) {
    const value = months[key];
    if (!isMonthKey(key) || !value || typeof value !== 'object') return;

    let list = [];
    if (Array.isArray(value.entries)) list = value.entries;
    else if (Array.isArray(value.expenses)) list = value.expenses;

    const entries = list.map(function (e) {
      if (!e || typeof e !== 'object') return null;

      const amount = round2(e.amount);
      if (!(amount > 0)) return null;

      let type = e.type === 'income' ? 'income' : 'expense';
      let acc = String(e.acc || '');
      let note = String(e.note || '');

      /* Eski "kart ödemesi" kayıtları: kart borcunu azaltan bir gelir gibi göster */
      if (e.type === 'payment') {
        type = 'income';
        const card = out.accounts.find(function (a) { return a.kind === 'card'; });
        acc = card ? card.id : acc;
        if (!note) note = 'Kart ödemesi';
      }

      if (!ids[acc]) acc = out.accounts[0].id;

      return {
        id: String(e.id || uid()),
        type: type,
        amount: amount,
        acc: acc,
        cat: CAT_BY_ID[e.cat] ? e.cat : 'diger',
        note: note.slice(0, 80),
        at: Number(e.at) || Date.now(),
      };
    }).filter(Boolean).sort(function (a, b) { return a.at - b.at; });

    if (entries.length) out.months[key] = { entries: entries };
  });

  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    console.warn('Kayıt okunamadı:', err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('Kayıt yapılamadı. Tarayıcı depolaması dolu olabilir.');
  }
}

function ensureMonth(key) {
  if (!state.months[key]) state.months[key] = { entries: [] };
  return state.months[key];
}

function entriesOf(key) {
  const m = state.months[key];
  return m ? m.entries : [];
}

/* ---------------- hesaplar ---------------- */

function findAccount(id) {
  for (let i = 0; i < state.accounts.length; i += 1) {
    if (state.accounts[i].id === id) return state.accounts[i];
  }
  return null;
}

function accountName(id) {
  const acc = findAccount(id);
  return acc ? acc.name : 'Hesap';
}

function accountTotals() {
  let cash = 0;
  let debt = 0;

  state.accounts.forEach(function (a) {
    if (a.kind === 'card') debt += a.balance;
    else cash += a.balance;
  });

  return {
    cash: round2(cash),
    debt: round2(debt),
    total: round2(cash - debt),
  };
}

/* ---------------- bakiye etkileri ---------------- */

function applyEntry(entry, sign) {
  const acc = findAccount(entry.acc);
  if (!acc) return;

  const isCard = acc.kind === 'card';
  const delta = sign * entry.amount;

  if (entry.type === 'income') {
    acc.balance = round2(acc.balance + (isCard ? -delta : delta));
  } else {
    acc.balance = round2(acc.balance + (isCard ? delta : -delta));
  }

  if (isCard) acc.balance = Math.max(0, acc.balance);
}

function adjustEntryAmount(entry, newAmount) {
  const acc = findAccount(entry.acc);
  const diff = round2(newAmount - entry.amount);

  if (acc) {
    const isCard = acc.kind === 'card';

    if (entry.type === 'income') {
      acc.balance = round2(acc.balance + (isCard ? -diff : diff));
    } else {
      acc.balance = round2(acc.balance + (isCard ? diff : -diff));
    }

    if (isCard) acc.balance = Math.max(0, acc.balance);
  }

  entry.amount = round2(newAmount);
}

/* ---------------- toplamlar ---------------- */

function totalsFor(list) {
  let income = 0;
  let expense = 0;

  (list || []).forEach(function (e) {
    if (e.type === 'income') income += e.amount;
    else expense += e.amount;
  });

  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    count: (list || []).length,
  };
}

function monthTotals(key) { return totalsFor(entriesOf(key)); }

function todayEntries() {
  const now = new Date();
  return entriesOf(currentMonthKey()).filter(function (e) { return isSameDay(e.at, now); });
}

/* ---------------- liste parçaları ---------------- */

function entryItemHTML(e) {
  let color, emoji, title, amountText, amountClass;

  if (e.type === 'income') {
    color = '#30d158';
    emoji = '💵';
    title = 'Gelir';
    amountText = '+' + fmt(e.amount);
    amountClass = ' amt-in';
  } else {
    const cat = CAT_BY_ID[e.cat] || CAT_BY_ID.diger;
    color = cat.color;
    emoji = cat.emoji;
    title = cat.name;
    amountText = fmt(e.amount);
    amountClass = '';
  }

  const d = new Date(e.at);
  const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const sub = accountName(e.acc) + ' · ' + (e.note || time);

  return '<li><button type="button" class="item" data-entry="' + esc(e.id) + '">' +
    '<span class="badge" style="--c-bg:' + hexToRgba(color, 0.18) + ';--c-line:' + hexToRgba(color, 0.34) + '" aria-hidden="true">' + emoji + '</span>' +
    '<span class="item-text"><span class="item-title">' + esc(title) + '</span>' +
    '<span class="item-sub">' + esc(sub) + '</span></span>' +
    '<span class="item-amt' + amountClass + '">' + amountText + ' <small>₺</small></span>' +
    '</button></li>';
}

/* ---------------- ekran: bugün ---------------- */

function renderHero() {
  const now = new Date();
  const key = currentMonthKey();
  const totals = monthTotals(key);
  const today = totalsFor(todayEntries());
  const accTotals = accountTotals();
  const hasAccounts = state.accounts.length > 0;

  $('#appSub').textContent = monthLabel(key) + ' · hesaplar';
  $('#todayPill').textContent = now.getDate() + ' ' + MONTHS[now.getMonth()];

  $('#heroAmount').textContent = hasAccounts ? fmt(accTotals.total) : '—';
  $('#heroAmount').classList.toggle('neg', hasAccounts && accTotals.total < 0);

  const noteEl = $('#heroNote');
  noteEl.classList.remove('bad');

  if (!hasAccounts) {
    noteEl.textContent = 'Hesap eklemek için ayarlara git.';
  } else {
    noteEl.textContent = 'Nakit ' + fmtTL(accTotals.cash) +
      (accTotals.debt > 0 ? ' · kart borcu ' + fmtTL(accTotals.debt) : ' · kart borcu yok');
    if (accTotals.total < 0) noteEl.classList.add('bad');
  }

  $('#heroToday').textContent = fmtTL(today.expense);
  $('#heroMonth').textContent = fmtTL(totals.expense);
  $('#todayCount').textContent = today.count ? today.count + ' kayıt' : '';
}

function renderAccounts() {
  const list = $('#accList');

  if (!state.accounts.length) {
    list.innerHTML = '';
    $('#accEmpty').hidden = false;
    return;
  }

  $('#accEmpty').hidden = true;

  list.innerHTML = state.accounts.map(function (a) {
    const isCard = a.kind === 'card';
    return '<li class="acc-item">' +
      '<span class="acc-dot" style="background:' + (isCard ? 'var(--red)' : 'var(--green)') + '"></span>' +
      '<span class="acc-name">' + esc(a.name) + '</span>' +
      (isCard ? '<span class="acc-tag">borç</span>' : '') +
      '<span class="acc-bal' + (isCard ? ' debt' : '') + '">' + fmt(a.balance) + ' <small>₺</small></span>' +
      '</li>';
  }).join('');
}

function renderTodayList() {
  const items = todayEntries().slice().sort(function (a, b) { return b.at - a.at; });

  $('#todayList').innerHTML = items.map(entryItemHTML).join('');
  $('#todayEmpty').hidden = items.length > 0;
}

/* ---------------- ekran: geçmiş ---------------- */

function renderBars(key) {
  const days = daysInMonthKey(key);
  const byDay = {};

  entriesOf(key).forEach(function (e) {
    if (e.type !== 'expense') return;
    const d = new Date(e.at).getDate();
    byDay[d] = round2((byDay[d] || 0) + e.amount);
  });

  let max = 0;
  Object.keys(byDay).forEach(function (d) { if (byDay[d] > max) max = byDay[d]; });

  const isCurrent = key === currentMonthKey();
  const todayNum = new Date().getDate();
  const monthIdx = Number(key.slice(5)) - 1;
  const parts = [];

  for (let d = 1; d <= days; d += 1) {
    const value = byDay[d] || 0;
    const height = value > 0 && max > 0 ? Math.max(7, Math.round((value / max) * 100)) : 2;
    const isToday = isCurrent && d === todayNum;
    parts.push('<span class="bar' + (value > 0 ? ' has' : '') + (isToday ? ' today' : '') +
      '" style="height:' + height + '%" title="' + d + ' ' + MONTHS[monthIdx] + ': ' + esc(fmtTL(value)) + '"></span>');
  }

  $('#bars').innerHTML = parts.join('');
  $('#barsMid').textContent = Math.ceil(days / 2);
  $('#barsEnd').textContent = days;
  $('#histPeak').textContent = max > 0 ? 'en yüksek ' + fmtTL(max) : '';
}

function renderCategories(key) {
  const totals = {};

  entriesOf(key).forEach(function (e) {
    if (e.type !== 'expense') return;
    totals[e.cat] = round2((totals[e.cat] || 0) + e.amount);
  });

  const rows = Object.keys(totals).map(function (id) {
    return { id: id, amount: totals[id] };
  }).sort(function (a, b) { return b.amount - a.amount; });

  const total = rows.reduce(function (t, r) { return t + r.amount; }, 0);

  $('#catsEmpty').hidden = rows.length > 0;
  $('#histCatCount').textContent = rows.length ? fmtTL(total) : '';

  $('#cats').innerHTML = rows.map(function (row) {
    const cat = CAT_BY_ID[row.id] || CAT_BY_ID.diger;
    const pct = total > 0 ? (row.amount / total) * 100 : 0;
    return '<div class="cat-row">' +
      '<span class="dot" style="background:' + cat.color + '"></span>' +
      '<span class="cat-name">' + esc(cat.name) + '</span>' +
      '<span class="cat-amt">' + fmtTL(row.amount) + '</span>' +
      '<span class="cat-bar"><i style="width:' + pct.toFixed(1) + '%;background:' + cat.color + '"></i></span>' +
      '</div>';
  }).join('');
}

function renderHistList(key) {
  const items = entriesOf(key).slice().sort(function (a, b) { return b.at - a.at; });

  if (!items.length) {
    $('#histList').innerHTML = '';
    $('#histEmpty').hidden = false;
    $('#histCount').textContent = '';
    return;
  }

  $('#histEmpty').hidden = true;

  const groups = [];
  const index = {};
  items.forEach(function (e) {
    const k = dateKey(new Date(e.at));
    if (index[k] === undefined) {
      index[k] = groups.length;
      groups.push({ key: k, list: [] });
    }
    groups[index[k]].list.push(e);
  });

  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  let html = '';
  groups.forEach(function (group) {
    const p = group.key.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);

    let label;
    if (dateKey(now) === group.key) label = 'Bugün';
    else if (dateKey(yesterday) === group.key) label = 'Dün';
    else label = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + WEEKDAYS[d.getDay()];

    const dayExpense = group.list.reduce(function (t, e) {
      return e.type === 'expense' ? t + e.amount : t;
    }, 0);

    html += '<div class="day-head"><span>' + label + '</span><b>' +
      (dayExpense > 0 ? fmtTL(dayExpense) : '') + '</b></div>';
    html += '<ul class="list">' + group.list.map(entryItemHTML).join('') + '</ul>';
  });

  $('#histList').innerHTML = html;
  $('#histCount').textContent = items.length + ' kayıt';
}

function renderHistory() {
  if (!isMonthKey(histMonth)) histMonth = currentMonthKey();
  if (histMonth > currentMonthKey()) histMonth = currentMonthKey();

  const key = histMonth;
  const totals = monthTotals(key);

  $('#histMonth').textContent = monthLabel(key);
  $('#histMonthSub').textContent = totals.count ? totals.count + ' kayıt' : 'kayıt yok';

  $('#histIn').textContent = totals.income > 0 ? fmtTL(totals.income) : '—';
  $('#histIn').classList.toggle('pos', totals.income > 0);
  $('#histOut').textContent = totals.expense > 0 ? fmtTL(totals.expense) : '—';
  $('#histNet').textContent = totals.count ? fmtTL(totals.net) : '—';
  $('#histNet').classList.toggle('neg', totals.net < 0);

  $('#nextMonth').disabled = key >= currentMonthKey();

  renderBars(key);
  renderCategories(key);
  renderHistList(key);
}

/* ---------------- ekran: ayarlar ---------------- */

function formatInput(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return String(Number(n)).replace('.', ',');
}

function renderSettings() {
  const totals = accountTotals();
  $('#settingsTotal').textContent = state.accounts.length ? 'Toplam ' + fmtTL(totals.total) : '';

  $('#accSettings').innerHTML = state.accounts.map(function (a) {
    const isCard = a.kind === 'card';
    return '<li class="acc-edit">' +
      '<span class="acc-dot" style="background:' + (isCard ? 'var(--red)' : 'var(--green)') + '"></span>' +
      '<span class="acc-edit-name">' + esc(a.name) +
      '<small>' + (isCard ? 'kredi kartı · borç' : 'banka / nakit') + '</small></span>' +
      '<input class="acc-balance" type="text" inputmode="decimal" value="' + formatInput(a.balance) + '"' +
      ' data-acc-balance="' + esc(a.id) + '" aria-label="' + esc(a.name) + ' bakiyesi">' +
      '<button type="button" class="acc-del" data-acc-del="' + esc(a.id) + '" aria-label="' + esc(a.name) + ' hesabını sil">×</button>' +
      '</li>';
  }).join('');

  $$('#themeSeg button').forEach(function (btn) {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeValue === state.theme));
  });
}

function buildAccountSelect(keepId) {
  const select = $('#accSelect');
  const current = keepId || select.value;

  select.innerHTML = state.accounts.map(function (a) {
    return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
  }).join('');

  if (state.accounts.some(function (a) { return a.id === current; })) {
    select.value = current;
  }

  updateTypeHint();
}

function updateTypeHint() {
  const acc = findAccount($('#accSelect').value);
  const isCard = acc && acc.kind === 'card';
  const hintEl = $('#typeHint');

  if (!acc) {
    hintEl.textContent = 'Önce bir hesap ekle.';
    return;
  }

  hintEl.textContent = activeType === 'income'
    ? (isCard ? 'Kart borcundan düşer.' : 'Hesap bakiyesine eklenir.')
    : (isCard ? 'Kart borcuna eklenir.' : 'Hesap bakiyesinden düşer.');
}

function render() {
  renderHero();
  renderAccounts();
  renderTodayList();
  renderHistory();
  renderSettings();
}

/* ---------------- tema ---------------- */

const lightMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

function applyTheme() {
  const resolved = state.theme === 'auto'
    ? (lightMQ && lightMQ.matches ? 'light' : 'dark')
    : state.theme;

  document.documentElement.dataset.theme = resolved;

  const meta = $('#metaTheme');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#eef1f7' : '#050507');
}

if (lightMQ) {
  const onSchemeChange = function () { if (state.theme === 'auto') applyTheme(); };
  if (lightMQ.addEventListener) lightMQ.addEventListener('change', onSchemeChange);
  else if (lightMQ.addListener) lightMQ.addListener(onSchemeChange);
}

/* ---------------- görünüm değiştirme ---------------- */

function showView(name) {
  ['today', 'history', 'settings'].forEach(function (view) {
    const el = document.getElementById('view-' + view);
    if (el) el.hidden = view !== name;
  });

  $$('.tab').forEach(function (tab) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  });

  if (name === 'settings') renderSettings();
  if (name === 'history') renderHistory();

  window.scrollTo(0, 0);
}

/* ---------------- kayıt türü ---------------- */

function setType(type) {
  activeType = type === 'income' ? 'income' : 'expense';

  $$('#typeSeg button').forEach(function (btn) {
    btn.setAttribute('aria-pressed', String(btn.dataset.type === activeType));
  });

  $('#chips').hidden = activeType !== 'expense';
  $('#addBtn').textContent = activeType === 'income' ? 'Geliri ekle' : 'Gideri ekle';

  updateTypeHint();
}

/* ---------------- kayıt ekleme ---------------- */

function addEntry() {
  const amountInput = $('#amountInput');
  const amount = parseAmount(amountInput.value);

  if (amount == null || amount <= 0) {
    toast('Geçerli bir tutar gir.');
    amountInput.focus();
    return;
  }
  if (amount > 100000000) {
    toast('Tutar çok büyük.');
    return;
  }

  const acc = findAccount($('#accSelect').value) || state.accounts[0];
  if (!acc) {
    toast('Önce bir hesap ekle.');
    return;
  }

  const key = currentMonthKey();
  const m = ensureMonth(key);

  const entry = {
    id: uid(),
    type: activeType,
    amount: round2(amount),
    acc: acc.id,
    cat: activeCat,
    note: $('#noteInput').value.trim().slice(0, 80),
    at: Date.now(),
  };

  applyEntry(entry, 1);
  m.entries.push(entry);

  saveState();

  amountInput.value = '';
  $('#noteInput').value = '';

  if (navigator.vibrate) navigator.vibrate(8);

  render();

  toast(activeType === 'income'
    ? fmtTL(entry.amount) + ' gelir eklendi'
    : fmtTL(entry.amount) + ' gider eklendi');
}

/* ---------------- bildirim ---------------- */

function hideToast() {
  const el = $('#toast');
  if (el) el.classList.remove('show');
}

function toast(message, actionLabel, action) {
  const el = $('#toast');
  if (!el) return;

  el.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  if (actionLabel && action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', function () {
      action();
      hideToast();
    }, { once: true });
    el.appendChild(btn);
  }

  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 4500 : 2600);
}

/* ---------------- detay sayfası ---------------- */

function findEntry(id) {
  const keys = Object.keys(state.months);
  for (let i = 0; i < keys.length; i += 1) {
    const list = state.months[keys[i]].entries;
    for (let j = 0; j < list.length; j += 1) {
      if (list[j].id === id) return list[j];
    }
  }
  return null;
}

function openSheet(id) {
  const entry = findEntry(id);
  if (!entry) return;

  editingId = id;

  const cat = CAT_BY_ID[entry.cat] || CAT_BY_ID.diger;
  const d = new Date(entry.at);

  $('#sheetTitle').textContent = entry.type === 'expense' ? cat.name : 'Gelir';
  $('#sheetCatField').hidden = entry.type !== 'expense';
  $('#sheetCat').value = entry.cat;
  $('#sheetAmount').value = String(entry.amount).replace('.', ',');
  $('#sheetNote').value = entry.note || '';
  $('#sheetMeta').textContent = TYPE_LABEL[entry.type] + ' · ' + accountName(entry.acc) + ' · ' +
    d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() +
    ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());

  const wrap = $('#sheetWrap');
  clearTimeout(sheetHideTimer);
  wrap.hidden = false;
  requestAnimationFrame(function () {
    if (!wrap.hidden && editingId) wrap.classList.add('open');
  });
  document.body.classList.add('locked');
}

function closeSheet() {
  const wrap = $('#sheetWrap');
  wrap.classList.remove('open');
  document.body.classList.remove('locked');
  clearTimeout(sheetHideTimer);
  sheetHideTimer = setTimeout(function () { wrap.hidden = true; }, 240);
  editingId = null;
}

function deleteEntry(id) {
  const keys = Object.keys(state.months);
  for (let i = 0; i < keys.length; i += 1) {
    const list = state.months[keys[i]].entries;
    for (let j = 0; j < list.length; j += 1) {
      if (list[j].id === id) {
        applyEntry(list[j], -1);
        lastDeleted = { key: keys[i], index: j, entry: list[j] };
        list.splice(j, 1);
        saveState();
        render();
        toast('Kayıt silindi', 'Geri al', undoDelete);
        return;
      }
    }
  }
}

function undoDelete() {
  if (!lastDeleted) return;
  const m = ensureMonth(lastDeleted.key);
  applyEntry(lastDeleted.entry, 1);
  const index = Math.min(lastDeleted.index, m.entries.length);
  m.entries.splice(index, 0, lastDeleted.entry);
  lastDeleted = null;
  saveState();
  render();
}

/* ---------------- hesap ekleme / silme ---------------- */

function addAccount() {
  const name = $('#accName').value.trim();
  if (!name) {
    toast('Hesap adı gir.');
    $('#accName').focus();
    return;
  }
  if (state.accounts.some(function (a) { return a.name.toLowerCase() === name.toLowerCase(); })) {
    toast('Bu isimde bir hesap var.');
    return;
  }

  const kind = $('#accKind').value === 'card' ? 'card' : 'cash';
  const value = parseAmount($('#accBalance').value);
  let balance = value == null ? 0 : round2(value);
  if (kind === 'card') balance = Math.max(0, balance);

  state.accounts.push({ id: uid(), name: name.slice(0, 30), kind: kind, balance: balance });

  $('#accName').value = '';
  $('#accBalance').value = '';
  $('#accKind').value = 'cash';

  saveState();
  buildAccountSelect(state.accounts[state.accounts.length - 1].id);
  render();
  toast('Hesap eklendi');
}

function deleteAccount(id) {
  const acc = findAccount(id);
  if (!acc) return;

  if (!window.confirm(acc.name + ' hesabı silinsin mi? Bakiyesi toplamdan çıkar.')) return;

  state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
  saveState();
  buildAccountSelect();
  render();
  toast('Hesap silindi');
}

/* ---------------- dışa / içe aktarma ---------------- */

function exportBackup() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cuzdan-yedek-' + dateKey(new Date()) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  toast('Yedek indirildi');
}

function importBackup(file) {
  const reader = new FileReader();

  reader.onload = function () {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || typeof parsed !== 'object') throw new Error('Yedek biçimi geçersiz');

      if (!window.confirm('Mevcut veriler yedek dosyasındaki verilerle değiştirilecek. Devam edilsin mi?')) {
        return;
      }

      state = normalizeState(parsed);
      saveState();
      applyTheme();
      histMonth = currentMonthKey();
      buildAccountSelect();
      render();
      toast('Yedek yüklendi');
    } catch (err) {
      toast('Dosya okunamadı. Geçerli bir yedek seç.');
    }
  };

  reader.onerror = function () { toast('Dosya okunamadı.'); };
  reader.readAsText(file);
}

/* ---------------- başlatma ---------------- */

function buildChips() {
  $('#chips').innerHTML = CATEGORIES.map(function (c) {
    return '<button type="button" class="chip" data-cat="' + c.id + '" aria-pressed="' +
      String(c.id === activeCat) + '"><span aria-hidden="true">' + c.emoji + '</span>' + c.name + '</button>';
  }).join('');
}

function syncChips() {
  $$('#chips .chip').forEach(function (chip) {
    chip.setAttribute('aria-pressed', String(chip.dataset.cat === activeCat));
  });
}

function buildSheetCategories() {
  $('#sheetCat').innerHTML = CATEGORIES.map(function (c) {
    return '<option value="' + c.id + '">' + c.name + '</option>';
  }).join('');
}

function bindEvents() {
  /* sekmeler */
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { showView(tab.dataset.view); });
  });

  /* hesapları düzenle kısayolu */
  $('#editAccounts').addEventListener('click', function () { showView('settings'); });

  /* kayıt türü */
  $('#typeSeg').addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-type]');
    if (!btn) return;
    setType(btn.dataset.type);
  });

  /* hesap seçimi */
  $('#accSelect').addEventListener('change', updateTypeHint);

  /* kategori seçimi */
  $('#chips').addEventListener('click', function (ev) {
    const chip = ev.target.closest('[data-cat]');
    if (!chip) return;
    activeCat = chip.dataset.cat;
    syncChips();
  });

  /* kayıt ekleme */
  $('#addBtn').addEventListener('click', addEntry);
  $('#amountInput').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); addEntry(); }
  });
  $('#noteInput').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); addEntry(); }
  });

  /* detay */
  document.addEventListener('click', function (ev) {
    const item = ev.target.closest('[data-entry]');
    if (item) { openSheet(item.dataset.entry); return; }

    if (ev.target.closest('[data-close]')) closeSheet();
  });

  /* ay gezinmesi */
  $('#prevMonth').addEventListener('click', function () {
    histMonth = shiftMonth(histMonth, -1);
    renderHistory();
  });
  $('#nextMonth').addEventListener('click', function () {
    if (histMonth >= currentMonthKey()) return;
    histMonth = shiftMonth(histMonth, 1);
    renderHistory();
  });

  /* hesap ekle */
  $('#accForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    addAccount();
  });

  /* hesap bakiyesi düzenle */
  $('#accSettings').addEventListener('change', function (ev) {
    const input = ev.target.closest('[data-acc-balance]');
    if (!input) return;

    const acc = findAccount(input.dataset.accBalance);
    if (!acc) return;

    const value = parseAmount(input.value);
    let balance = value == null ? 0 : round2(value);
    if (acc.kind === 'card') balance = Math.max(0, balance);

    acc.balance = balance;
    saveState();
    render();
  });

  /* hesap sil */
  $('#accSettings').addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-acc-del]');
    if (!btn) return;
    deleteAccount(btn.dataset.accDel);
  });

  /* tema */
  $('#themeSeg').addEventListener('click', function (ev) {
    const btn = ev.target.closest('[data-theme-value]');
    if (!btn) return;
    state.theme = btn.dataset.themeValue;
    saveState();
    applyTheme();
    renderSettings();
  });

  /* yedekleme */
  $('#exportBtn').addEventListener('click', exportBackup);
  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (ev) {
    const input = ev.target;
    const file = input.files && input.files[0];
    if (file) importBackup(file);
    setTimeout(function () { input.value = ''; }, 1500);
  });

  /* sıfırlama */
  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm('Tüm hesap ve hareket kayıtları silinecek. Emin misin?')) return;
    state = defaultState();
    saveState();
    applyTheme();
    histMonth = currentMonthKey();
    buildAccountSelect();
    render();
    toast('Tüm veriler silindi');
  });

  /* detay düğmeleri */
  $('#sheetSave').addEventListener('click', function () {
    if (!editingId) return;

    const entry = findEntry(editingId);
    if (!entry) { closeSheet(); return; }

    const amount = parseAmount($('#sheetAmount').value);
    if (amount == null || amount <= 0) {
      toast('Geçerli bir tutar gir.');
      return;
    }

    adjustEntryAmount(entry, amount);

    if (entry.type === 'expense') {
      entry.cat = $('#sheetCat').value;
    }
    entry.note = $('#sheetNote').value.trim().slice(0, 80);

    saveState();
    render();
    closeSheet();
    toast('Güncellendi');
  });

  $('#sheetDelete').addEventListener('click', function () {
    if (!editingId) return;
    const id = editingId;
    closeSheet();
    deleteEntry(id);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet();
  });

  /* gün değişince ekranı tazele */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });
}

function init() {
  buildChips();
  buildSheetCategories();
  buildAccountSelect();
  setType('expense');
  bindEvents();
  applyTheme();
  showView('today');
  render();
}

init();
