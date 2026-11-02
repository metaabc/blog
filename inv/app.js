'use strict';
/* =========================================================
   倉位台 — 前端
   ========================================================= */

const S = {
  watchlist: [],
  trades: [],
  notes: {},
  settings: { refreshSec: 90 },
  quotes: {},
  fx: { USDHKD: 7.85 },
  lastUpdate: null,
  loading: false,
  tab: 'brief',
  sort: { key: 'symbol', dir: 1 },
  suggest: [],
  sugIdx: -1,
  detail: { symbol: null, data: null, range: '1y', loading: false, error: null },
  brief: { data: null, at: 0, loading: false, error: null, holdNews: null, holdKey: '', holdAt: 0, holdPartial: false },
  timer: null,
  clockTimer: null,
  /* 可用性 / 容錯狀態 */
  net: { state: 'ok', msg: '', at: 0 },
  qErrors: [],
  qPartial: false,
  noteDraft: {},
  lastFailAt: 0,
};

/* ---------------- 工具 ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 外部連結一律先過濾協議：只放行 http(s)、協議相對(//)、相對路徑、mailto、tel；
// 其餘（javascript:、data:、vbscript:、blob:、file: …）一律擋下，避免抓取到的網頁內容被當成程式碼執行。
const safeUrl = (u) => {
  const s = String(u == null ? '' : u).trim();
  if (!s || s === '#') return '#';
  return /^(https?:\/\/|\/\/|\/|mailto:|tel:)/i.test(s) ? s : '#';
};

function fmt(v, d) {
  if (v == null || !isFinite(v)) return '—';
  const dd = d == null ? 2 : d;
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd });
}
function fmtPrice(v) {
  if (v == null || !isFinite(v)) return '—';
  if (Math.abs(v) < 1) return fmt(v, 4);
  if (Math.abs(v) < 10) return fmt(v, 3);
  return fmt(v, 2);
}
function pct(v, d) {
  if (v == null || !isFinite(v)) return '—';
  const dd = d == null ? 2 : d;
  return (v > 0 ? '+' : '') + (v * 100).toFixed(dd) + '%';
}
function pctPlain(v, d) {
  if (v == null || !isFinite(v)) return '—';
  return (v * 100).toFixed(d == null ? 2 : d) + '%';
}
function cls(v) {
  if (v == null || !isFinite(v) || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}
function money(v, ccy, d) {
  if (v == null || !isFinite(v)) return '—';
  const sym = ccy === 'HKD' ? 'HK$' : ccy === 'USD' ? 'US$' : '';
  return sym + fmt(v, d == null ? 2 : d);
}
/* 帶正負號的金額，負號置於貨幣符號之前：-HK$1,227 */
function signedMoney(v, ccy, d) {
  if (v == null || !isFinite(v)) return '—';
  const sign = v > 0.004 ? '+' : v < -0.004 ? '-' : '';
  return sign + money(Math.abs(v), ccy, d);
}
function bigMoney(v, ccy) {
  if (v == null || !isFinite(v)) return '—';
  const sym = ccy === 'HKD' ? 'HK$' : ccy === 'USD' ? 'US$' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return sym + (v / 1e12).toFixed(2) + '兆';
  if (a >= 1e8) return sym + (v / 1e8).toFixed(2) + '億';
  if (a >= 1e4) return sym + (v / 1e4).toFixed(1) + '萬';
  return sym + fmt(v, 0);
}
function toHKD(v, ccy) {
  if (v == null || !isFinite(v)) return 0;
  if (ccy === 'HKD') return v;
  if (ccy === 'USD') return v * S.fx.USDHKD;
  return v;
}
function dstr(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '剛剛';
  if (s < 3600) return Math.floor(s / 60) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  return Math.floor(s / 86400) + ' 天前';
}
function riskColor(score) {
  if (score == null) return '#8c96a6';
  if (score < 25) return '#0f9d63';
  if (score < 45) return '#65a30d';
  if (score < 60) return '#d97706';
  if (score < 75) return '#ea580c';
  return '#dc2626';
}
function riskBadge(risk) {
  if (!risk) return '<span class="badge lv-中"><i class="bdot"></i>—</span>';
  return (
    '<span class="badge lv-' + risk.level + '" title="風險分數 ' + risk.score + '／100"><i class="bdot"></i>' +
    risk.level + ' ' + risk.score + '</span>'
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Toast：可堆疊、可點擊關閉 ---------------- */
function toast(msg, isErr) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = String(msg);
  el.title = '點擊關閉';
  host.appendChild(el);
  while (host.children.length > 3) host.removeChild(host.firstChild);
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  el.onclick = remove;
  setTimeout(remove, isErr ? 5200 : 2800);
}

/* ---------------- 連線狀態 ---------------- */
function setNet(state, msg) {
  const prev = S.net.state;
  const changed = prev !== state;
  S.net.state = state;
  S.net.msg = msg || '';
  S.net.at = Date.now();
  const el = $('#linkState');
  if (el) {
    el.className = 'link-state ' + state;
    el.textContent = state === 'ok' ? '已連線' : state === 'offline' ? '離線' : state === 'error' ? '連線異常' : '同步中';
    el.title = msg || (state === 'ok' ? '與本機服務連線正常' : '');
  }
  if (changed) {
    if (state === 'ok' && (prev === 'offline' || prev === 'error')) toast('已恢復連線');
    updateBanner();
  }
}

/** 統一的 API 呼叫：逾時、單次重試、友善錯誤訊息 */
async function api(path, opts) {
  const o = opts || {};
  const method = (o.method || 'GET').toUpperCase();
  const retries = o.retry == null ? (method === 'GET' ? 1 : 0) : o.retry;
  const timeout = o.timeout || 30000;
  let lastErr = null;

  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(path, {
        method,
        body: o.body,
        headers: Object.assign({ 'content-type': 'application/json' }, o.headers || {}),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const txt = await res.text();
      let j = {};
      try {
        j = txt ? JSON.parse(txt) : {};
      } catch (e) {
        j = {};
      }
      if (!res.ok) {
        const err = new Error(j.error || '伺服器回應 ' + res.status);
        err.status = res.status;
        throw err;
      }
      setNet('ok');
      return j;
    } catch (e) {
      clearTimeout(timer);
      const aborted = e.name === 'AbortError';
      const networkDown = !e.status;
      const err = aborted
        ? new Error('請求逾時（' + Math.round(timeout / 1000) + ' 秒）')
        : networkDown
        ? new Error(navigator.onLine === false ? '目前離線，請恢復網絡後重試' : '無法連線到本機服務')
        : e;
      lastErr = err;
      const canRetry = i < retries && (aborted || networkDown || e.status >= 500 || e.status === 429);
      if (canRetry) {
        setNet('sync');
        await sleep(600 + i * 800);
        continue;
      }
      if (networkDown) setNet(navigator.onLine === false ? 'offline' : 'error', err.message);
      else if (e.status >= 500) setNet('error', e.message);
      throw err;
    }
  }
  throw lastErr || new Error('請求失敗');
}

/* ---------------- 全域提示條 ---------------- */
function updateBanner() {
  const box = $('#netBanner');
  if (!box) return;
  const sec = Math.max(30, Number(S.settings.refreshSec) || 90);
  const age = S.lastUpdate ? (Date.now() - S.lastUpdate) / 1000 : null;
  const staleSyms = Object.keys(S.quotes).filter((k) => S.quotes[k] && S.quotes[k].stale);
  let kind = '';
  let text = '';
  let retry = false;

  if (S.net.state === 'offline') {
    kind = 'warn';
    text = '目前離線，畫面顯示的是最後一次成功抓取的資料。';
  } else if (S.net.state === 'error') {
    kind = 'err';
    text = '與本機服務的連線中斷：' + (S.net.msg || '未知原因') + '。資料可能不是最新。';
    retry = true;
  } else if (S.qErrors.length && S.qPartial) {
    kind = 'warn';
    const names = S.qErrors.slice(0, 3).map((e) => e.symbol).join('、');
    text =
      '部分標的更新失敗（' + names + (S.qErrors.length > 3 ? ' 等 ' + S.qErrors.length + ' 檔' : '') +
      '），已顯示最後一次成功的價格。';
    retry = true;
  } else if (staleSyms.length) {
    kind = 'warn';
    text =
      staleSyms.length + ' 檔標的暫時取不到最新價（' + staleSyms.slice(0, 3).join('、') +
      (staleSyms.length > 3 ? ' 等' : '') + '），表內已標示「舊」字。';
    retry = true;
  } else if (age != null && age > sec * 3) {
    kind = 'warn';
    text = '資料已 ' + Math.round(age / 60) + ' 分鐘未更新，可能已過時。';
    retry = true;
  }

  if (!kind) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.className = 'net-banner ' + kind;
  box.innerHTML =
    '<span class="nb-dot"></span><span class="nb-text">' + esc(text) + '</span>' +
    (retry ? '<button class="nb-btn" id="nbRetry">立即重試</button>' : '');
  const btn = $('#nbRetry');
  if (btn) btn.onclick = () => refreshQuotes(false);
}

/* ---------------- 持倉計算（移動平均成本法） ---------------- */
function computePositions() {
  const map = {};
  const sorted = [...S.trades].sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date));
    return d !== 0 ? d : (a.createdAt || 0) - (b.createdAt || 0);
  });
  const rows = [];
  for (const t of sorted) {
    const sym = t.symbol;
    const p = map[sym] || (map[sym] = { symbol: sym, qty: 0, avg: 0, cost: 0, realized: 0, buyQty: 0, buyCost: 0, sellQty: 0 });
    const amt = t.qty * t.price;
    let realized = null;
    if (t.side === 'buy') {
      p.cost += amt + (t.fee || 0);
      p.qty += t.qty;
      p.buyQty += t.qty;
      p.buyCost += amt + (t.fee || 0);
      p.avg = p.qty > 0 ? p.cost / p.qty : 0;
    } else {
      realized = (t.price - p.avg) * t.qty - (t.fee || 0);
      p.realized += realized;
      p.qty -= t.qty;
      p.sellQty += t.qty;
      p.cost = p.qty > 0 ? p.avg * p.qty : 0;
      if (p.qty < 0) { p.qty = 0; p.cost = 0; }
    }
    rows.push({ trade: t, realized });
  }
  return { positions: map, rows };
}

function quoteOf(sym) {
  return S.quotes[sym] || null;
}

/* ---------------- 組合彙總 ---------------- */
function portfolioStats() {
  const { positions } = computePositions();
  let mv = 0, cost = 0, dayPL = 0, div = 0, realized = 0;
  const items = [];
  for (const sym in positions) {
    const p = positions[sym];
    const q = quoteOf(sym);
    const ccy = q ? q.currency : sym.endsWith('.HK') ? 'HKD' : 'USD';
    realized += toHKD(p.realized, ccy);
    if (p.qty <= 0) continue;
    const px = q && q.price != null ? q.price : p.avg;
    const value = p.qty * px;
    const c = p.qty * p.avg;
    mv += toHKD(value, ccy);
    cost += toHKD(c, ccy);
    if (q && q.prevClose) dayPL += toHKD((px - q.prevClose) * p.qty, ccy);
    if (q && q.divTtm) div += toHKD(q.divTtm * p.qty, ccy);
    items.push({ sym, p, q, ccy, px, value, cost: c });
  }
  for (const it of items) it.weight = mv > 0 ? toHKD(it.value, it.ccy) / mv : 0;
  return { mv, cost, dayPL, div, realized, items, unrealized: mv - cost };
}

/* =========================================================
   渲染
   ========================================================= */
function renderAll() {
  renderKPIs();
  renderPositions();
  renderAlloc();
  renderRealized();
  renderWatch();
  renderTrades();
  renderRisk();
  fillDatalist();
  if (S.brief.data) renderBrief();
  updateBanner();
}

/** 舊資料標記：上游取不到時仍顯示最後一次成功的價格 */
function staleTag(q) {
  if (!q || !q.stale) return '';
  const at = q.staleAt ? '（' + new Date(q.staleAt).toLocaleTimeString('zh-HK', { hour12: false }) + '）' : '';
  return '<span class="stale-tag" title="上游暫時無法更新' + at + '">舊</span>';
}

function renderKPIs() {
  const st = portfolioStats();
  const retPct = st.cost > 0 ? (st.mv - st.cost) / st.cost : null;
  const dayPct = st.mv - st.dayPL > 0 ? st.dayPL / (st.mv - st.dayPL) : null;
  const yieldPct = st.mv > 0 ? st.div / st.mv : 0;

  const cards = [
    {
      label: '組合市值',
      val: money(st.mv, 'HKD', 0),
      sub: '投入成本 ' + money(st.cost, 'HKD', 0),
      cls: '',
    },
    {
      label: '未實現盈虧',
      val: signedMoney(st.mv - st.cost, 'HKD', 0),
      sub: '回報率 ' + (retPct == null ? '—' : pct(retPct)),
      cls: cls(st.mv - st.cost),
    },
    {
      label: '今日盈虧',
      val: signedMoney(st.dayPL, 'HKD', 0),
      sub: '較前收市 ' + (dayPct == null ? '—' : pct(dayPct)),
      cls: cls(st.dayPL),
    },
    {
      label: '預估年股息',
      val: money(st.div, 'HKD', 0),
      sub: '組合收益率 ' + pctPlain(yieldPct),
      cls: '',
    },
    {
      label: '累計已實現',
      val: signedMoney(st.realized, 'HKD', 0),
      sub: '已沽出部分盈虧',
      cls: cls(st.realized),
    },
  ];

  $('#kpis').innerHTML = cards
    .map(
      (c) =>
        '<div class="kpi ' + c.cls + '"><div class="k-label">' + c.label +
        '</div><div class="k-val">' + esc(c.val) + '</div><div class="k-sub">' + esc(c.sub) + '</div></div>'
    )
    .join('');
}

function renderPositions() {
  const st = portfolioStats();
  const body = $('#posBody');
  const empty = $('#posEmpty');
  if (!st.items.length) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.innerHTML = st.items
    .sort((a, b) => b.value - a.value)
    .map((it) => {
      const q = it.q;
      const pl = it.value - it.cost;
      const plPct = it.cost > 0 ? pl / it.cost : null;
      return (
        '<tr class="clickable" data-sym="' + symAttr(it.sym) + '">' +
        '<td><div class="sym">' + esc(it.sym) + '<span class="mk-tag ' + (it.ccy === 'HKD' ? 'HK' : 'US') + '">' + (it.ccy === 'HKD' ? 'HK' : 'US') + '</span></div>' +
        '<div class="sym-name">' + esc(q ? q.name : '—') + '</div></td>' +
        '<td class="num">' + fmt(it.p.qty, 0) + '</td>' +
        '<td class="num">' + fmtPrice(it.p.avg) + '</td>' +
        '<td class="num">' + fmtPrice(it.px) + staleTag(q) + '</td>' +
        '<td class="num">' + money(it.value, it.ccy, 0) + '</td>' +
        '<td class="num ' + cls(pl) + '">' + signedMoney(pl, it.ccy, 0) +
        '<div style="font-size:10.5px;opacity:.8">' + (plPct == null ? '—' : pct(plPct)) + '</div></td>' +
        '<td class="num">' + pctPlain(it.weight, 1) + '</td>' +
        '<td class="num">' + riskBadge(q && q.risk) + '</td>' +
        '</tr>'
      );
    })
    .join('');
}
// 避免與 esc 混淆：sym 只含安全字元
function symAttr(s) { return String(s).replace(/[^A-Za-z0-9._\-^=]/g, ''); }

function renderAlloc() {
  const st = portfolioStats();
  const box = $('#allocBox');
  if (!st.items.length) {
    box.innerHTML = '<div class="empty">尚無持倉</div>';
    return;
  }
  const palette = ['#2b5ce6', '#4f8ef7', '#7c6cf0', '#0f9d63', '#e0a11b', '#d9622b', '#9b59b6', '#3aa6b9', '#c0392b', '#5d6d7e'];
  const sorted = [...st.items].sort((a, b) => b.weight - a.weight);
  let hk = 0, us = 0;
  for (const it of sorted) {
    const v = toHKD(it.value, it.ccy);
    if (it.ccy === 'HKD') hk += v; else us += v;
  }
  box.innerHTML =
    sorted
      .map((it, i) => {
        return (
          '<div class="alloc-row">' +
          '<span class="an">' + esc(it.sym) + '</span>' +
          '<span class="alloc-track"><i style="width:' + Math.max(2, it.weight * 100).toFixed(1) + '%;background:' + palette[i % palette.length] + '"></i></span>' +
          '<span class="av">' + pctPlain(it.weight, 1) + '</span>' +
          '</div>'
        );
      })
      .join('') +
    '<div class="alloc-legend"><span>港股 ' + pctPlain(st.mv ? hk / st.mv : 0, 1) + '</span>' +
    '<span>美股 ' + pctPlain(st.mv ? us / st.mv : 0, 1) + '</span>' +
    '<span>USD/HKD ' + fmt(S.fx.USDHKD, 4) + '</span></div>';
}

function renderRealized() {
  const { positions } = computePositions();
  const box = $('#realizedBox');
  const rows = Object.keys(positions)
    .map((sym) => {
      const q = quoteOf(sym);
      const ccy = q ? q.currency : sym.endsWith('.HK') ? 'HKD' : 'USD';
      return { sym, realized: positions[sym].realized, ccy };
    })
    .filter((r) => Math.abs(r.realized) > 0.005)
    .sort((a, b) => b.realized - a.realized);

  if (!rows.length) {
    box.innerHTML = '<div class="empty">還沒有沽出紀錄</div>';
    return;
  }
  const total = rows.reduce((a, r) => a + toHKD(r.realized, r.ccy), 0);
  box.innerHTML =
    rows
      .map(
        (r) =>
          '<div class="real-row"><span>' + esc(r.sym) + '</span><b class="' + cls(r.realized) + '">' +
          signedMoney(r.realized, r.ccy, 0) + '</b></div>'
      )
      .join('') +
    '<div class="real-row" style="border-top:1px solid var(--line);margin-top:4px;padding-top:9px"><span><b>合計（HKD 折算）</b></span><b class="' +
    cls(total) + '">' + signedMoney(total, 'HKD', 0) + '</b></div>';
}

function sortWatch(list) {
  const k = S.sort.key;
  const d = S.sort.dir;
  return list.sort((a, b) => {
    let av, bv;
    if (k === 'symbol') { av = a.symbol; bv = b.symbol; return av.localeCompare(bv) * d; }
    if (k === 'risk') { av = a.q && a.q.risk ? a.q.risk.score : -1; bv = b.q && b.q.risk ? b.q.risk.score : -1; }
    else { av = a.q ? a.q[k] : null; bv = b.q ? b.q[k] : null; }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * d;
  });
}

function renderWatch() {
  const list = sortWatch(
    S.watchlist.map((sym) => ({ symbol: sym, q: quoteOf(sym) }))
  );
  const body = $('#watchBody');
  const empty = $('#watchEmpty');
  if (!list.length) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  $$('#watchTable th.sortable').forEach((th) => {
    th.classList.remove('asc', 'desc');
    if (th.dataset.sort === S.sort.key) th.classList.add(S.sort.dir > 0 ? 'asc' : 'desc');
  });

  body.innerHTML = list
    .map((it) => {
      const q = it.q;
      if (!q) {
        return (
          '<tr class="clickable" data-sym="' + symAttr(it.symbol) + '">' +
          '<td><div class="sym">' + esc(it.symbol) + '</div><div class="sym-name">載入中／暫無報價</div></td>' +
          '<td class="num">—</td><td class="num">—</td><td class="range-cell">—</td>' +
          '<td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>' +
          '<td><button class="icon-x" data-del="' + symAttr(it.symbol) + '" title="移除">✕</button></td></tr>'
        );
      }
      const pos = q.w52Pos;
      const rangeHtml =
        '<div class="r52"><span class="fill" style="width:' + Math.max(0, Math.min(100, pos == null ? 0 : pos)).toFixed(1) + '%"></span>' +
        (pos == null ? '' : '<span class="pin" style="left:' + Math.max(0, Math.min(100, pos)).toFixed(1) + '%"></span>') + '</div>' +
        '<div class="r52-lb"><span>' + fmtPrice(q.w52Low) + '</span><span>' + fmtPrice(q.w52High) + '</span></div>';

      return (
        '<tr class="clickable" data-sym="' + symAttr(it.symbol) + '">' +
        '<td><div class="sym">' + esc(it.symbol) + '<span class="mk-tag ' + q.market + '">' + q.market + '</span></div>' +
        '<div class="sym-name" title="' + esc(q.name) + '">' + esc(q.name) + '</div></td>' +
        '<td class="num"><b>' + fmtPrice(q.price) + '</b>' + staleTag(q) +
        '<div style="font-size:10px;color:var(--ink3)">' + q.currency + '</div></td>' +
        '<td class="num ' + cls(q.changePct) + '">' + pct(q.changePct) + '</td>' +
        '<td class="range-cell">' + rangeHtml + '</td>' +
        '<td class="num">' + (q.pe == null ? '—' : fmt(q.pe, 1)) + '</td>' +
        '<td class="num">' + (q.divTtm ? fmt(q.divTtm, 3) : '—') +
        (q.divCount1y ? '<div style="font-size:10px;color:var(--ink3)">' + q.divCount1y + ' 次</div>' : '') + '</td>' +
        '<td class="num ' + (q.yieldTtm > 0.04 ? 'up' : '') + '">' + (q.yieldTtm ? pctPlain(q.yieldTtm) : '—') + '</td>' +
        '<td class="num">' + riskBadge(q.risk) + '</td>' +
        '<td><button class="icon-x" data-del="' + symAttr(it.symbol) + '" title="從清單移除">✕</button></td>' +
        '</tr>'
      );
    })
    .join('');
}

function renderTrades() {
  const { rows } = computePositions();
  const body = $('#tradeBody');
  const empty = $('#tradeEmpty');
  $('#tradeCount').textContent = S.trades.length ? '共 ' + S.trades.length + ' 筆' : '';
  if (!rows.length) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.innerHTML = rows
    .slice()
    .reverse()
    .map((r) => {
      const t = r.trade;
      const q = quoteOf(t.symbol);
      const ccy = q ? q.currency : t.symbol.endsWith('.HK') ? 'HKD' : 'USD';
      return (
        '<tr>' +
        '<td style="font-family:var(--num);font-size:12px">' + esc(t.date) + '</td>' +
        '<td><span class="sym">' + esc(t.symbol) + '</span></td>' +
        '<td><span class="side-tag ' + t.side + '">' + (t.side === 'buy' ? '買入' : '賣出') + '</span></td>' +
        '<td class="num">' + fmt(t.qty, 0) + '</td>' +
        '<td class="num">' + fmtPrice(t.price) + '</td>' +
        '<td class="num">' + fmt(t.fee || 0, 2) + '</td>' +
        '<td class="num">' + money(t.qty * t.price, ccy, 2) + '</td>' +
        '<td class="num ' + (r.realized == null ? '' : cls(r.realized)) + '">' +
        (r.realized == null ? '—' : signedMoney(r.realized, ccy, 2)) + '</td>' +
        '<td style="font-size:11.5px;color:var(--ink3);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.note || '') + '</td>' +
        '<td><button class="icon-x" data-deltrade="' + esc(t.id) + '" title="刪除">✕</button></td>' +
        '</tr>'
      );
    })
    .join('');
}

function renderRisk() {
  /* 使用者正在寫筆記時不要重繪這一區，否則每 90 秒的自動更新會清掉游標與未存的內容 */
  const ae = document.activeElement;
  if (ae && ae.tagName === 'TEXTAREA' && ae.dataset && ae.dataset.note) return;

  const st = portfolioStats();
  const box = $('#portRisk');
  const grid = $('#riskGrid');

  // 組合層面
  let wRisk = 0, wBeta = 0, wSum = 0, maxW = 0, maxSym = '', highRiskVal = 0;
  const sectorMap = {};
  for (const it of st.items) {
    const w = toHKD(it.value, it.ccy);
    wSum += w;
    if (it.q && it.q.risk) wRisk += it.q.risk.score * w;
    if (it.q && it.q.beta) wBeta += it.q.beta * w;
    if (it.weight > maxW) { maxW = it.weight; maxSym = it.sym; }
    if (it.q && it.q.risk && it.q.risk.score >= 60) highRiskVal += w;
    const sec = (it.q && it.q.sector) || '未分類';
    sectorMap[sec] = (sectorMap[sec] || 0) + w;
  }
  const sectors = Object.keys(sectorMap).map((k) => ({ k, v: sectorMap[k] })).sort((a, b) => b.v - a.v);
  const avgRisk = wSum > 0 ? wRisk / wSum : null;
  const avgBeta = wSum > 0 ? wBeta / wSum : null;
  const topSec = sectors[0];
  const topSecPct = topSec && wSum > 0 ? topSec.v / wSum : null;
  const hrPct = wSum > 0 ? highRiskVal / wSum : 0;

  const items = [
    {
      l: '組合加權風險',
      v: avgRisk == null ? '—' : Math.round(avgRisk) + ' / 100',
      d: avgRisk == null ? '需要持倉數據' : avgRisk < 45 ? '整體屬中低風險' : avgRisk < 60 ? '整體屬中等風險' : '整體風險偏高',
    },
    {
      l: '最大單一持倉',
      v: pctPlain(maxW, 1),
      d: maxSym ? maxSym + (maxW > 0.35 ? '（過度集中）' : '') : '—',
    },
    {
      l: '行業集中度',
      v: topSec ? pctPlain(topSecPct, 1) : '—',
      d: topSec ? topSec.k : '—',
    },
    {
      l: '高風險持倉佔比',
      v: pctPlain(hrPct, 1),
      d: '風險分數 ≥ 60 的市值比重',
    },
    {
      l: '組合 Beta',
      v: avgBeta == null ? '—' : fmt(avgBeta, 2),
      d: avgBeta == null ? '資料不足' : avgBeta > 1.2 ? '波幅高於大市' : avgBeta < 0.8 ? '波幅低於大市' : '與大市相若',
    },
  ];
  box.innerHTML = items
    .map(
      (i) =>
        '<div class="pr-item"><div class="pl">' + i.l + '</div><div class="pv">' + esc(i.v) +
        '</div><div class="pd">' + esc(i.d) + '</div></div>'
    )
    .join('');

  // 個股風險卡
  const list = S.watchlist.map((sym) => quoteOf(sym)).filter(Boolean).sort((a, b) => b.risk.score - a.risk.score);
  if (!list.length) {
    grid.innerHTML = '<div class="empty">先在觀察清單加入股票，這裡會顯示逐檔風險拆解。</div>';
    return;
  }
  grid.innerHTML = list
    .map((q) => {
      /* 有未送出的草稿就顯示草稿，避免自動更新把打到一半的字洗掉 */
      const saved = S.notes[q.symbol] ? S.notes[q.symbol].text : '';
      const note = S.noteDraft[q.symbol] != null ? S.noteDraft[q.symbol] : saved;
      const dirty = S.noteDraft[q.symbol] != null;
      const color = riskColor(q.risk.score);
      return (
        '<div class="risk-card" data-card="' + symAttr(q.symbol) + '">' +
        '<div class="rc-head">' +
        '<div class="rc-id"><div class="rc-title">' + esc(q.name) + ' <span class="mk-tag ' + q.market + '">' + q.market + '</span></div>' +
        '<div class="rc-sub">' + esc(q.symbol) + ' · ' + fmtPrice(q.price) + ' ' + q.currency +
        ' · 收益率 ' + (q.yieldTtm ? pctPlain(q.yieldTtm) : '—') + '</div></div>' +
        '<div class="rc-score"><div class="n" style="color:' + color + '">' + q.risk.score + '</div><div class="l">' + q.risk.level + '風險</div></div>' +
        '</div>' +
        '<div>' +
        q.risk.factors
          .map(
            (f) =>
              '<div class="factor"><span class="fl">' + f.label + '</span>' +
              '<span class="ft"><i style="width:' + ((f.pts / f.max) * 100).toFixed(0) + '%;background:' +
              (f.pts / f.max > 0.66 ? '#dc2626' : f.pts / f.max > 0.4 ? '#e0a11b' : '#2b5ce6') + '"></i></span>' +
              '<span class="fd" title="' + esc(f.detail) + '">' + esc(f.detail) + '</span></div>'
          )
          .join('') +
        '</div>' +
        '<div class="flags">' +
        q.risk.flags.map((f) => '<span class="flag ' + f.lv + '">' + esc(f.text) + '</span>').join('') +
        '</div>' +
        '<div class="note-box">' +
        '<textarea data-note="' + symAttr(q.symbol) + '" placeholder="記錄你的風險判斷、催化劑或退出條件…">' + esc(note) + '</textarea>' +
        '<div class="note-actions"><button class="btn ghost" data-savenote="' + symAttr(q.symbol) + '">儲存筆記</button>' +
        '<span class="saved" data-saved="' + symAttr(q.symbol) + '">' +
        (dirty ? '未儲存' : S.notes[q.symbol] ? '上次更新 ' + relTime(S.notes[q.symbol].updatedAt) : '') + '</span>' +
        '<button class="btn ghost" style="margin-left:auto" data-open="' + symAttr(q.symbol) + '">詳情 ›</button>' +
        '</div></div>' +
        '</div>'
      );
    })
    .join('');
}

function fillDatalist() {
  $('#symbolList').innerHTML = S.watchlist.map((s) => '<option value="' + esc(s) + '"></option>').join('');
}

/* =========================================================
   走勢圖
   ========================================================= */
function drawChart(container, series, high, low) {
  if (!series || series.length < 2) {
    container.innerHTML = '<div class="empty" style="margin:0">暫無足夠歷史數據</div>';
    return;
  }
  const W = 620, H = 226;
  const pad = { l: 8, r: 52, t: 14, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const vals = series.map((d) => d[1]);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (high != null) mx = Math.max(mx, high);
  if (low != null) mn = Math.min(mn, low);
  const span = mx - mn || mx * 0.1 || 1;
  mn -= span * 0.06;
  mx += span * 0.06;

  const x = (i) => pad.l + (i / (series.length - 1)) * iw;
  const y = (v) => pad.t + (1 - (v - mn) / (mx - mn)) * ih;

  const up = vals[vals.length - 1] >= vals[0];
  const stroke = up ? '#d92b2b' : '#0f9d63';
  const fillA = up ? 'rgba(217,43,43,.14)' : 'rgba(15,157,99,.14)';

  let line = '';
  series.forEach((d, i) => {
    line += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(d[1]).toFixed(1) + ' ';
  });
  const area = line + 'L' + x(series.length - 1).toFixed(1) + ' ' + (pad.t + ih) + ' L' + pad.l + ' ' + (pad.t + ih) + ' Z';

  // 水平格線
  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const v = mn + ((mx - mn) * g) / 3;
    const yy = y(v).toFixed(1);
    grid += '<line x1="' + pad.l + '" y1="' + yy + '" x2="' + (W - pad.r) + '" y2="' + yy + '" stroke="#eef1f6" stroke-width="1"/>';
    grid += '<text x="' + (W - pad.r + 6) + '" y="' + (Number(yy) + 3.5) + '" font-size="9.5" fill="#8c96a6" font-family="ui-monospace,monospace">' + fmtPrice(v) + '</text>';
  }

  // 52 週高低線
  let markers = '';
  if (high != null && high <= mx && high >= mn) {
    markers += '<line x1="' + pad.l + '" y1="' + y(high).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y(high).toFixed(1) + '" stroke="#c7d2e4" stroke-width="1" stroke-dasharray="4 4"/>';
    markers += '<text x="' + (pad.l + 4) + '" y="' + (y(high) - 4).toFixed(1) + '" font-size="9" fill="#8c96a6">52 週高</text>';
  }
  if (low != null && low <= mx && low >= mn) {
    markers += '<line x1="' + pad.l + '" y1="' + y(low).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y(low).toFixed(1) + '" stroke="#c7d2e4" stroke-width="1" stroke-dasharray="4 4"/>';
    markers += '<text x="' + (pad.l + 4) + '" y="' + (y(low) + 11).toFixed(1) + '" font-size="9" fill="#8c96a6">52 週低</text>';
  }

  // x 軸日期
  const fmtD = (ts) => {
    const d = new Date(ts);
    return d.getFullYear().toString().slice(2) + '/' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const xi = [0, Math.floor(series.length / 2), series.length - 1];
  const xlabels = xi
    .map((i) => '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" font-size="9.5" fill="#8c96a6" text-anchor="' + (i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle') + '">' + fmtD(series[i][0]) + '</text>')
    .join('');

  const lastX = x(series.length - 1), lastY = y(vals[vals.length - 1]);

  container.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" style="display:block">' +
    '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + stroke + '" stop-opacity="0.26"/>' +
    '<stop offset="100%" stop-color="' + stroke + '" stop-opacity="0.01"/></linearGradient></defs>' +
    grid + markers +
    '<path d="' + area + '" fill="url(#ga)"/>' +
    '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="3" fill="#fff" stroke="' + stroke + '" stroke-width="2"/>' +
    '<g id="hgroup" style="display:none"><line id="hline" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3"/>' +
    '<circle id="hdot" r="3.5" fill="' + stroke + '" stroke="#fff" stroke-width="1.5"/></g>' +
    xlabels +
    '<rect id="hover" x="' + pad.l + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent" style="cursor:crosshair"/>' +
    '</svg>' +
    '<div class="chart-tip" id="ctip"></div>';

  const svg = container.querySelector('svg');
  const tip = container.querySelector('#ctip');
  const hgroup = container.querySelector('#hgroup');
  const hline = container.querySelector('#hline');
  const hdot = container.querySelector('#hdot');
  const hover = container.querySelector('#hover');

  function move(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const ratio = Math.max(0, Math.min(1, (px - pad.l) / iw));
    const idx = Math.round(ratio * (series.length - 1));
    const d = series[idx];
    if (!d) return;
    const pxX = x(idx), pxY = y(d[1]);
    hgroup.style.display = '';
    hline.setAttribute('x1', pxX);
    hline.setAttribute('x2', pxX);
    hdot.setAttribute('cx', pxX);
    hdot.setAttribute('cy', pxY);
    tip.style.display = 'block';
    tip.innerHTML = dstr(d[0]) + '<br>' + fmtPrice(d[1]);
    const leftPct = (pxX / W) * r.width;
    tip.style.left = Math.min(r.width - 60, Math.max(40, leftPct)) + 'px';
    tip.style.top = (pxY / H) * r.height + 'px';
  }
  function leave() {
    hgroup.style.display = 'none';
    tip.style.display = 'none';
  }
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', leave);
  hover.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
}

/* =========================================================
   詳情抽屜
   ========================================================= */
let drawerFocus = null;

function openDrawer(sym) {
  if (!sym) return;
  drawerFocus = document.activeElement;
  S.detail = { symbol: sym, data: null, range: '1y', loading: true, error: null };
  const box = $('#drawer');
  box.hidden = false;
  box.setAttribute('aria-hidden', 'false');
  $('#drawerMask').hidden = false;
  document.body.classList.add('drawer-open');
  setTimeout(() => {
    const b = $('#drawerClose');
    if (b) b.focus();
  }, 40);
  renderDrawer();
  loadDetail(sym);
}

function loadDetail(sym) {
  api('/api/detail?symbol=' + encodeURIComponent(sym), { timeout: 45000 })
    .then((d) => {
      if (S.detail.symbol !== sym) return;
      S.detail.data = d;
      S.detail.loading = false;
      if (d.quote) S.quotes[sym] = d.quote;
      renderDrawer();
    })
    .catch((e) => {
      if (S.detail.symbol !== sym) return;
      S.detail.loading = false;
      S.detail.error = e.message;
      renderDrawer();
    });
}

function closeDrawer() {
  const box = $('#drawer');
  if (box.hidden) return;
  box.hidden = true;
  box.setAttribute('aria-hidden', 'true');
  $('#drawerMask').hidden = true;
  document.body.classList.remove('drawer-open');
  S.detail = { symbol: null, data: null, range: '1y', loading: false, error: null };
  /* 把焦點還回原本那一列，鍵盤操作才不會迷失 */
  if (drawerFocus && drawerFocus.isConnected && drawerFocus.focus) {
    try {
      drawerFocus.focus({ preventScroll: true });
    } catch (e) {
      /* 忽略 */
    }
  }
  drawerFocus = null;
}

function renderDrawer() {
  const sym = S.detail.symbol;
  if (!sym) return;
  const q = (S.detail.data && S.detail.data.quote) || quoteOf(sym);
  const title = $('#drawerTitle');

  if (!q) {
    title.innerHTML = '<h3>' + esc(sym) + '</h3><div class="dh-sub">載入中…</div>';
    $('#drawerBody').innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:12px"></div><div class="skeleton" style="height:200px"></div>';
    return;
  }

  const d = S.detail.data;
  title.innerHTML =
    '<h3>' + esc(q.name) + '</h3>' +
    '<div class="dh-sub">' + esc(q.symbol) + ' · ' + esc(q.exchange || q.market) + ' · ' + q.currency + '</div>';

  const changeTxt = q.changePct == null ? '—' : pct(q.changePct);
  const chgAbs = q.prevClose != null ? q.price - q.prevClose : null;

  let html = '';
  html +=
    '<div class="dprice"><span class="p">' + fmtPrice(q.price) + '</span>' +
    '<span class="c ' + cls(q.changePct) + '">' + (chgAbs != null ? (chgAbs >= 0 ? '+' : '') + fmtPrice(chgAbs) + ' ' : '') + changeTxt + '</span>' +
    '<span class="meta">更新 ' + relTime(q.updatedAt) + (q.stale ? ' · 舊資料' : '') + '</span></div>';

  /* 快捷操作：看到一檔標的通常接下來就是加清單或記一筆 */
  html += '<div class="d-actions">' +
    (S.watchlist.includes(sym) ? '' : '<button class="btn primary" data-addwatch="' + symAttr(sym) + '">加入觀察清單</button>') +
    '<button class="btn" data-addtrade="' + symAttr(sym) + '">記錄一筆交易</button>' +
    (q.stale ? '<span class="stale-note">上游暫未回應，顯示最後一次成功的資料</span>' : '') +
    '</div>';

  // 走勢圖
  html += '<div class="chart-box" style="margin-top:12px"><div class="chart-tabs">' +
    '<button data-range="1y" class="' + (S.detail.range === '1y' ? 'on' : '') + '">近一年</button>' +
    '<button data-range="3y" class="' + (S.detail.range === '3y' ? 'on' : '') + '">近三年</button></div>' +
    '<div id="chartHost"></div></div>';

  // 關鍵數據
  const kv = [
    ['52 週高', fmtPrice(q.w52High)],
    ['52 週低', fmtPrice(q.w52Low)],
    ['市盈率 (TTM)', q.pe == null ? '—' : fmt(q.pe, 1)],
    ['前瞻市盈率', q.forwardPE == null ? '—' : fmt(q.forwardPE, 1)],
    ['市帳率', q.pb == null ? '—' : fmt(q.pb, 2)],
    ['每股盈利', q.eps == null ? '—' : fmtPrice(q.eps)],
    ['市值', bigMoney(q.marketCap, q.currency)],
    ['Beta', q.beta == null ? '—' : fmt(q.beta, 2)],
    ['近 12 月派息', q.divTtm ? fmt(q.divTtm, 3) : '—'],
    ['收益率', q.yieldTtm ? pctPlain(q.yieldTtm) : '—'],
    ['派息比率', q.payoutRatio == null ? '—' : pctPlain(q.payoutRatio, 1)],
    ['除息日', q.exDivDate ? dstr(q.exDivDate) : '—'],
  ];
  html += '<div class="sec-title">關鍵數據</div><div class="kv">' +
    kv.map((p) => '<div class="kv-item"><div class="k">' + p[0] + '</div><div class="v">' + esc(p[1]) + '</div></div>').join('') + '</div>';

  // 風險
  html += '<div class="sec-title">風險拆解 <span class="badge lv-' + q.risk.level + '" style="margin-left:4px"><i class="bdot"></i>' +
    q.risk.level + '風險 · ' + q.risk.score + ' 分</span></div>';
  html += '<div class="card" style="box-shadow:none;margin:0;padding:13px 14px">' +
    q.risk.factors.map((f) =>
      '<div class="factor" style="grid-template-columns:68px 1fr 130px;margin-bottom:6px"><span class="fl">' + f.label + '</span>' +
      '<span class="ft"><i style="width:' + ((f.pts / f.max) * 100).toFixed(0) + '%;background:' +
      (f.pts / f.max > 0.66 ? '#dc2626' : f.pts / f.max > 0.4 ? '#e0a11b' : '#2b5ce6') + '"></i></span>' +
      '<span class="fd">' + esc(f.detail) + '</span></div>'
    ).join('') +
    '<div class="flags" style="margin-top:10px">' +
    q.risk.flags.map((f) => '<span class="flag ' + f.lv + '">' + esc(f.text) + '</span>').join('') + '</div></div>';

  // 派息紀錄
  if (d) {
    if (d.annualDivs && d.annualDivs.length) {
      const mxA = Math.max(...d.annualDivs.map((a) => a.amount)) || 1;
      html += '<div class="sec-title">年度派息（每股）</div><div class="div-list">' +
        d.annualDivs.map((a) =>
          '<div class="div-row" style="grid-template-columns:60px 1fr 74px"><span class="dd">' + a.year + (a.partial ? '*' : '') + '</span>' +
          '<span class="div-bar"><i style="width:' + ((a.amount / mxA) * 100).toFixed(0) + '%"></i></span>' +
          '<span class="da" style="text-align:right">' + fmt(a.amount, 3) + '</span></div>'
        ).join('') + '</div>' +
        '<div style="font-size:11px;color:var(--ink3);margin-top:6px">' +
        (d.div3y ? '近三年累計 ' + fmt(d.div3y, 3) + ' ' + q.currency : '') +
        (d.yoyDiv != null ? ' · 近 12 個月派息較前 12 個月 ' + pct(d.yoyDiv, 1) : '') +
        (d.annualDivs.some((a) => a.partial) ? ' · * 本年度尚未完結' : '') + '</div>';
    } else {
      html += '<div class="sec-title">派息紀錄</div><div class="empty">過去三年無派息紀錄</div>';
    }

    if (d.series3y && d.series3y.length) { /* 圖表用 */ }

    // 新聞
    if (d.news && d.news.length) {
      html += '<div class="sec-title">相關新聞</div><div class="news-list">' +
        d.news.slice(0, 8).map((n) =>
          '<a class="news-item" href="' + safeUrl(n.link) + '" target="_blank" rel="noopener">' +
          '<div class="nt">' + esc(n.title) + '</div>' +
          '<div class="nm">' + esc(n.publisher || '') + ' · ' + relTime(n.at) + '</div></a>'
        ).join('') + '</div>';
    }

    // 公司簡介
    if (d.profile && d.profile.summary) {
      html += '<div class="sec-title">公司簡介</div><div class="profile"><div class="clamp">' + esc(d.profile.summary) + '</div>' +
        '<div style="margin-top:6px;font-size:11px;color:var(--ink3)">' +
        [d.profile.sector, d.profile.industry, d.profile.country].filter(Boolean).map(esc).join(' · ') + '</div></div>';
    }
  } else if (S.detail.loading) {
    html += '<div class="sec-title">更多資料</div><div class="skeleton" style="height:90px"></div>';
  } else if (S.detail.error) {
    html += '<div class="sec-title">更多資料</div>' +
      '<div class="statebox err"><div class="sb-title">詳細資料載入失敗</div>' +
      '<div class="sb-sub">' + esc(S.detail.error) + '</div>' +
      '<button class="btn primary" id="btnDetailRetry">重新載入</button></div>';
  }

  $('#drawerBody').innerHTML = html;

  const dr = $('#btnDetailRetry');
  if (dr) {
    dr.onclick = () => {
      if (S.detail.loading) return;
      S.detail.loading = true;
      S.detail.error = null;
      renderDrawer();
      loadDetail(sym);
    };
  }

  // 畫圖
  const host = $('#chartHost');
  if (host) {
    const series = S.detail.range === '3y' && d && d.series3y && d.series3y.length ? d.series3y : q.series;
    drawChart(host, series, q.w52High, q.w52Low);
  }

  $$('#drawerBody .chart-tabs button').forEach((b) => {
    b.onclick = () => {
      S.detail.range = b.dataset.range;
      renderDrawer();
    };
  });
}

/* =========================================================
   資料載入
   ========================================================= */
function allSymbols() {
  const set = new Set(S.watchlist);
  S.trades.forEach((t) => set.add(t.symbol));
  return [...set];
}

/* ---------------- 儲存層：伺服器優先，瀏覽器 localStorage 為退路 ----------------
 * 桌面版（exe / node server.js）走伺服器 /api/* 持久化；
 * 靜態部署（Cloudflare Pages / Vercel / Netlify）的 /api/state 會回傳 persist:'none'，
 * 此時自動切到 localStorage，觀察清單 / 交易 / 筆記 / 設定都存在瀏覽器本機。
 * 即便伺服器連不上，也會降級到 localStorage，讓畫面與過往資料仍可見。 */
let PERSIST = 'server';
const LS_KEY = 'stock-desk:v1';

function lsRead() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function lsWrite() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      watchlist: S.watchlist, trades: S.trades, notes: S.notes, settings: S.settings,
    }));
  } catch (e) {
    /* 隱私模式 / 配額滿 → 本工作階段仍在記憶體 */
  }
}

function localTradeValid(t) {
  return t && typeof t === 'object' && t.symbol && isFinite(Number(t.qty)) && Number(t.qty) > 0 && isFinite(Number(t.price)) && Number(t.price) > 0;
}
function localTradeNorm(t) {
  return {
    id: String(t.id || 't' + Math.random().toString(36).slice(2, 10)),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) ? t.date : new Date().toISOString().slice(0, 10),
    symbol: String(t.symbol).toUpperCase(),
    side: t.side === 'sell' ? 'sell' : 'buy',
    qty: Number(t.qty),
    price: Number(t.price),
    fee: Number(t.fee) || 0,
    note: String(t.note || ''),
    createdAt: Number(t.createdAt) || Date.now(),
  };
}
function localTradeFromForm(body) {
  return localTradeNorm(Object.assign({ id: 't' + Math.random().toString(36).slice(2, 10), createdAt: Date.now() }, body));
}
function applyLocal(d) {
  if (!d || typeof d !== 'object') return;
  if (Array.isArray(d.watchlist)) S.watchlist = d.watchlist.map(String).filter((x) => /^[\^A-Z0-9._=-]{1,20}$/.test(x));
  if (Array.isArray(d.trades)) S.trades = d.trades.filter(localTradeValid).map(localTradeNorm);
  if (d.notes && typeof d.notes === 'object') S.notes = d.notes;
  if (d.settings && typeof d.settings === 'object') S.settings = Object.assign({}, S.settings, d.settings);
}

async function loadState() {
  if (PERSIST === 'local') { applyLocal(lsRead()); return; }
  let st;
  try {
    st = await api('/api/state');
  } catch (e) {
    /* 連不上伺服器 → 降級本地：仍可看行情，只是資料存在瀏覽器 */
    PERSIST = 'local';
    applyLocal(lsRead());
    setNet('ok');
    return;
  }
  if (st.persist === 'none') {
    PERSIST = 'local';
    applyLocal(lsRead());
    return;
  }
  S.watchlist = (st.watchlist || []).filter(Boolean);
  S.trades = (st.trades || []).filter(Boolean);
  S.notes = st.notes || {};
  S.settings = st.settings || S.settings;
  if (st.fx && st.fx.USDHKD) S.fx = st.fx;
  if (st.storeWarning) setTimeout(() => toast(st.storeWarning, true), 800);
  lsWrite(); // 順手備份到本地，作為日後降級之用
}

async function refreshQuotes(quiet) {
  if (S.loading) return;
  if (navigator.onLine === false && quiet) return; // 離線時不空轉
  S.loading = true;
  const btn = $('#btnRefresh');
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }
  const t0 = Date.now();
  try {
    const syms = allSymbols();
    let got = 0;
    if (syms.length) {
      const r = await api('/api/quotes?symbols=' + encodeURIComponent(syms.join(',')), { timeout: 45000 });
      const qs = r.quotes || {};
      for (const k in qs) {
        S.quotes[k] = qs[k];
        got++;
      }
      if (r.fx) S.fx = r.fx;
      S.qErrors = r.errors || [];
      S.qPartial = !!r.partial;
      if (S.qErrors.length && !quiet) {
        const hard = S.qErrors.filter((e) => !e.stale);
        if (hard.length) toast('取不到行情：' + hard.map((e) => e.symbol).join('、'), true);
      }
    }
    if (got > 0 || !syms.length) {
      S.lastUpdate = Date.now();
      const el = $('#lastUpdated');
      if (el) el.textContent = new Date().toLocaleTimeString('zh-HK', { hour12: false });
    }
    renderAll();
    if (!$('#drawer').hidden && S.detail.symbol) renderDrawer();
    if (!quiet) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      toast(got ? '行情已更新 · ' + sec + ' 秒' : '沒有可更新的標的');
    }
  } catch (e) {
    S.lastFailAt = Date.now();
    /* 離線時橫幅已說明一切，不再重複彈提示 */
    if (!quiet && S.net.state !== 'offline') toast('更新失敗：' + e.message, true);
    if (S.net.state === 'offline' && !quiet) toast('目前離線，稍後會自動重試', true);
    updateBanner();
  } finally {
    S.loading = false;
    if (btn) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
    scheduleAuto();
  }
}

function scheduleAuto() {
  clearTimeout(S.timer);
  const sec = Math.max(30, Number(S.settings.refreshSec) || 90);
  const note = $('#autoNote');
  if (note) note.textContent = '· 每 ' + sec + ' 秒自動更新';
  S.timer = setTimeout(() => {
    /* 分頁在背景時不抓，省流量也避免無謂的上游壓力；切回來時會立即補一次 */
    if (document.hidden) return scheduleAuto();
    refreshQuotes(true);
  }, sec * 1000);
}

/* ---------------- 市場時鐘 ---------------- */
function tzNow(tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = f.formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { wd: get('weekday'), h: Number(get('hour')) % 24, m: Number(get('minute')) };
}
function hkOpen() {
  const t = tzNow('Asia/Hong_Kong');
  if (t.wd === 'Sat' || t.wd === 'Sun') return false;
  const mins = t.h * 60 + t.m;
  return (mins >= 570 && mins < 720) || (mins >= 780 && mins < 960);
}
function usOpen() {
  const t = tzNow('America/New_York');
  if (t.wd === 'Sat' || t.wd === 'Sun') return false;
  const mins = t.h * 60 + t.m;
  return mins >= 570 && mins < 960;
}
function renderClock() {
  const hk = tzNow('Asia/Hong_Kong');
  const us = tzNow('America/New_York');
  const mk = (name, open, t) =>
    '<span class="mkt"><i class="dot ' + (open ? 'open' : '') + '"></i>' + name + ' ' +
    (open ? '開市中' : '休市') + ' ' + String(t.h).padStart(2, '0') + ':' + String(t.m).padStart(2, '0') + '</span>';
  $('#mktClock').innerHTML = mk('港股', hkOpen(), hk) + mk('美股', usOpen(), us);
  updateBanner();
}

/* =========================================================
   互動
   ========================================================= */
const TAB_ORDER = ['brief', 'overview', 'watch', 'trades', 'risk'];

function switchTab(name, opts) {
  const btn = $('.tab[data-tab="' + name + '"]');
  const pane = $('#pane-' + name);
  if (!btn || !pane) return;
  $$('.tab').forEach((x) => {
    x.classList.remove('active');
    x.setAttribute('aria-selected', 'false');
  });
  $$('.pane').forEach((x) => x.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  pane.classList.add('active');
  S.tab = name;
  if (name === 'brief') loadBrief();
  if (!opts || !opts.noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindTabs() {
  $$('.tab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });
}

function bindBrief() {
  const host = $('#briefRoot');
  if (!host) return;
  host.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const el = e.target.closest('[data-sym]');
    if (el) openDrawer(el.dataset.sym);
  });
}

function bindWatch() {
  const input = $('#symInput');
  const sug = $('#symSuggest');
  let tmr = null;

  function hideSug() { sug.hidden = true; S.sugIdx = -1; }

  function renderSug() {
    if (!S.suggest.length) { hideSug(); return; }
    sug.innerHTML = S.suggest
      .map(
        (r, i) =>
          '<div class="suggest-item ' + (i === S.sugIdx ? 'on' : '') + '" data-sym="' + esc(r.symbol) + '">' +
          '<span class="si-sym">' + esc(r.symbol) + '</span>' +
          '<span class="si-name">' + esc(r.name) + '</span>' +
          '<span class="si-ex">' + esc(r.exchange || '') + '</span></div>'
      )
      .join('');
    sug.hidden = false;
    $$('.suggest-item', sug).forEach((el) => {
      el.onmousedown = (e) => { e.preventDefault(); addSymbol(el.dataset.sym); };
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(tmr);
    const v = input.value.trim();
    if (v.length < 1) { S.suggest = []; hideSug(); return; }
    tmr = setTimeout(async () => {
      try {
        const r = await api('/api/search?q=' + encodeURIComponent(v));
        S.suggest = r.results || [];
        S.sugIdx = -1;
        renderSug();
      } catch (e) { S.suggest = []; hideSug(); }
    }, 240);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !sug.hidden) {
      S.sugIdx = Math.min(S.suggest.length - 1, S.sugIdx + 1);
      renderSug();
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && !sug.hidden) {
      S.sugIdx = Math.max(0, S.sugIdx - 1);
      renderSug();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (S.sugIdx >= 0 && S.suggest[S.sugIdx]) addSymbol(S.suggest[S.sugIdx].symbol);
      else if (input.value.trim()) addSymbol(input.value.trim());
    } else if (e.key === 'Escape') hideSug();
  });

  input.addEventListener('blur', () => setTimeout(hideSug, 160));
  $('#btnAdd').onclick = () => { if (input.value.trim()) addSymbol(input.value.trim()); };

  $$('#watchTable th.sortable').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.sort;
      if (S.sort.key === k) S.sort.dir *= -1;
      else { S.sort.key = k; S.sort.dir = k === 'symbol' ? 1 : -1; }
      renderWatch();
    };
  });

  $('#watchTable').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      removeSymbol(del.dataset.del);
      return;
    }
    const tr = e.target.closest('tr[data-sym]');
    if (tr) openDrawer(tr.dataset.sym);
  });

  $('#posTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-sym]');
    if (tr) openDrawer(tr.dataset.sym);
  });

  $('#riskGrid').addEventListener('click', (e) => {
    const sv = e.target.closest('[data-savenote]');
    if (sv) {
      const sym = sv.dataset.savenote;
      const ta = $('#riskGrid textarea[data-note="' + sym + '"]');
      saveNote(sym, ta.value);
      return;
    }
    const op = e.target.closest('[data-open]');
    if (op) openDrawer(op.dataset.open);
  });

  /* 筆記草稿：輸入時即時記錄，任何重繪都不會洗掉內容 */
  $('#riskGrid').addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-note]');
    if (!ta) return;
    const sym = ta.dataset.note;
    const saved = S.notes[sym] ? S.notes[sym].text : '';
    const tip = $('[data-saved="' + sym + '"]');
    if (ta.value === saved) {
      delete S.noteDraft[sym];
      if (tip) tip.textContent = S.notes[sym] ? '上次更新 ' + relTime(S.notes[sym].updatedAt) : '';
    } else {
      S.noteDraft[sym] = ta.value;
      if (tip) tip.textContent = '未儲存';
    }
  });
}

async function addSymbol(sym) {
  const s = String(sym).trim().toUpperCase();
  if (!s) return;
  if (S.watchlist.includes(s)) { toast(s + ' 已在清單中'); return; }
  $('#symInput').value = '';
  $('#symSuggest').hidden = true;
  try {
    let r = { quote: null };
    if (PERSIST === 'server') r = await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ symbol: s }) });
    S.watchlist.push(s);
    lsWrite();
    if (r.quote) S.quotes[s] = r.quote;
    renderAll();
    S.brief.holdNews = null;
    loadHoldNews(true);
    toast('已加入 ' + s + (r.warning ? '（行情稍後更新）' : '') + (PERSIST === 'local' ? '（已存瀏覽器）' : ''));
    if (!r.quote) refreshQuotes(true);
  } catch (e) {
    toast('加入失敗：' + e.message, true);
  }
}

async function removeSymbol(sym) {
  try {
    if (PERSIST === 'server') await api('/api/watchlist?symbol=' + encodeURIComponent(sym), { method: 'DELETE' });
    S.watchlist = S.watchlist.filter((s) => s !== sym);
    lsWrite();
    renderAll();
    S.brief.holdNews = null;
    loadHoldNews(true);
    toast('已移除 ' + sym);
  } catch (e) {
    toast('移除失敗：' + e.message, true);
  }
}

async function saveNote(sym, text) {
  try {
    if (PERSIST === 'server') await api('/api/notes', { method: 'POST', body: JSON.stringify({ symbol: sym, text }) });
    if (text.trim()) S.notes[sym] = { text, updatedAt: Date.now() };
    else delete S.notes[sym];
    lsWrite();
    delete S.noteDraft[sym];
    const el = $('[data-saved="' + sym + '"]');
    if (el) el.textContent = '已儲存 · ' + new Date().toLocaleTimeString('zh-HK', { hour12: false });
    toast(PERSIST === 'local' ? '筆記已存瀏覽器' : '筆記已儲存');
  } catch (e) {
    /* 存檔失敗時保留草稿，避免內容消失 */
    S.noteDraft[sym] = text;
    const el = $('[data-saved="' + sym + '"]');
    if (el) el.textContent = '未儲存（' + e.message + '）';
    toast('筆記儲存失敗：' + e.message, true);
  }
}

function bindTrades() {
  const form = $('#tradeForm');
  form.date.value = new Date().toISOString().slice(0, 10);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      date: fd.get('date'),
      symbol: String(fd.get('symbol')).trim().toUpperCase(),
      side: fd.get('side'),
      qty: Number(fd.get('qty')),
      price: Number(fd.get('price')),
      fee: Number(fd.get('fee') || 0),
      note: fd.get('note'),
    };
    if (!body.symbol || !body.qty || !body.price) { toast('請完整填寫代號、股數與價格', true); return; }
    try {
      const r = PERSIST === 'server'
        ? await api('/api/trades', { method: 'POST', body: JSON.stringify(body) })
        : { trade: localTradeFromForm(body) };
      S.trades.push(r.trade);
      if (!S.watchlist.includes(body.symbol)) S.watchlist.push(body.symbol);
      lsWrite();
      renderAll();
      form.qty.value = '';
      form.price.value = '';
      form.fee.value = '0';
      form.note.value = '';
      toast('已記錄' + (body.side === 'buy' ? '買入' : '賣出'));
      if (!S.quotes[body.symbol]) refreshQuotes(true);
    } catch (err) {
      toast('記錄失敗：' + err.message, true);
    }
  });

  $('#tradeBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-deltrade]');
    if (!b) return;
    const id = b.dataset.deltrade;
    if (!confirm('刪除這筆交易紀錄？')) return;
    try {
      if (PERSIST === 'server') await api('/api/trades?id=' + encodeURIComponent(id), { method: 'DELETE' });
      S.trades = S.trades.filter((t) => t.id !== id);
      lsWrite();
      renderAll();
      toast('已刪除');
    } catch (err) {
      toast('刪除失敗：' + err.message, true);
    }
  });
}

function bindMisc() {
  $('#btnRefresh').onclick = () => refreshQuotes(false);
  $('#drawerClose').onclick = closeDrawer;
  $('#drawerMask').onclick = closeDrawer;

  /* 抽屜內的快捷操作 */
  const db = $('#drawerBody');
  if (db) {
    db.addEventListener('click', (e) => {
      const aw = e.target.closest('[data-addwatch]');
      if (aw) {
        const sym = aw.dataset.addwatch;
        closeDrawer();
        addSymbol(sym);
        return;
      }
      const at = e.target.closest('[data-addtrade]');
      if (at) {
        const sym = at.dataset.addtrade;
        const q = quoteOf(sym);
        closeDrawer();
        switchTab('trades');
        const form = $('#tradeForm');
        if (form) {
          form.symbol.value = sym;
          if (q && q.price) form.price.value = q.price;
          setTimeout(() => form.qty.focus(), 80);
        }
      }
    });
  }

  $('#btnExport').onclick = async () => {
    try {
      const data = PERSIST === 'server'
        ? await api('/api/export')
        : { exportedAt: new Date().toISOString(), version: '1.4.0', watchlist: S.watchlist, trades: S.trades, notes: S.notes, settings: S.settings };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'stock-desk-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已匯出備份');
    } catch (e) { toast('匯出失敗：' + e.message, true); }
  };

  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const data = JSON.parse(txt);
      if (PERSIST === 'server') {
        await api('/api/import', { method: 'POST', body: JSON.stringify(data) });
        await loadState();
      } else {
        applyLocal(data);
        lsWrite();
      }
      renderAll();
      await refreshQuotes(true);
      toast('已匯入備份');
    } catch (err) {
      toast('匯入失敗：' + err.message, true);
    }
    e.target.value = '';
  };

  $('#btnCsv').onclick = () => {
    const { rows } = computePositions();
    if (!rows.length) { toast('沒有交易可匯出', true); return; }
    const head = ['日期', '代號', '方向', '股數', '價格', '費用', '成交金額', '已實現盈虧', '備註'];
    const lines = rows.map((r) => {
      const t = r.trade;
      return [t.date, t.symbol, t.side === 'buy' ? '買入' : '賣出', t.qty, t.price, t.fee || 0,
        (t.qty * t.price).toFixed(2), r.realized == null ? '' : r.realized.toFixed(2), '"' + String(t.note || '').replace(/"/g, '""') + '"'].join(',');
    });
    const csv = '\uFEFF' + head.join(',') + '\n' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trades-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

/* ---------------- 全域事件：快捷鍵、連線狀態、分頁可見性 ---------------- */
function bindGlobal() {
  document.addEventListener('keydown', (e) => {
    const t = e.target || {};
    const tag = String(t.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;

    if (e.key === 'Escape' && !$('#drawer').hidden) {
      closeDrawer();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '/') {
      e.preventDefault();
      switchTab('watch');
      const i = $('#symInput');
      if (i) i.focus();
      return;
    }
    if (/^[1-5]$/.test(e.key)) switchTab(TAB_ORDER[Number(e.key) - 1]);
  });

  /* 抽屜開啟時把 Tab 焦點鎖在裡面 */
  $('#drawer').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('#drawer button, #drawer a[href], #drawer textarea, #drawer input, #drawer select')
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('online', () => {
    toast('網絡已恢復，正在更新…');
    refreshQuotes(true);
  });
  window.addEventListener('offline', () => {
    setNet('offline');
    toast('網絡已中斷，畫面停留在最後一次資料', true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const sec = Math.max(30, Number(S.settings.refreshSec) || 90);
    if (!S.lastUpdate || (Date.now() - S.lastUpdate) / 1000 > sec * 1.5) refreshQuotes(true);
    if (S.brief.data && Date.now() - S.brief.at > 5 * 60e3) loadBrief();
  });
}

/* =========================================================
   本週焦點
   ========================================================= */
const TAG_CLS = { 息口: 'rate', 政策: 'policy', 業績: 'earn', 資金流: 'flow', 風險: 'risk', 併購: 'ma', 科技: 'tech' };
const clamp = (v) => Math.max(0, Math.min(100, v == null || !isFinite(v) ? 0 : v));

function rsi14(series) {
  if (!series || series.length < 16) return null;
  const c = series.map((p) => p[1]);
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= 14; loss /= 14;
  for (let i = 15; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * 13 + Math.max(d, 0)) / 14;
    loss = (loss * 13 + Math.max(-d, 0)) / 14;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function sparkSvg(pts, dir) {
  if (!pts || pts.length < 2) return '';
  const v = pts.map((p) => p[1]);
  const min = Math.min(...v), max = Math.max(...v);
  const w = 78, h = 24, rng = max - min || 1;
  const d = v.map((x, i) => (i ? 'L' : 'M') + ((i / (v.length - 1)) * w).toFixed(1) + ' ' + (h - 2 - ((x - min) / rng) * (h - 4)).toFixed(1)).join(' ');
  const color = dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--ink3)';
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"/></svg>';
}

function briefCtx(B) {
  const mk = {};
  (B.macro || []).forEach((m) => { if (m && !m.error) mk[m.key] = m; });
  return {
    mk,
    us10: mk.us10y ? mk.us10y.price : null,
    us10W1bp: mk.us10y && mk.us10y.w1chg != null ? mk.us10y.w1chg * 100 : null,
    us30: mk.us30y ? mk.us30y.price : null,
    us13: mk.us13w ? mk.us13w.price : null,
    hsi: mk.hsi || null,
    hscei: mk.hscei || null,
    spx: mk.spx || null,
    ixic: mk.ixic || null,
    vix: mk.vix || null,
    usd: mk.usdhkd ? mk.usdhkd.price : S.fx.USDHKD,
    hibor: B.hibor || null,
    tone: B.tone || {},
  };
}

function macroCard(m) {
  if (!m) return '';
  if (m.error) {
    return '<div class="mc"><div class="mc-lb">' + esc(m.label || '') + '</div><div class="mc-v">—</div><div class="mc-sub">暫無數據</div></div>';
  }
  const rate = m.kind === 'yield';
  const val = rate || m.kind === 'index' || m.kind === 'commodity' ? fmt(m.price, rate ? 2 : m.price >= 1000 ? 0 : 2) : fmt(m.price, 3);
  const day = rate ? (m.chg != null ? m.chg * 100 : null) : m.chgPct;
  const wk = rate ? (m.w1chg != null ? m.w1chg * 100 : null) : m.w1pct;
  const dayTxt = day == null ? '—' : rate ? (day >= 0 ? '+' : '') + day.toFixed(1) + 'bp' : pct(day);
  const wkTxt = wk == null ? '' : rate ? (wk >= 0 ? '+' : '') + wk.toFixed(0) + 'bp / 週' : pct(wk, 1) + ' / 週';
  const dir = rate ? (day || 0) : (m.chgPct || 0);
  return '<div class="mc">' +
    '<div class="mc-lb">' + esc(m.label) + '</div>' +
    '<div class="mc-v">' + esc(val) + (rate ? '<small>%</small>' : '') + '</div>' +
    '<div class="mc-sub"><span class="' + cls(dir) + '">' + esc(dayTxt) + '</span><span class="mc-wk">' + esc(wkTxt) + '</span></div>' +
    sparkSvg(m.spark, dir) +
    '<div class="mc-foot">' + esc(m.note || '') + '</div>' +
    '</div>';
}

function hiborCard(h) {
  if (!h) return '<div class="mc"><div class="mc-lb">HIBOR 1 個月</div><div class="mc-v">—</div><div class="mc-sub">暫無數據</div></div>';
  return '<div class="mc mc-hib">' +
    '<div class="mc-lb">HIBOR 1 個月</div>' +
    '<div class="mc-v">' + fmt(h.m1, 2) + '<small>%</small></div>' +
    '<div class="mc-sub"><span class="flat">3 個月 ' + fmt(h.m3, 2) + '%</span></div>' +
    '<div class="mc-foot">' + esc((h.date || '') + ' ' + (h.time || '')) + '</div>' +
    '</div>';
}

/* 買點候選：低位 + 超賣 + 息差 + 低估值 */
function buildEntries(ctx) {
  const syms = [...new Set([].concat(S.watchlist, S.trades.map((t) => t.symbol)))];
  const out = [];
  for (const sym of syms) {
    const q = S.quotes[sym];
    if (!q || q.price == null) continue;
    const rsi = rsi14(q.series);
    const pos = q.w52Pos;
    const y = q.yieldTtm != null ? q.yieldTtm * 100 : null;
    const spread = y != null && ctx.us10 != null ? y - ctx.us10 : null;
    const reasons = [];
    let score = 0;
    if (pos != null && pos <= 20) { score += 2; reasons.push({ k: 'low', t: '52 週低位 ' + pos.toFixed(0) + '%' }); }
    else if (pos != null && pos <= 35) { score += 0.8; reasons.push({ k: 'low', t: '區間偏低 ' + pos.toFixed(0) + '%' }); }
    if (rsi != null && rsi <= 35) { score += 1.5; reasons.push({ k: 'tech', t: 'RSI ' + rsi.toFixed(0) + ' 超賣' }); }
    if (spread != null && spread >= 2) { score += 1.8; reasons.push({ k: 'yield', t: '息差 +' + spread.toFixed(1) + 'pt' }); }
    else if (spread != null && spread >= 0.5) { score += 0.9; reasons.push({ k: 'yield', t: '息差 +' + spread.toFixed(1) + 'pt' }); }
    if (q.pe != null && q.pe > 0 && q.pe <= 10) { score += 1.2; reasons.push({ k: 'value', t: 'PE ' + q.pe.toFixed(1) }); }
    else if (q.pe != null && q.pe > 0 && q.pe <= 14) { score += 0.6; reasons.push({ k: 'value', t: 'PE ' + q.pe.toFixed(1) }); }
    if (q.metrics && q.metrics.ret1y != null && q.metrics.ret1y <= -0.25) { score += 0.6; reasons.push({ k: 'fall', t: '一年 ' + pct(q.metrics.ret1y, 0) }); }
    if (q.risk && q.risk.score >= 62) score -= 1.2;
    out.push({ symbol: sym, q, rsi, pos, y, spread, score: Math.round(score * 10) / 10, reasons });
  }
  return out.filter((e) => e.score >= 1.5).sort((a, b) => b.score - a.score || (a.pos == null ? 99 : a.pos) - (b.pos == null ? 99 : b.pos)).slice(0, 6);
}

/* 追高 / 利率敏感等反向提示 */
function buildCautions(ctx) {
  const syms = [...new Set([].concat(S.watchlist, S.trades.map((t) => t.symbol)))];
  const out = [];
  const seen = new Set();
  for (const sym of syms) {
    const q = S.quotes[sym];
    if (!q || seen.has(sym)) continue;
    const rsi = rsi14(q.series);
    if (q.w52Pos != null && q.w52Pos >= 92) out.push({ symbol: sym, q, why: '貼近 52 週高位（' + q.w52Pos.toFixed(0) + '%），追高風險', k: 'high' });
    else if (rsi != null && rsi >= 72) out.push({ symbol: sym, q, why: 'RSI ' + rsi.toFixed(0) + '，短線過熱', k: 'hot' });
    else if (q.w52Pos != null && q.w52Pos <= 8 && q.metrics && q.metrics.ret1y != null && q.metrics.ret1y <= -0.25) out.push({ symbol: sym, q, why: '貼 52 週低位、一年 ' + pct(q.metrics.ret1y, 0) + '，跌勢未確認轉向', k: 'knife' });
    else if (q.pe != null && q.pe >= 45 && ctx.us10 != null && ctx.us10 >= 4.5) out.push({ symbol: sym, q, why: 'PE ' + q.pe.toFixed(0) + '，高估值遇美息 ' + ctx.us10.toFixed(1) + '%', k: 'val' });
    else if (q.beta != null && q.beta >= 1.6 && ctx.vix && ctx.vix.w1pct != null && ctx.vix.w1pct >= 0.15) out.push({ symbol: sym, q, why: 'Beta ' + q.beta.toFixed(1) + '，VIX 本週 ' + pct(ctx.vix.w1pct, 0), k: 'vol' });
    else if (q.divTtm === 0 && q.lastDivDate && Date.now() - q.lastDivDate > 400 * 864e5) out.push({ symbol: sym, q, why: '超過 13 個月未派息', k: 'div' });
    if (out.length && out[out.length - 1].symbol === sym) seen.add(sym);
  }
  return out.slice(0, 5);
}

function buildInsights(ctx, entries) {
  const out = [];

  /* 1. 息口 */
  const w1 = ctx.us10W1bp;
  let rateTone = 'neutral', rateTitle = '美息高位橫行，方向未明';
  if (w1 != null && w1 >= 8) { rateTone = 'bad'; rateTitle = '美息本週再上，估值折現壓力未減'; }
  else if (w1 != null && w1 <= -8) { rateTone = 'good'; rateTitle = '美息本週回落，估值壓力稍緩'; }
  const spreadCurve = ctx.us10 != null && ctx.us13 != null ? (ctx.us10 - ctx.us13) * 100 : null;
  out.push({
    ico: '息', name: '息口', tone: rateTone, title: rateTitle,
    bullets: [
      '美 10 年 <b>' + fmt(ctx.us10, 2) + '%</b>' + (w1 != null ? '，本週 <b>' + (w1 >= 0 ? '+' : '') + w1.toFixed(0) + ' bp</b>' : '') +
        (ctx.us30 != null ? '；30 年 ' + fmt(ctx.us30, 2) + '%' : ''),
      spreadCurve != null ? '10 年 − 13 週息差 <b>' + spreadCurve.toFixed(0) + ' bp</b>' + (spreadCurve > 0 ? '（正斜率）' : '（倒掛）') : '',
      ctx.hibor ? 'HIBOR 1 個月 <b>' + fmt(ctx.hibor.m1, 2) + '%</b>，3 個月 ' + fmt(ctx.hibor.m3, 2) + '%' : 'HIBOR 暫未取得',
      ctx.usd ? 'USD/HKD <b>' + fmt(ctx.usd, 3) + '</b>' + (ctx.usd >= 7.83 ? '，貼近弱方保證' : ctx.usd <= 7.77 ? '，偏強方' : '，區間中段') : '',
    ],
  });

  /* 2. 大市位置 */
  const hp = ctx.hsi ? ctx.hsi.pos52 : null;
  const sp = ctx.spx ? ctx.spx.pos52 : null;
  let posTone = 'neutral', posTitle = '兩地大市位置待突破';
  if (hp != null && sp != null) {
    if (hp <= 30 && sp >= 75) { posTone = 'watch'; posTitle = '港股貼近一年低位、美股仍在高位，兩邊節奏背馳'; }
    else if (hp <= 30) { posTone = 'good'; posTitle = '港股處於一年低位區，壞消息已反映一部分'; }
    else if (sp >= 90) { posTone = 'bad'; posTitle = '美股貼近一年高位，追高風險上升'; }
  }
  out.push({
    ico: '位', name: '大市位置', tone: posTone, title: posTitle,
    bullets: [
      ctx.hsi ? '恒指 <b>' + fmt(ctx.hsi.price, 0) + '</b>（本週 ' + pct(ctx.hsi.w1pct, 1) + '），52 週位置 <b>' + fmt(hp, 0) + '%</b>' : '',
      ctx.hscei ? '國企指數 <b>' + fmt(ctx.hscei.price, 0) + '</b>，位置 ' + fmt(ctx.hscei.pos52, 0) + '%' : '',
      ctx.spx ? '標普 500 <b>' + fmt(ctx.spx.price, 0) + '</b>，位置 ' + fmt(sp, 0) + '%' + (ctx.ixic ? '；納指 ' + fmt(ctx.ixic.pos52, 0) + '%' : '') : '',
      ctx.vix ? 'VIX <b>' + fmt(ctx.vix.price, 1) + '</b>（本週 ' + pct(ctx.vix.w1pct, 0) + '）' : '',
    ],
  });

  /* 3. 買點 */
  const strong = entries.filter((e) => e.score >= 3);
  const CAT = { low: '低位', tech: '超賣', yield: '息差', value: '低估值', fall: '深跌' };
  const strongCats = [...new Set(strong.flatMap((e) => e.reasons.map((r) => r.k)))].map((k) => CAT[k]).filter(Boolean).slice(0, 2).join('／');
  out.push({
    ico: '買', name: '買點訊號', tone: strong.length ? 'good' : 'neutral',
    title: strong.length ? strong.length + ' 檔符合' + strongCats + '條件' : entries.length ? '有 ' + entries.length + ' 檔接近門檻，未算買點' : '觀察清單為空，先加入標的',
    bullets: strong.length
      ? strong.slice(0, 3).map((e) => '<b>' + esc(e.symbol) + '</b> ' + e.reasons.slice(0, 2).map((r) => esc(r.t)).join('、'))
      : ['訊號以 52 週位置、RSI(14)、股息率與美債息差、市盈率四項機械比對', '分數 ≥ 3 才列為買點候選，避免單一指標觸發'],
  });

  /* 4. 組合息差 */
  const st = portfolioStats();
  const py = st.mv > 0 ? st.div / st.mv : null;
  const spt = py != null && ctx.us10 != null ? py * 100 - ctx.us10 : null;
  const hiY = st.items.filter((it) => it.q && it.q.yieldTtm >= 0.05).length;
  let pTone = 'neutral', pTitle = '未持倉，未能計算組合息差';
  if (spt != null) {
    if (spt >= 0) { pTone = 'good'; pTitle = '組合股息率仍高於美債，收息有補償'; }
    else { pTone = 'bad'; pTitle = '組合股息率低於美債，收息補償不足'; }
  }
  out.push({
    ico: '組', name: '組合息差', tone: pTone, title: pTitle,
    bullets: [
      py != null ? '組合加權股息率 <b>' + pctPlain(py) + '</b>' : '組合股息率 —',
      ctx.us10 != null ? '美 10 年 <b>' + fmt(ctx.us10, 2) + '%</b>' : '',
      spt != null ? '息差 <b>' + (spt >= 0 ? '+' : '') + spt.toFixed(2) + ' 個百分點</b>' : '',
      st.items.length ? '持倉中收益率 ≥ 5% 有 <b>' + hiY + '</b> 檔（共 ' + st.items.length + ' 檔）' : '',
    ],
  });

  return out;
}

function insCard(it) {
  return '<div class="insight ' + it.tone + '">' +
    '<div class="ins-head"><span class="ins-ico">' + it.ico + '</span><span class="ins-name">' + esc(it.name) + '</span></div>' +
    '<div class="ins-title">' + esc(it.title) + '</div>' +
    '<ul class="ins-list">' + it.bullets.filter(Boolean).map((b) => '<li>' + b + '</li>').join('') + '</ul>' +
    '</div>';
}

function themeRead(tag, ctx, B) {
  const n = (B.tagCount && B.tagCount[tag]) || 0;
  const t = ctx.tone || {};
  if (tag === '息口') {
    const w1 = ctx.us10W1bp;
    return '美 10 年 ' + fmt(ctx.us10, 2) + '%' + (w1 != null ? '（本週 ' + (w1 >= 0 ? '+' : '') + w1.toFixed(0) + ' bp）' : '') +
      (ctx.hibor ? '，HIBOR 1 個月 ' + fmt(ctx.hibor.m1, 2) + '%' : '') +
      '；一週標題中「加息」' + (t.hike || 0) + ' 則、「減息」' + (t.cut || 0) + ' 則。';
  }
  if (tag === '政策') return '政策／監管標題 ' + n + ' 則，集中於關稅、財政與行業監管；政策消息通常影響整個板塊而非單一公司。';
  if (tag === '業績') return '業績相關 ' + n + ' 則；留意「盈警／遜預期」與「上調指引」的分佈，這決定指數能否止跌。';
  if (tag === '資金流') return '資金流消息 ' + n + ' 則（北水、回購、ETF）；資金面轉向通常先於價格轉向。';
  if (tag === '風險') return '風險類標題 ' + n + ' 則' + (ctx.vix ? '；同期 VIX ' + fmt(ctx.vix.price, 1) + '（本週 ' + pct(ctx.vix.w1pct, 0) + '）' : '') + '。';
  if (tag === '科技') return '科技／AI 相關 ' + n + ' 則，是美股主要波動來源，利率敏感度亦最高。';
  if (tag === '併購') return '併購／資本動作 ' + n + ' 則，多數屬個股事件，留意對價與攤薄。';
  return '相關標題 ' + n + ' 則。';
}

function newsList(list, emptyText) {
  if (!list || !list.length) return '<div class="empty">' + esc(emptyText) + '</div>';
  return '<div class="news-list">' + list.map((n) => {
    const chips = (n.tags || []).map((t) => '<span class="chip ' + (TAG_CLS[t] || '') + '">' + esc(t) + '</span>').join('');
    const t = relTime(n.at);
    return '<a class="news-item" href="' + safeUrl(n.link || '#') + '" target="_blank" rel="noopener">' +
      (chips ? '<div class="ni-top">' + chips + '<span class="ni-time">' + esc(t) + '</span></div>' : '') +
      '<div class="ni-title">' + esc(n.title) + '</div>' +
      '<div class="ni-src">' + esc(n.publisher || '') + (chips ? '' : ' · ' + esc(t)) + '</div>' +
      '</a>';
  }).join('') + '</div>';
}

/* 公司別名：中文新聞多用中文名，單靠英文全名會漏配 */
const NAME_ALIAS = {
  '0700.HK': ['騰訊', 'Tencent'],
  '0005.HK': ['匯豐', '滙豐', 'HSBC'],
  '0939.HK': ['建行', '建設銀行', 'CCB'],
  '0941.HK': ['中移動', '中國移動', 'China Mobile'],
  '1299.HK': ['友邦', 'AIA'],
  '9988.HK': ['阿里巴巴', '阿里', 'Alibaba'],
  '3690.HK': ['美團', 'Meituan'],
  '1810.HK': ['小米', 'Xiaomi'],
  '2318.HK': ['中國平安', '平安', 'Ping An'],
  '0388.HK': ['港交所', 'HKEX'],
  '0883.HK': ['中海油', 'CNOOC'],
  '0857.HK': ['中石油', 'PetroChina'],
  '0386.HK': ['中石化', 'Sinopec'],
  '1211.HK': ['比亞迪', 'BYD'],
  '0001.HK': ['長和', 'CK Hutchison'],
  '0016.HK': ['新鴻基', 'SHKP'],
  '0011.HK': ['恒生銀行', 'Hang Seng Bank'],
  '0981.HK': ['中芯', 'SMIC'],
  '2382.HK': ['舜宇', 'Sunny Optical'],
  '0992.HK': ['聯想', 'Lenovo'],
  '2020.HK': ['安踏', 'ANTA'],
  '6862.HK': ['海底撈', 'Haidilao'],
  AAPL: ['蘋果', 'Apple'],
  MSFT: ['微軟', 'Microsoft'],
  NVDA: ['輝達', '英偉達', 'NVIDIA'],
  TSLA: ['特斯拉', 'Tesla'],
  AMZN: ['亞馬遜', 'Amazon'],
  GOOGL: ['谷歌', 'Google', 'Alphabet'],
  GOOG: ['谷歌', 'Google', 'Alphabet'],
  META: ['Meta', '臉書'],
  INTC: ['英特爾', 'Intel'],
  BABA: ['阿里巴巴', '阿里', 'Alibaba'],
  JD: ['京東', 'JD'],
  PDD: ['拼多多', 'PDD'],
  NIO: ['蔚來', 'NIO'],
  TSM: ['台積電', 'TSMC'],
  AVGO: ['博通', 'Broadcom'],
  NFLX: ['網飛', 'Netflix'],
  DIS: ['迪士尼', 'Disney'],
  JPM: ['摩根大通', 'JPMorgan'],
};

function nameAliases(q) {
  const sym = String(q.symbol || '').toUpperCase();
  const set = new Set(NAME_ALIAS[sym] || []);
  const first = String(q.name || '').split(/[\s,]+/)[0];
  if (first && first.length >= 3 && !/^(The|China|Bank|New|United)$/i.test(first)) set.add(first);
  return [...set].filter(Boolean);
}

/* 用持倉／清單的公司名比對近七日新聞標題，最多每檔兩則 */
function holdingNews(B) {
  const list = S.watchlist.map((s) => quoteOf(s)).filter(Boolean);
  const rows = [];
  const used = new Set();
  const feed = S.brief.holdNews;
  const all = [].concat((B.news && B.news.hk) || [], (B.news && B.news.us) || []);

  /* 逐檔：優先用後端抓回的公司新聞，沒有就在市場新聞裡比對公司名 */
  for (const q of list) {
    let picked = (feed && feed[q.symbol]) || [];
    if (!picked.length) {
      const aliases = nameAliases(q).map((a) => ({
        a,
        re: /^[A-Za-z]/.test(a) ? new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') : null,
      }));
      picked = all
        .filter((n) => {
          const t = String(n.title || '');
          return aliases.some((x) => (x.re ? x.re.test(t) : t.includes(x.a)));
        })
        .slice(0, 2);
    }
    for (const n of picked.slice(0, 2)) {
      const k = n.link || n.title;
      if (used.has(k)) continue;
      used.add(k);
      rows.push({ q, n });
    }
  }
  return rows.slice(0, 8);
}

async function loadHoldNews(force) {
  const syms = S.watchlist.slice(0, 8);
  const key = syms.join(',');
  if (!key) {
    S.brief.holdNews = {};
    return;
  }
  if (!force && S.brief.holdNews && S.brief.holdKey === key && Date.now() - S.brief.holdAt < 10 * 60e3) return;
  try {
    const r = await api('/api/holding-news?symbols=' + encodeURIComponent(key) + (force ? '&nocache=1' : ''), { timeout: 60000 });
    S.brief.holdNews = r.items || {};
    S.brief.holdPartial = !!r.partial;
    S.brief.holdKey = key;
    S.brief.holdAt = Date.now();
    if (S.tab === 'brief') renderBrief();
  } catch (e) {
    /* 靜默：退回標題比對 */
    S.brief.holdPartial = true;
  }
}

function renderBrief() {
  const host = $('#briefRoot');
  if (!host) return;
  const B = S.brief.data;
  if (!B) {
    host.innerHTML = '<div class="card"><div class="card-head"><h2>本週焦點</h2><span class="hint">正在抓取利率、HIBOR 與港美新聞…</span></div>' +
      '<div class="skeleton" style="height:86px;margin-bottom:10px"></div><div class="skeleton" style="height:150px;margin-bottom:10px"></div><div class="skeleton" style="height:200px"></div></div>';
    return;
  }

  const ctx = briefCtx(B);
  const entries = buildEntries(ctx);
  const cautions = buildCautions(ctx);
  const ins = buildInsights(ctx, entries);

  /* 一句總結：把四個判讀壓成一行 */
  const strongN = entries.filter((e) => e.score >= 3).length;
  const pstats = portfolioStats();
  const pY = pstats.mv > 0 ? pstats.div / pstats.mv : null;
  const sPt = pY != null && ctx.us10 != null ? pY * 100 - ctx.us10 : null;
  const bits = [];
  if (ctx.us10 != null) bits.push('美 10 年 <b>' + fmt(ctx.us10, 2) + '%</b>' + (ctx.us10W1bp != null ? '（週 ' + (ctx.us10W1bp >= 0 ? '+' : '') + ctx.us10W1bp.toFixed(0) + ' bp）' : ''));
  if (ctx.hsi && ctx.hsi.pos52 != null) bits.push('恒指 52 週位置 <b>' + fmt(ctx.hsi.pos52, 0) + '%</b>');
  bits.push(strongN ? '<b>' + strongN + ' 檔</b>出現買點訊號' : '暫無買點訊號');
  if (sPt != null) bits.push('組合息差 <b>' + (sPt >= 0 ? '+' : '') + sPt.toFixed(2) + ' pt</b>');
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 864e5);
  const range = (from.getMonth() + 1) + '/' + from.getDate() + ' – ' + (now.getMonth() + 1) + '/' + now.getDate();

  const order = ['us10y', 'us30y', 'us13w', 'vix', 'hsi', 'hscei', 'spx', 'ixic', 'dxy', 'usdhkd', 'gold', 'oil'];
  const mcards = order.map((k) => macroCard(ctx.mk[k])).filter(Boolean).join('');

  const themes = Object.entries(B.tagCount || {}).sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 2).slice(0, 3);
  const allNews = [].concat((B.news && B.news.hk) || [], (B.news && B.news.us) || []);
  const themeHtml = themes.length
    ? themes.map(([tag, cnt]) => {
        const hs = allNews.filter((n) => (n.tags || []).includes(tag)).slice(0, 3);
        return '<div class="theme">' +
          '<div class="th-head"><span class="chip ' + (TAG_CLS[tag] || '') + '">' + esc(tag) + '</span><span class="th-cnt">' + cnt + ' 則</span></div>' +
          '<div class="th-read">' + esc(themeRead(tag, ctx, B)) + '</div>' +
          hs.map((h) => '<a class="th-link" href="' + safeUrl(h.link || '#') + '" target="_blank" rel="noopener">' + esc(h.title) + '</a>').join('') +
          '</div>';
      }).join('')
    : '<div class="empty">近七日暫無足夠的同類消息形成主線。</div>';

  const entryHtml = entries.length
    ? entries.map((e) => {
        const q = e.q;
        return '<tr class="clickable" data-sym="' + symAttr(e.symbol) + '">' +
          '<td><div class="sym">' + esc(e.symbol) + '<span class="mk-tag ' + q.market + '">' + q.market + '</span></div>' +
          '<div class="sym-name" title="' + esc(q.name) + '">' + esc(q.name) + '</div></td>' +
          '<td class="num"><b>' + fmtPrice(q.price) + '</b><div class="tiny">' + esc(q.currency) + '</div></td>' +
          '<td class="range-cell">' +
            '<div class="r52"><span class="fill" style="width:' + clamp(e.pos).toFixed(1) + '%"></span><span class="pin" style="left:' + clamp(e.pos).toFixed(1) + '%"></span></div>' +
            '<div class="r52-lb"><span>' + fmtPrice(q.w52Low) + '</span><span>' + fmtPrice(q.w52High) + '</span></div></td>' +
          '<td class="num">' + (e.rsi == null ? '—' : fmt(e.rsi, 0)) + '</td>' +
          '<td class="num ' + (e.y >= 5 ? 'up' : '') + '">' + (e.y == null ? '—' : e.y.toFixed(2) + '%') + '</td>' +
          '<td class="num ' + (e.spread != null && e.spread >= 0 ? 'up' : '') + '">' + (e.spread == null ? '—' : (e.spread >= 0 ? '+' : '') + e.spread.toFixed(2)) + '</td>' +
          '<td><div class="sig-row">' + e.reasons.slice(0, 3).map((r) => '<span class="sig ' + r.k + '">' + esc(r.t) + '</span>').join('') +
          '<span class="score-pill ' + (e.score >= 3 ? 'hot' : '') + '">' + e.score.toFixed(1) + '</span></div></td>' +
          '</tr>';
      }).join('')
    : '';

  const cautionHtml = cautions.length
    ? cautions.map((c) => {
        const q = c.q;
        return '<div class="caution clickable" data-sym="' + symAttr(c.symbol) + '">' +
          '<div class="ca-top"><span class="sym">' + esc(c.symbol) + '</span><span class="ca-why">' + esc(c.why) + '</span></div>' +
          '<div class="ca-meta">' + fmtPrice(q.price) + ' ' + esc(q.currency) + ' · ' + pct(q.changePct) + ' · 52 週位置 ' + fmt(q.w52Pos, 0) + '%</div>' +
          '</div>';
      }).join('')
    : '<div class="empty">目前持倉與清單內未見追高或利率敏感度特別高的標的。</div>';

  /* 持倉消息：把市場新聞扣回自己的股票 */
  const mn = holdingNews(B);
  const myNewsHtml = mn.length
    ? '<div class="mynews">' + mn.map(({ q, n }) =>
        '<a class="mn" href="' + safeUrl(n.link || '#') + '" target="_blank" rel="noopener">' +
        '<span class="mn-sym"><b>' + esc(q.symbol) + '</b><span class="mk-tag ' + q.market + '">' + q.market + '</span></span>' +
        '<span class="mn-body"><span class="mn-t">' + esc(n.title) + '</span>' +
        '<span class="mn-m">' + esc(n.publisher || '') + ' · ' + esc(relTime(n.at)) + '</span></span>' +
        '</a>').join('') + '</div>'
    : '<div class="empty">近七日未見直接提及持倉公司的報導；若有突發個股消息，通常會先出現在上方兩欄。</div>';

  host.innerHTML =
    '<div class="brief-head">' +
      '<div><h2>近七日港美關鍵焦點</h2>' +
      '<div class="bh-sub">' + esc(range) + ' · ' + (allNews.length) + ' 則新聞 · 更新 ' + esc(new Date(B.generatedAt).toLocaleTimeString('zh-HK', { hour12: false })) +
      (B.partial ? ' · <span class="warn-inline">部分資料源未回應，以下內容可能不完整</span>' : '') +
      (B._stale ? ' · <span class="warn-inline">顯示上次成功的結果</span>' : '') +
      '</div></div>' +
      '<button class="btn ghost" id="btnBriefRefresh">重新抓取</button>' +
    '</div>' +

    '<div class="brief-sum"><span class="bs-tag">本週一句</span><span class="bs-txt">' + bits.join('<i>·</i>') + '</span></div>' +
    '<div class="macro-grid">' + mcards + hiborCard(ctx.hibor) + '</div>' +

    '<div class="insight-grid">' + ins.map(insCard).join('') + '</div>' +

    '<div class="card">' +
      '<div class="card-head"><h2>本週主線</h2><span class="hint">依標題關鍵詞歸類，附系統判讀</span></div>' +
      '<div class="themes">' + themeHtml + '</div>' +
    '</div>' +

    '<div class="grid-2 news-2col">' +
      '<div class="card"><div class="card-head"><h2>港股 · 中國焦點</h2><span class="hint">近七日 · 依重要性排序</span></div>' + newsList((B.news && B.news.hk) || [], '暫無港股新聞') + '</div>' +
      '<div class="card"><div class="card-head"><h2>美股 · 環球焦點</h2><span class="hint">近七日 · 依重要性排序</span></div>' + newsList((B.news && B.news.us) || [], '暫無美股新聞') + '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-head"><h2>與你的持倉相關</h2><span class="hint">逐檔抓近七日公司新聞，每檔精選 2 則</span></div>' +
      myNewsHtml +
    '</div>' +

    '<div class="card">' +
      '<div class="card-head"><h2>值得注意的買點</h2><span class="hint">機械化篩選：52 週位置 ≤ 35%、RSI ≤ 35、息差、PE ≤ 14；分數 ≥ 3 為候選</span></div>' +
      (entries.length
        ? '<div class="table-wrap"><table class="tbl wide"><thead><tr><th>代號 / 名稱</th><th class="num">現價</th><th>52 週位置</th><th class="num">RSI</th><th class="num">收益率</th><th class="num">息差 (pt)</th><th>訊號</th></tr></thead><tbody>' + entryHtml + '</tbody></table></div>'
        : '<div class="empty">清單內暫無標的符合條件。加入觀察清單後會自動比對。</div>') +
      '<p class="brief-note">低位不等於見底，請一併對照下方「要提防」的接刀提示。息差 = 該股收益率 − 美 10 年債息（百分點）。負值代表收息回報低於無風險利率。此表為技術與估值條件的機械比對，不是買入建議。</p>' +
    '</div>' +

    '<div class="grid-2 news-2col">' +
      '<div class="card"><div class="card-head"><h2>要提防</h2><span class="hint">追高、接刀、利率敏感、波動與派息中斷</span></div>' + cautionHtml + '</div>' +
      '<div class="card"><div class="card-head"><h2>怎麼讀這一頁</h2></div>' +
        '<ul class="read-guide">' +
          '<li><b>先看息口</b>：美 10 年與 HIBOR 決定折現率，利率向上時高 PE 與長久期資產先受壓。</li>' +
          '<li><b>再看位置</b>：52 週位置低於 30% 代表市場已定價壞消息，但仍要配合息差與業績。</li>' +
          '<li><b>買點不是建議</b>：本頁只做條件比對，最終要看業績、政策方向與自己的倉位上限。</li>' +
          '<li><b>新聞排序</b>：先按「利率／政策／業績」等關鍵詞權重，再按時間與來源質素排序，非點擊率。</li>' +
          '<li><b>持倉新聞</b>：只保留標題直接提到該公司的報導，避免大市消息蓋過個股；每檔最多兩則。</li>' +
        '</ul>' +
        '<p class="brief-note">資料來源：Yahoo Finance（延遲報價）、香港銀行公會（HIBOR）、Google News 中文（近七日）。行情可能延遲，決策請以券商報價為準。</p>' +
      '</div>' +
    '</div>';

  const rb = $('#btnBriefRefresh');
  if (rb) rb.onclick = () => loadBrief(true);
}

async function loadBrief(force) {
  if (S.brief.loading) return;
  if (!force && S.brief.data && Date.now() - S.brief.at < 5 * 60e3) return;
  S.brief.loading = true;
  S.brief.error = null;
  const oldBtn = $('#btnBriefRefresh');
  if (oldBtn) {
    oldBtn.disabled = true;
    oldBtn.textContent = '抓取中…';
  }
  if (!S.brief.data) renderBrief();
  try {
    S.brief.data = await api('/api/brief' + (force ? '?nocache=1' : ''), { timeout: 60000 });
    S.brief.at = Date.now();
  } catch (e) {
    S.brief.error = e.message;
    if (!S.brief.data) {
      $('#briefRoot').innerHTML =
        '<div class="card"><div class="statebox err">' +
        '<div class="sb-title">焦點資料暫時取不到</div>' +
        '<div class="sb-sub">' + esc(e.message) + '</div>' +
        '<div class="sb-hint">行情與新聞來源偶爾會限流或逾時，稍等片刻再試通常就會恢復。</div>' +
        '<button class="btn primary" id="btnBriefRetry">重新嘗試</button>' +
        '</div></div>';
      const rb = $('#btnBriefRetry');
      if (rb) rb.onclick = () => { S.brief.data = null; loadBrief(true); };
    } else {
      toast('焦點更新失敗，仍顯示上次結果：' + e.message, true);
    }
  } finally {
    S.brief.loading = false;
    if (S.brief.data) {
      renderBrief();
      loadHoldNews(force);
    }
  }
}

/* ---------------- 啟動 ---------------- */
(async function init() {
  bindTabs();
  bindBrief();
  bindWatch();
  bindTrades();
  bindMisc();
  bindGlobal();
  setNet('ok');
  renderClock();
  S.clockTimer = setInterval(renderClock, 30000);

  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      await loadState();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (i < 4) await sleep(1200 * (i + 1));
    }
  }

  if (lastErr) {
    setNet(navigator.onLine === false ? 'offline' : 'error', lastErr.message);
    const host = $('#briefRoot');
    if (host) {
      host.innerHTML =
        '<div class="card"><div class="statebox err">' +
        '<div class="sb-title">無法連上本機服務</div>' +
        '<div class="sb-sub">' + esc(lastErr.message) + '</div>' +
        '<div class="sb-hint">請確認命令視窗仍在執行；若已關閉，雙擊資料夾內的「啟動.bat」重新啟動。</div>' +
        '<button class="btn primary" id="btnBootRetry">重新載入</button>' +
        '</div></div>';
      const b = $('#btnBootRetry');
      if (b) b.onclick = () => location.reload();
    }
    return;
  }

  renderAll();
  await refreshQuotes(true);
  scheduleAuto();
  loadBrief();
})();
