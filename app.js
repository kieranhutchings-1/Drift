/* ===================== Drift — app.js ===================== */

/* ---- Prevent pinch-zoom gestures (belt & suspenders alongside viewport meta) ---- */
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

/* ---- Backend connection defaults — pre-fill so a fresh install just works ---- */
const BACKEND_DEFAULTS = {
  workerUrl: 'https://drift-backend.kieranhutchings.workers.dev',
  sharedKey: '5d049d5520e4cc81ee79826cbd914362dfe9919e1103cfc9'
};

/* ---- Keep the page from drifting when the iOS keyboard opens ----
   The viewport meta's interactive-widget=resizes-content (set in index.html)
   does the real work on modern iOS: it actually resizes the visible area
   instead of overlaying or panning it. This JS is just a safety net for
   older iOS versions that ignore that directive — it nudges the page back
   to (0,0) if anything still tries to scroll it, without forcing #app's
   height itself (forcing height caused it to over-shrink past where the
   keyboard actually starts). */
function correctScrollDrift() {
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', correctScrollDrift);
  window.visualViewport.addEventListener('scroll', correctScrollDrift);
}
window.addEventListener('scroll', correctScrollDrift);

/* ---- Storage keys ---- */
const KEYS = {
  weights: 'drift_weights',     // [{id, date, kg}]
  goal: 'drift_goal',           // {start, goal}
  whoop: 'drift_whoop',         // {importedAt, days:[{date, recovery, sleep, strain, hrv, rhr}]}
  apikey: 'drift_apikey',
  coachHistory: 'drift_coach_history',
  jabs: 'drift_jabs',           // [{id, date, doseMg, site}]
  jabConfig: 'drift_jab_config', // {name, doseMg, intervalDays, halfLifeDays, site}
  milestonesSeen: 'drift_milestones_seen', // [id, id, ...]
  plateauNotified: 'drift_plateau_notified', // boolean
  whoopConfig: 'drift_whoop_config', // {workerUrl, sharedKey}
  checkIns: 'drift_checkins', // [{id, date, energy, appetite, note}]
  supplements: 'drift_supplements' // [{id, name, unit, log: {'YYYY-MM-DD': true}}]
};

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

let state = {
  weights: store.get(KEYS.weights, []),
  goal: store.get(KEYS.goal, null),
  whoop: store.get(KEYS.whoop, null),
  apikey: store.get(KEYS.apikey, ''),
  coachHistory: store.get(KEYS.coachHistory, []),
  jabs: store.get(KEYS.jabs, []),
  jabConfig: store.get(KEYS.jabConfig, { name: 'Tirzepatide', doseMg: 7.5, intervalDays: 7, halfLifeDays: 5, site: 'Stomach – upper left' }),
  milestonesSeen: store.get(KEYS.milestonesSeen, []),
  plateauNotified: store.get(KEYS.plateauNotified, false),
  whoopConfig: store.get(KEYS.whoopConfig, BACKEND_DEFAULTS),
  checkIns: store.get(KEYS.checkIns, []),
  supplements: store.get(KEYS.supplements, [{ id: 'vitd', name: 'Vitamin D', unit: '1000 IU', log: {} }])
};

function persist(key) {
  const map = {
    weights: KEYS.weights, goal: KEYS.goal,
    whoop: KEYS.whoop, apikey: KEYS.apikey, coachHistory: KEYS.coachHistory,
    jabs: KEYS.jabs, jabConfig: KEYS.jabConfig,
    milestonesSeen: KEYS.milestonesSeen, plateauNotified: KEYS.plateauNotified,
    whoopConfig: KEYS.whoopConfig,
    checkIns: KEYS.checkIns,
    supplements: KEYS.supplements
  };
  store.set(map[key], state[key]);
  // whoopConfig is what tells us WHERE the backend is — can't be synced through
  // itself. whoop is already durable server-side via its own sync, no need to
  // duplicate it in the general state blob.
  if (key !== 'whoopConfig' && key !== 'whoop') pushStateDebounced();
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function uid() { return Math.random().toString(36).slice(2, 10); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ===================== Navigation ===================== */
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.screen));
});
function goTo(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelector(`.nav-btn[data-screen="${name}"]`).classList.add('active');
}

/* ===================== HOME ===================== */
function renderHome() {
  document.getElementById('home-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const streakCount = computeStreak();
  document.getElementById('home-streak').textContent = state.jabs.length
    ? `${streakCount} on track`
    : `${streakCount} ${streakCount === 1 ? 'week' : 'weeks'} logged`;

  renderGoalRing();
  renderSparkline();
  renderWhoopHome();

  const latest = latestWeight();
  document.getElementById('home-weight-pill').textContent = latest ? `${latest.kg} kg · ${fmtDate(latest.date)}` : 'no entry yet';
}

function latestWeight() {
  if (!state.weights.length) return null;
  return [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}

function jabStreak() {
  if (!state.jabs.length) return 0;
  const jabs = sortedJabs();
  let streak = 1;
  for (let i = jabs.length - 1; i > 0; i--) {
    const gap = daysBetween(jabs[i - 1].date, jabs[i].date);
    if (gap <= (state.jabConfig.intervalDays || 7) + 2) streak++;
    else break;
  }
  return streak;
}

function computeStreak() {
  if (!state.jabs.length) return state.weights.length;
  return jabStreak();
}

function renderGoalRing() {
  const r = 72, circumference = 2 * Math.PI * r;
  const fill = document.getElementById('ring-fill');
  fill.setAttribute('stroke-dasharray', circumference);
  const pctEl = document.getElementById('ring-pct');
  const subEl = document.getElementById('ring-sub');

  if (!state.goal || !state.goal.start || !state.goal.goal) {
    fill.setAttribute('stroke-dashoffset', circumference);
    fill.style.opacity = 0;
    pctEl.textContent = '—';
    subEl.textContent = 'set a goal';
    return;
  }
  fill.style.opacity = 1;
  const latest = latestWeight();
  const current = latest ? latest.kg : state.goal.start;
  const totalDelta = state.goal.start - state.goal.goal;
  let pct;
  if (totalDelta === 0) pct = 100;
  else pct = ((state.goal.start - current) / totalDelta) * 100;
  pct = Math.max(0, Math.min(100, pct));

  fill.setAttribute('stroke-dashoffset', circumference * (1 - pct / 100));
  pctEl.textContent = Math.round(pct) + '%';
  const remaining = Math.abs(current - state.goal.goal).toFixed(1);
  subEl.textContent = pct >= 100 ? 'goal reached' : `${remaining} kg to go`;
}

function renderSparkline() {
  const svg = document.getElementById('sparkline');
  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
  svg.innerHTML = '';
  if (sorted.length < 2) {
    svg.innerHTML = `<text x="195" y="48" fill="#555E70" font-size="12" text-anchor="middle" font-family="Inter">log a few weeks to see your trend</text>`;
    return;
  }
  const vals = sorted.map((w) => w.kg);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = 10;
  const w = 390, h = 90;
  const xStep = (w - pad * 2) / (sorted.length - 1);
  const norm = (v) => max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2);

  let path = '';
  sorted.forEach((pt, i) => {
    const x = pad + i * xStep, y = norm(pt.kg);
    path += (i === 0 ? 'M' : 'L') + x + ',' + y + ' ';
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#3D7BFF"/>
        <stop offset="100%" stop-color="#FF5C93"/>
      </linearGradient>
    </defs>
    <path d="${path}" fill="none" stroke="url(#sparkGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  `;
  sorted.forEach((pt, i) => {
    const x = pad + i * xStep, y = norm(pt.kg);
    svg.innerHTML += `<circle cx="${x}" cy="${y}" r="3" fill="#0B0E13" stroke="#FF5C93" stroke-width="1.5"/>`;
  });
}

function renderWhoopHome() {
  const statusEl = document.getElementById('whoop-status');
  const wrap = document.getElementById('whoop-rings-wrap');
  const svg = document.getElementById('whoop-rings-svg');
  const center = document.getElementById('whoop-rings-center');
  const legend = document.getElementById('whoop-rings-legend');
  const dateEl = document.getElementById('whoop-latest-date');

  if (!state.whoop || !state.whoop.days || !state.whoop.days.length) {
    statusEl.textContent = 'not connected';
    if (wrap) wrap.style.display = 'none';
    if (legend) legend.innerHTML = '<div class="empty-state">Connect Whoop in Settings.</div>';
    if (dateEl) dateEl.textContent = '';
    return;
  }

  const last = [...state.whoop.days].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  statusEl.textContent = `${state.whoop.days.length} days`;
  if (wrap) wrap.style.display = 'flex';
  if (dateEl) dateEl.textContent = fmtDate(last.date);

  const cx = 110, cy = 110;
  const rings = [
    { label: 'Recovery', val: last.recovery, max: 100, color: recoveryColor(last.recovery), r: 95, sw: 12 },
    { label: 'Sleep',    val: last.sleep,     max: 100, color: '#3D7BFF',                   r: 76, sw: 10 },
    { label: 'Strain',   val: last.strain,    max: 21,  color: '#FF5C93',                   r: 59, sw: 10 }
  ];

  const arc = (ring) => {
    const pct = Math.min(Math.max((ring.val ?? 0) / ring.max, 0), 1);
    const c = 2 * Math.PI * ring.r;
    return { c, offset: c * (1 - pct) };
  };

  if (svg) svg.innerHTML = `
    ${rings.map((ring) => {
      const { c } = arc(ring);
      return `<circle cx="${cx}" cy="${cy}" r="${ring.r}" fill="none" stroke="var(--surface-2)" stroke-width="${ring.sw}" opacity="0.6"/>`;
    }).join('')}
    ${rings.map((ring, i) => {
      const { c, offset } = arc(ring);
      return `<circle cx="${cx}" cy="${cy}" r="${ring.r}"
        fill="none" stroke="${ring.color}" stroke-width="${ring.sw}"
        stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${ring.val == null ? c : offset}"
        transform="rotate(-90 ${cx} ${cy})"
        style="transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1) ${i*0.2}s; opacity:${ring.val == null ? 0 : 1}"/>`;
    }).join('')}
  `;

  const rec = last.recovery != null ? Math.round(last.recovery) : null;
  const readiness = rec == null ? '' : rec >= 67 ? 'Ready' : rec >= 34 ? 'Moderate' : 'Rest up';
  if (center) center.innerHTML = `
    <div class="whoop-ring-big" style="color:${recoveryColor(last.recovery)}">${rec ?? '—'}${rec != null ? '<span class="whoop-ring-pct">%</span>' : ''}</div>
    <div class="whoop-ring-readiness">${readiness}</div>
  `;

  if (legend) legend.innerHTML = `<div class="whoop-legend-row">${rings.map((ring) => `
    <div class="whoop-legend-item">
      <span class="whoop-legend-dot" style="background:${ring.color}"></span>
      <span class="whoop-legend-name">${ring.label}</span>
      <span class="whoop-legend-val">${ring.val != null ? num(ring.val) + (ring.max === 100 ? '%' : '') : '—'}</span>
    </div>`).join('')}</div>`;
}

function makeWhoopRing() {} // legacy stub — no longer used

function sleepColor(v) {
  if (v === null || v === undefined) return 'var(--surface-2)';
  if (v >= 75) return 'var(--good)';
  if (v >= 50) return 'var(--amber)';
  return 'var(--danger)';
}
function strainColor(v) {
  if (v === null || v === undefined) return 'var(--surface-2)';
  if (v >= 14) return 'var(--danger)';
  if (v >= 8) return 'var(--amber)';
  return '#3D7BFF';
}
function num(v) { return (v === undefined || v === null || isNaN(v)) ? '—' : (Math.round(v * 10) / 10); }

function recoveryColor(r) {
  if (r === null || r === undefined || isNaN(r)) return 'var(--surface-2)';
  if (r >= 67) return 'var(--good)';
  if (r >= 34) return 'var(--amber)';
  return 'var(--danger)';
}

function openWhoopDetail() {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('screen-whoop-detail').classList.add('active');
  renderWhoopDetail();
}
document.getElementById('btn-view-whoop-detail').addEventListener('click', openWhoopDetail);
document.getElementById('btn-whoop-detail-back').addEventListener('click', () => goTo('home'));
document.getElementById('btn-whoop-detail-sync').addEventListener('click', () => syncWhoop(true).then(renderWhoopDetail));

const WHOOP_METRICS = [
  { id: 'recovery', label: 'Recovery', unit: '%' },
  { id: 'sleep', label: 'Sleep', unit: '%' },
  { id: 'strain', label: 'Strain', unit: '' },
  { id: 'hrv', label: 'HRV', unit: 'ms' },
  { id: 'rhr', label: 'RHR', unit: 'bpm' }
];
const WHOOP_RANGES = [
  { id: 7, label: '7D' },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
  { id: 99999, label: 'All' }
];
let whoopMetric = 'recovery';
let whoopRange = 30;

function renderWhoopDetail() {
  renderWhoopTabs();
  renderWhoopChartAndStats();
  renderWhoopDayList();
  renderWorkouts();
}

function renderWhoopTabs() {
  document.getElementById('whoop-metric-tabs').innerHTML = WHOOP_METRICS.map((m) =>
    `<button class="tab-btn ${m.id === whoopMetric ? 'active' : ''}" data-metric="${m.id}">${m.label}</button>`
  ).join('');
  document.getElementById('whoop-range-tabs').innerHTML = WHOOP_RANGES.map((r) =>
    `<button class="tab-btn ${r.id === whoopRange ? 'active' : ''}" data-range="${r.id}">${r.label}</button>`
  ).join('');
  document.querySelectorAll('#whoop-metric-tabs [data-metric]').forEach((b) => {
    b.addEventListener('click', () => { whoopMetric = b.dataset.metric; renderWhoopTabs(); renderWhoopChartAndStats(); });
  });
  document.querySelectorAll('#whoop-range-tabs [data-range]').forEach((b) => {
    b.addEventListener('click', () => { whoopRange = parseInt(b.dataset.range); renderWhoopTabs(); renderWhoopChartAndStats(); });
  });
}

function whoopFilteredSorted() {
  const all = (state.whoop && state.whoop.days) || [];
  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.slice(-whoopRange);
}

function renderWhoopChartAndStats() {
  const svg = document.getElementById('whoop-trend-chart');
  const tooltip = document.getElementById('whoop-trend-tooltip');
  const metric = WHOOP_METRICS.find((m) => m.id === whoopMetric);
  const points = whoopFilteredSorted().filter((d) => d[whoopMetric] !== null && d[whoopMetric] !== undefined);

  document.getElementById('whoop-detail-range').textContent = state.whoop && state.whoop.days.length
    ? `${state.whoop.days.length} days synced total`
    : 'No data yet — connect Whoop in Settings.';

  if (points.length < 2) {
    svg.innerHTML = `<text x="195" y="88" fill="#555E70" font-size="12" text-anchor="middle" font-family="Inter">not enough data for this range yet</text>`;
    tooltip.textContent = 'Tap a point to inspect it.';
    ['avg', 'best', 'worst'].forEach((k) => document.getElementById(`whoop-stat-${k}`).textContent = '—');
    document.getElementById('whoop-stat-trend').textContent = '';
    return;
  }

  const w = 390, h = 170, padL = 10, padR = 10, padTop = 14, padBottom = 14;
  const vals = points.map((p) => p[whoopMetric]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const innerW = w - padL - padR, innerH = h - padTop - padBottom;
  const xStep = innerW / (points.length - 1);
  const xAt = (i) => padL + i * xStep;
  const yAt = (v) => padTop + innerH - ((v - min) / range) * innerH;
  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p[whoopMetric]), v: p[whoopMetric], date: p.date }));

  let curve = `M${coords[0].x},${coords[0].y} `;
  for (let i = 0; i < coords.length - 1; i++) {
    const c0 = coords[i], c1 = coords[i + 1];
    curve += `Q${c0.x},${c0.y} ${(c0.x + c1.x) / 2},${(c0.y + c1.y) / 2} `;
  }
  curve += `L${coords.at(-1).x},${coords.at(-1).y}`;
  const area = `M${padL},${h - padBottom} L` + coords.map((c) => `${c.x},${c.y}`).join(' L') + ` L${w - padR},${h - padBottom} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="whoopGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#3D7BFF"/>
        <stop offset="100%" stop-color="#FF5C93"/>
      </linearGradient>
      <linearGradient id="whoopFill" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FF5C93" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="#3D7BFF" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#whoopFill)" stroke="none"/>
    <path d="${curve}" fill="none" stroke="url(#whoopGrad)" stroke-width="2.2" stroke-linecap="round"/>
    ${coords.map((c, i) => `<circle class="chart-point" data-i="${i}" cx="${c.x}" cy="${c.y}" r="10" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="3" fill="#0B0E13" stroke="url(#whoopGrad)" stroke-width="1.5" pointer-events="none"/>`).join('')}
  `;

  svg.querySelectorAll('.chart-point').forEach((c) => {
    c.addEventListener('click', () => {
      const i = parseInt(c.dataset.i);
      const p = coords[i];
      tooltip.textContent = `${fmtDate(p.date)} — ${metric.label}: ${num(p.v)}${metric.unit}`;
    });
  });

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  document.getElementById('whoop-stat-avg').textContent = `${num(avg)}${metric.unit}`;
  document.getElementById('whoop-stat-best').textContent = `${num(max)}${metric.unit}`;
  document.getElementById('whoop-stat-worst').textContent = `${num(min)}${metric.unit}`;

  const mid = Math.floor(vals.length / 2);
  const firstHalfAvg = vals.slice(0, mid || 1).reduce((a, b) => a + b, 0) / (mid || 1);
  const secondHalfAvg = vals.slice(mid).reduce((a, b) => a + b, 0) / (vals.length - mid);
  const delta = secondHalfAvg - firstHalfAvg;
  const trendEl = document.getElementById('whoop-stat-trend');
  if (Math.abs(delta) < range * 0.03) {
    trendEl.textContent = `Roughly steady across this period`;
  } else {
    trendEl.textContent = `${delta > 0 ? '▲' : '▼'} Trending ${delta > 0 ? 'up' : 'down'} vs the start of this period (${delta > 0 ? '+' : ''}${num(delta)}${metric.unit})`;
  }
  tooltip.textContent = 'Tap a point to inspect it.';
}

function renderWhoopDayList() {
  const wrap = document.getElementById('whoop-detail-list');
  const days = state.whoop && state.whoop.days ? [...state.whoop.days].sort((a, b) => b.date.localeCompare(a.date)) : [];
  if (!days.length) {
    wrap.innerHTML = `<div class="empty-state">No Whoop data yet — connect and sync from Settings.</div>`;
    return;
  }
  wrap.innerHTML = days.map((d) => `
    <div class="whoop-day-row">
      <div class="whoop-recovery-dot" style="background:${recoveryColor(d.recovery)};">${d.recovery !== null && d.recovery !== undefined ? Math.round(d.recovery) : '—'}</div>
      <div class="whoop-day-info">
        <div class="whoop-day-date">${fmtDate(d.date)}</div>
        <div class="whoop-day-stats">Sleep ${num(d.sleep)}% · Strain ${num(d.strain)} · HRV ${num(d.hrv)}ms · RHR ${num(d.rhr)}bpm</div>
      </div>
    </div>
  `).join('');
}

/* ===================== TODAY FOCUS CARD ===================== */
function renderTodayCard() {
  const el = document.getElementById('today-msg');
  const parts = [];

  // Recovery status
  const whoopDays = state.whoop && state.whoop.days ? [...state.whoop.days].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const lastDay = whoopDays.at(-1);
  if (lastDay && lastDay.recovery !== null) {
    const r = lastDay.recovery;
    if (r >= 67) parts.push(`Recovery ${Math.round(r)}% — your body is primed`);
    else if (r >= 34) parts.push(`Recovery ${Math.round(r)}% — moderate energy today`);
    else parts.push(`Recovery ${Math.round(r)}% — your body needs rest today`);
  }

  // Medication timing — intentionally omitted from Today card for discretion

  // Weight trend
  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length >= 3) {
    const recent = sorted.slice(-3);
    const delta = recent.at(-1).kg - recent[0].kg;
    if (delta < -0.3) parts.push(`weight trending down ${Math.abs(delta).toFixed(1)}kg`);
    else if (delta > 0.3) parts.push(`weight up ${delta.toFixed(1)}kg recently`);
    else parts.push('weight holding steady');
  }

  // Last check-in energy
  const thisWeekCI = checkInThisWeek();
  if (thisWeekCI) {
    const energyLabels = ['', 'low energy', 'below average', 'average energy', 'good energy', 'high energy'];
    parts.push(energyLabels[thisWeekCI.energy] || '');
  }

  if (!parts.length) {
    el.textContent = 'Set a goal, log your weight, and connect Whoop to get your daily focus.';
    return;
  }

  // Build the sentence
  const [first, ...rest] = parts.filter(Boolean);
  const sentence = rest.length
    ? `${capitalise(first)} — ${rest.join(', ')}.`
    : `${capitalise(first)}.`;
  el.textContent = sentence;
}
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ===================== WEIGHT VELOCITY ===================== */
function renderVelocityChart() {
  const svg = document.getElementById('velocity-chart');
  const label = document.getElementById('velocity-label');
  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 3) { svg.innerHTML = ''; label.textContent = ''; return; }

  // Compute kg/week between consecutive entries
  const velocities = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = Math.max(1, daysBetween(sorted[i - 1].date, sorted[i].date));
    const delta = sorted[i].kg - sorted[i - 1].kg;
    const kgPerWeek = (delta / days) * 7;
    velocities.push({ date: sorted[i].date, kgPerWeek });
  }

  const recent = velocities.slice(-10);
  const avg = recent.reduce((s, v) => s + v.kgPerWeek, 0) / recent.length;
  label.textContent = `Rate of change — avg ${avg >= 0 ? '+' : ''}${avg.toFixed(2)} kg/week`;

  const w = 390, h = 60, pad = 6;
  const max = Math.max(...recent.map((v) => Math.abs(v.kgPerWeek)), 0.5);
  const midY = h / 2;
  const barW = Math.max(4, (w - pad * 2) / recent.length - 3);
  const xStep = (w - pad * 2) / (recent.length);

  svg.innerHTML = `
    <line x1="${pad}" y1="${midY}" x2="${w - pad}" y2="${midY}" stroke="#232938" stroke-width="1"/>
    ${recent.map((v, i) => {
      const x = pad + i * xStep + xStep / 2 - barW / 2;
      const barH = Math.max(3, (Math.abs(v.kgPerWeek) / max) * (midY - pad));
      const y = v.kgPerWeek <= 0 ? midY - barH : midY;
      const fill = v.kgPerWeek < -0.05 ? '#3DDC97' : v.kgPerWeek > 0.05 ? '#FF6B6B' : '#555E70';
      return `<rect x="${x}" y="${v.kgPerWeek <= 0 ? midY - barH : midY}" width="${barW}" height="${barH}" rx="2" fill="${fill}"/>`;
    }).join('')}
  `;
}

/* ===================== CORRELATION INSIGHTS ===================== */
function computeInsights() {
  const insights = [];
  const whoopDays = state.whoop && state.whoop.days ? [...state.whoop.days].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const weights = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));

  if (whoopDays.length < 14) return insights;

  // Insight 1: Recovery after dose
  if (state.jabs.length >= 2) {
    const jabDates = sortedJabs().map((j) => j.date);
    const daysAfterDose = [1, 2, 3, 4, 5, 6];
    const recByDay = {};
    daysAfterDose.forEach((d) => { recByDay[d] = []; });
    jabDates.forEach((jabDate) => {
      daysAfterDose.forEach((d) => {
        const targetDate = new Date(jabDate + 'T00:00:00');
        targetDate.setDate(targetDate.getDate() + d);
        const ds = targetDate.toISOString().slice(0, 10);
        const match = whoopDays.find((w) => w.date === ds);
        if (match && match.recovery !== null) recByDay[d].push(match.recovery);
      });
    });
    const day1_3 = [...(recByDay[1] || []), ...(recByDay[2] || []), ...(recByDay[3] || [])];
    const day4_7 = [...(recByDay[4] || []), ...(recByDay[5] || []), ...(recByDay[6] || [])];
    if (day1_3.length >= 2 && day4_7.length >= 2) {
      const avg13 = day1_3.reduce((s, v) => s + v, 0) / day1_3.length;
      const avg47 = day4_7.reduce((s, v) => s + v, 0) / day4_7.length;
      const diff = avg47 - avg13;
      if (Math.abs(diff) >= 6) {
        insights.push(`Your recovery tends to be <strong>${diff > 0 ? 'lower in the first half of your weekly cycle' : 'lower in the second half of your weekly cycle'}</strong> (avg ${num(Math.min(avg13, avg47))}% vs ${num(Math.max(avg13, avg47))}%). Worth timing hard efforts accordingly.`);
      }
    }
  }

  // Insight 2: Sleep vs next-day recovery
  const sleepRecPairs = [];
  for (let i = 0; i < whoopDays.length - 1; i++) {
    const d = whoopDays[i], next = whoopDays[i + 1];
    if (d.sleep !== null && next.recovery !== null) sleepRecPairs.push({ sleep: d.sleep, recovery: next.recovery });
  }
  if (sleepRecPairs.length >= 10) {
    const good = sleepRecPairs.filter((p) => p.sleep >= 75);
    const poor = sleepRecPairs.filter((p) => p.sleep < 55);
    if (good.length >= 4 && poor.length >= 4) {
      const avgGood = good.reduce((s, p) => s + p.recovery, 0) / good.length;
      const avgPoor = poor.reduce((s, p) => s + p.recovery, 0) / poor.length;
      const diff = avgGood - avgPoor;
      if (diff >= 8) {
        insights.push(`Nights with <strong>sleep performance above 75%</strong> are followed by ${num(diff)} points higher recovery on average (${num(avgGood)}% vs ${num(avgPoor)}%). Sleep is your biggest recovery lever.`);
      }
    }
  }

  // Insight 3: Recovery vs weight loss rate
  if (weights.length >= 6 && whoopDays.length >= 21) {
    const pairs = [];
    for (let i = 1; i < weights.length; i++) {
      const days = Math.max(1, daysBetween(weights[i - 1].date, weights[i].date));
      const delta = weights[i].kg - weights[i - 1].kg;
      const kgPerWeek = (delta / days) * 7;
      const weekDays = whoopDays.filter((d) => d.date >= weights[i - 1].date && d.date <= weights[i].date && d.recovery !== null);
      if (weekDays.length >= 3) {
        const avgRec = weekDays.reduce((s, d) => s + d.recovery, 0) / weekDays.length;
        pairs.push({ kgPerWeek, avgRec });
      }
    }
    if (pairs.length >= 4) {
      const goodRec = pairs.filter((p) => p.avgRec >= 60);
      const poorRec = pairs.filter((p) => p.avgRec < 50);
      if (goodRec.length >= 2 && poorRec.length >= 2) {
        const avgLossGood = goodRec.reduce((s, p) => s + p.kgPerWeek, 0) / goodRec.length;
        const avgLossPoor = poorRec.reduce((s, p) => s + p.kgPerWeek, 0) / poorRec.length;
        if (avgLossGood < avgLossPoor - 0.1) {
          insights.push(`Weeks with <strong>recovery above 60%</strong> tend to show better weight progression (${num(Math.abs(avgLossGood))} kg/week vs ${num(Math.abs(avgLossPoor))} kg/week when recovery is low). Your body responds better when it's well-rested.`);
        }
      }
    }
  }

  // Insight 4: High strain and next-day HRV
  const strainHrvPairs = [];
  for (let i = 0; i < whoopDays.length - 1; i++) {
    const d = whoopDays[i], next = whoopDays[i + 1];
    if (d.strain !== null && next.hrv !== null) strainHrvPairs.push({ strain: d.strain, hrv: next.hrv });
  }
  if (strainHrvPairs.length >= 10) {
    const high = strainHrvPairs.filter((p) => p.strain >= 14);
    const low = strainHrvPairs.filter((p) => p.strain < 8);
    if (high.length >= 3 && low.length >= 3) {
      const avgHrvHigh = high.reduce((s, p) => s + p.hrv, 0) / high.length;
      const avgHrvLow = low.reduce((s, p) => s + p.hrv, 0) / low.length;
      const diff = avgHrvHigh - avgHrvLow;
      if (Math.abs(diff) >= 5) {
        insights.push(`After <strong>high-strain days (14+)</strong>, your next-day HRV averages ${num(avgHrvHigh)}ms vs ${num(avgHrvLow)}ms after rest days. ${diff < 0 ? "Hard efforts suppress HRV — factor that into back-to-back days." : "Your HRV actually holds well after effort — a good sign of fitness."}`);
      }
    }
  }

  return insights;
}

function renderInsights() {
  const card = document.getElementById('insights-card');
  const list = document.getElementById('insights-list');
  const insights = computeInsights();
  if (!insights.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  list.innerHTML = insights.map((text) => `
    <div class="insight-item">
      <div class="insight-dot"></div>
      <div class="insight-text">${text}</div>
    </div>
  `).join('');
}

/* ===================== CHECK-IN SYSTEM ===================== */
function checkInThisWeek() {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const ws = weekStart.toISOString().slice(0, 10);
  return state.checkIns.find((c) => c.date >= ws) || null;
}

function renderCheckInNudge() {
  const nudge = document.getElementById('checkin-nudge');
  nudge.style.display = checkInThisWeek() ? 'none' : 'block';
}

document.getElementById('btn-open-checkin').addEventListener('click', () => {
  document.getElementById('checkin-modal').style.display = 'flex';
});
document.getElementById('btn-close-checkin').addEventListener('click', () => {
  document.getElementById('checkin-modal').style.display = 'none';
});

const energySlider = document.getElementById('ci-energy');
const appetiteSlider = document.getElementById('ci-appetite');
energySlider.addEventListener('input', () => { document.getElementById('ci-energy-val').textContent = `${energySlider.value} / 5`; });
appetiteSlider.addEventListener('input', () => { document.getElementById('ci-appetite-val').textContent = `${appetiteSlider.value} / 5`; });

document.getElementById('btn-save-checkin').addEventListener('click', () => {
  const ci = {
    id: uid(),
    date: todayStr(),
    energy: parseInt(energySlider.value),
    appetite: parseInt(appetiteSlider.value),
    note: document.getElementById('ci-note').value.trim()
  };
  state.checkIns.push(ci);
  persist('checkIns');
  document.getElementById('checkin-modal').style.display = 'none';
  document.getElementById('ci-note').value = '';
  renderAll();
  toast('Check-in saved');
});

/* ===================== WORKOUT DISPLAY ===================== */
const SPORT_EMOJI = { 'Running':'🏃','Cycling':'🚴','Walking':'🚶','Hiking':'🥾','Swimming':'🏊','Weightlifting':'🏋️','CrossFit':'💪','Yoga':'🧘','Basketball':'🏀','Soccer':'⚽','Tennis':'🎾','Rowing':'🚣','Activity':'⚡' };

function renderWorkouts() {
  const workouts = state.whoop && state.whoop.workouts ? state.whoop.workouts : [];
  const card = document.getElementById('workouts-card');
  const list = document.getElementById('workouts-list');
  if (!workouts.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  list.innerHTML = workouts.slice(0, 20).map((w) => {
    const emoji = SPORT_EMOJI[w.sport] || '⚡';
    const duration = w.duration_mins ? `${Math.round(w.duration_mins)}m` : '';
    const hr = w.avg_hr ? `${Math.round(w.avg_hr)} avg bpm` : '';
    const cals = w.calories ? `${Math.round(w.calories)} kcal` : '';
    const stats = [duration, hr, cals].filter(Boolean).join(' · ');
    return `
      <div class="workout-item">
        <div class="workout-icon">${emoji}</div>
        <div class="workout-info">
          <div class="workout-name">${w.sport}</div>
          <div class="workout-stats">${fmtDate(w.date)}${stats ? ' · ' + stats : ''}</div>
        </div>
        <div class="workout-strain">${num(w.strain)}</div>
      </div>
    `;
  }).join('');
}

/* ===================== LOG screen ===================== */
function renderWeightHistory() {
  const wrap = document.getElementById('weight-history');
  const sorted = [...state.weights].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) { wrap.innerHTML = `<div class="empty-state">No entries yet.</div>`; return; }
  wrap.innerHTML = sorted.map((w) => `
    <div class="row" style="padding:10px 0; border-bottom:1px solid var(--border);">
      <span>${fmtDate(w.date)}</span>
      <div class="row" style="gap:10px; flex:none;">
        <span class="mono">${w.kg} kg</span>
        <button class="btn btn-ghost btn-sm" data-del-weight="${w.id}" style="padding:6px 10px;">Delete</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-del-weight]').forEach((b) => {
    b.addEventListener('click', () => {
      state.weights = state.weights.filter((w) => w.id !== b.dataset.delWeight);
      persist('weights'); renderAll();
    });
  });
}

document.getElementById('btn-add-weight').addEventListener('click', () => {
  const kg = parseFloat(prompt('Weight in kg?'));
  if (!kg || isNaN(kg)) return;
  const date = prompt('Date (YYYY-MM-DD)?', todayStr()) || todayStr();
  state.weights.push({ id: uid(), date, kg });
  persist('weights');
  renderAll();
  toast('Weight logged');
});
document.getElementById('btn-log-weight').addEventListener('click', () => document.getElementById('btn-add-weight').click());

/* ===================== SETTINGS ===================== */
function renderSettings() {
  document.getElementById('set-start').value = state.goal ? state.goal.start : '';
  document.getElementById('set-goal').value = state.goal ? state.goal.goal : '';
  document.getElementById('set-apikey').value = state.apikey || '';
}
document.getElementById('btn-save-goal').addEventListener('click', () => {
  const start = parseFloat(document.getElementById('set-start').value);
  const goal = parseFloat(document.getElementById('set-goal').value);
  if (isNaN(start) || isNaN(goal)) { toast('Enter both weights'); return; }
  state.goal = { start, goal };
  persist('goal');
  renderAll();
  toast('Goal saved');
});
document.getElementById('btn-edit-goal').addEventListener('click', () => goTo('settings'));

document.getElementById('btn-save-key').addEventListener('click', () => {
  state.apikey = document.getElementById('set-apikey').value.trim();
  persist('apikey');
  toast(state.apikey ? 'API key saved' : 'API key cleared');
  renderCoachStatus();
});

/* ---- Backup / restore ---- */
document.getElementById('btn-export').addEventListener('click', () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    weights: state.weights, goal: state.goal, whoop: state.whoop,
    jabs: state.jabs, jabConfig: state.jabConfig
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drift-backup-${todayStr()}.json`;
  a.click();
  toast('Backup downloaded');
});
document.getElementById('btn-import-trigger').addEventListener('click', () => document.getElementById('backup-file').click());
document.getElementById('backup-file').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.weights) { state.weights = data.weights; persist('weights'); }
      if (data.goal) { state.goal = data.goal; persist('goal'); }
      if (data.whoop) { state.whoop = data.whoop; persist('whoop'); }
      if (data.jabs) { state.jabs = data.jabs; persist('jabs'); }
      if (data.jabConfig) { state.jabConfig = data.jabConfig; persist('jabConfig'); }
      renderAll();
      toast('Backup restored');
    } catch { toast('Could not read that file'); }
  };
  reader.readAsText(file);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Erase all Drift data on this device? This cannot be undone.')) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  state = {
    weights: [], goal: null, whoop: null, apikey: '', coachHistory: [],
    jabs: [], jabConfig: { name: 'Tirzepatide', doseMg: 7.5, intervalDays: 7, halfLifeDays: 5, site: 'Stomach – upper left' },
    milestonesSeen: [], plateauNotified: false, whoopConfig: { ...BACKEND_DEFAULTS },
    checkIns: [], supplements: [{ id: 'vitd', name: 'Vitamin D', unit: '1000 IU', log: {} }]
  };
  renderAll();
  toast('All data erased');
});

/* ---- Whoop live connection ---- */
function whoopBase() {
  return (state.whoopConfig.workerUrl || '').replace(/\/+$/, '');
}

function renderWhoopSettingsFields() {
  document.getElementById('whoop-worker-url').value = state.whoopConfig.workerUrl || BACKEND_DEFAULTS.workerUrl;
  document.getElementById('whoop-shared-key').value = state.whoopConfig.sharedKey || BACKEND_DEFAULTS.sharedKey;
}

document.getElementById('btn-save-whoop-config').addEventListener('click', () => {
  state.whoopConfig = {
    workerUrl: document.getElementById('whoop-worker-url').value.trim(),
    sharedKey: document.getElementById('whoop-shared-key').value.trim()
  };
  persist('whoopConfig');
  toast('Connection settings saved');
  checkWhoopStatus();
  sendConfigToSW();
  pullState();
});

document.getElementById('btn-connect-whoop').addEventListener('click', () => {
  const base = whoopBase();
  if (!base) { toast('Save your backend URL first'); return; }
  window.open(`${base}/auth/whoop/start`, '_blank');
});

document.getElementById('btn-sync-whoop').addEventListener('click', () => syncWhoop(true));

async function checkWhoopStatus() {
  const base = whoopBase();
  const pill = document.getElementById('whoop-connect-status');
  if (!base || !state.whoopConfig.sharedKey) { pill.textContent = 'not set up'; return; }
  try {
    const res = await fetch(`${base}/api/whoop/status`, { headers: { 'X-Drift-Key': state.whoopConfig.sharedKey } });
    if (!res.ok) { pill.textContent = res.status === 401 ? 'wrong shared key' : 'error'; return; }
    const data = await res.json();
    pill.textContent = data.connected ? 'connected' : 'not connected';
  } catch {
    pill.textContent = 'unreachable';
  }
}

async function syncWhoop(showToast) {
  const base = whoopBase();
  if (!base || !state.whoopConfig.sharedKey) { if (showToast) toast('Set up your Whoop connection in Settings first'); return; }
  try {
    const res = await fetch(`${base}/api/whoop/sync`, { headers: { 'X-Drift-Key': state.whoopConfig.sharedKey } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (showToast) toast(body.error === 'not_connected' ? 'Connect Whoop first' : `Sync failed: ${body.error || res.status}`);
      return;
    }
    const data = await res.json();
    state.whoop = {
      importedAt: new Date().toISOString(),
      days: data.days || [],
      workouts: data.workouts || state.whoop?.workouts || []
    };
    persist('whoop');
    renderAll();
    if (showToast) toast(`Synced — ${data.synced || 0} days updated`);
  } catch {
    if (showToast) toast('Could not reach your Whoop backend');
  }
}

document.getElementById('btn-backfill-whoop').addEventListener('click', backfillWhoopHistory);

async function backfillWhoopHistory() {
  const base = whoopBase();
  const progressEl = document.getElementById('whoop-backfill-progress');
  if (!base || !state.whoopConfig.sharedKey) { toast('Set up your Whoop connection in Settings first'); return; }

  let cursor = '';
  let totalFetched = 0;
  let pages = 0;
  const maxPages = 200; // safety cap — ~5000 cycles, generously more than any real history

  progressEl.textContent = 'Starting full history sync…';
  while (pages < maxPages) {
    pages++;
    try {
      const url = `${base}/api/whoop/backfill${cursor ? `?cycleToken=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetch(url, { headers: { 'X-Drift-Key': state.whoopConfig.sharedKey } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(`Backfill stopped: ${body.error || res.status}`);
        break;
      }
      const data = await res.json();
      totalFetched += data.fetched || 0;
      state.whoop = {
        importedAt: new Date().toISOString(),
        days: data.days || [],
        workouts: data.workouts || state.whoop?.workouts || []
      };
      persist('whoop');
      renderHome();
      if (document.getElementById('screen-whoop-detail').classList.contains('active')) renderWhoopDetail();
      progressEl.textContent = `Fetched ${totalFetched} days so far (page ${pages})…`;

      if (!data.nextToken) {
        progressEl.textContent = `Done — ${state.whoop.days.length} total days of history.`;
        toast('Full history loaded');
        renderMilestones();
        return;
      }
      cursor = data.nextToken;
    } catch {
      toast('Lost connection during backfill — tap "Load full history" again to retry (it restarts from the top, but synced days are already saved so nothing is lost).');
      break;
    }
  }
  if (pages >= maxPages) progressEl.textContent = `Stopped after ${totalFetched} days (safety limit) — tap again if you need to go further back.`;
}

/* ===================== CLOUD STATE SYNC ===================== */
// The data-loss fix: everything except the Whoop cache and the connection
// settings themselves gets mirrored to the backend, debounced so rapid edits
// don't hammer the Worker. On launch, the cloud copy is treated as the source
// of truth (if one exists) so a reinstalled or new device picks up right
// where you left off.

const SYNCED_KEYS = ['weights', 'goal', 'jabs', 'jabConfig', 'milestonesSeen', 'plateauNotified', 'coachHistory', 'apikey', 'checkIns', 'supplements'];
let pushStateTimer = null;

function pushStateDebounced() {
  clearTimeout(pushStateTimer);
  pushStateTimer = setTimeout(pushState, 1500);
}

async function pushState() {
  const base = whoopBase();
  if (!base || !state.whoopConfig.sharedKey) return;
  const payload = {};
  SYNCED_KEYS.forEach((k) => { payload[k] = state[k]; });
  try {
    await fetch(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Drift-Key': state.whoopConfig.sharedKey },
      body: JSON.stringify(payload)
    });
  } catch {
    // Offline or unreachable — fine, the next edit will retry, and localStorage still has it.
  }
}

async function pullState() {
  const base = whoopBase();
  if (!base || !state.whoopConfig.sharedKey) return;
  try {
    const res = await fetch(`${base}/api/state`, { headers: { 'X-Drift-Key': state.whoopConfig.sharedKey } });
    if (!res.ok) return;
    const { data } = await res.json();
    if (data) {
      SYNCED_KEYS.forEach((k) => {
        if (data[k] !== undefined) { state[k] = data[k]; store.set(KEYS[k], data[k]); }
      });
      renderAll();
      toast('Synced your data from the cloud');
    } else {
      // Nothing saved remotely yet — this device's local data becomes the seed.
      pushState();
    }
  } catch {
    // Offline — just keep using whatever's local.
  }
}

/* ===================== PUSH NOTIFICATIONS ===================== */

const VAPID_PUBLIC_KEY = 'BF2S7q69ULr0vV2Q-UIke60keg9P1JOLf6TU4eaK-Bb-71syfnkX3dFz37MnSEFnPlhhtNlul4RAffQDskUtg5Y';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function sendConfigToSW() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'drift-config',
      workerUrl: state.whoopConfig.workerUrl,
      sharedKey: state.whoopConfig.sharedKey
    });
  }
}

async function renderPushStatus() {
  const el = document.getElementById('push-status');
  if (!el) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { el.textContent = 'not supported'; return; }
  if (Notification.permission === 'denied') { el.textContent = 'blocked — check iOS notification settings'; return; }
  if (Notification.permission !== 'granted') { el.textContent = 'not enabled'; return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    el.textContent = sub ? 'enabled' : 'not enabled';
  } catch {
    el.textContent = 'not enabled';
  }
}

document.getElementById('btn-enable-push').addEventListener('click', async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Push notifications are not supported in this browser');
    return;
  }
  const base = whoopBase();
  if (!base || !state.whoopConfig.sharedKey) {
    toast('Set up your Whoop backend connection above first — reminders use the same backend');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notification permission was not granted'); renderPushStatus(); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    }
    await fetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Drift-Key': state.whoopConfig.sharedKey },
      body: JSON.stringify(sub.toJSON())
    });
    sendConfigToSW();
    toast('Reminders enabled');
  } catch (err) {
    toast('Could not enable reminders: ' + err.message);
  }
  renderPushStatus();
});

document.getElementById('btn-disable-push').addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const base = whoopBase();
      if (base && state.whoopConfig.sharedKey) {
        await fetch(`${base}/api/push/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Drift-Key': state.whoopConfig.sharedKey },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      }
      await sub.unsubscribe();
    }
    toast('Reminders disabled');
  } catch (err) {
    toast('Could not disable reminders: ' + err.message);
  }
  renderPushStatus();
});

document.getElementById('btn-test-push').addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Test notification', {
      body: 'If you can see this, Drift can show you notifications.',
      icon: './icons/icon-192.png'
    });
  } catch (err) {
    toast('Could not show a test notification: ' + err.message);
  }
});

/* ===================== SUPPLEMENTS ===================== */
function renderSupplements() {
  const wrap = document.getElementById('supplement-list');
  if (!wrap) return;
  const ds = todayStr();
  if (!state.supplements.length) {
    wrap.innerHTML = `<div class="empty-state">No supplements added yet.</div>`;
    return;
  }
  wrap.innerHTML = state.supplements.map((s) => {
    const taken = !!(s.log && s.log[ds]);
    return `
      <div class="supplement-item">
        <div>
          <div class="supplement-name">${esc(s.name)}</div>
          <div class="supplement-meta">${esc(s.unit)} · ${taken ? 'taken today ✓' : 'not yet today'}</div>
        </div>
        <div class="supplement-actions">
          <div class="supplement-toggle ${taken ? 'on' : ''}" data-sup="${s.id}">
            <div class="knob"></div>
          </div>
          <button class="btn btn-ghost btn-sm" data-del-sup="${s.id}" style="padding:4px 9px;">✕</button>
        </div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-sup]').forEach((t) => {
    t.addEventListener('click', () => toggleSupplement(t.dataset.sup));
  });
  wrap.querySelectorAll('[data-del-sup]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!confirm(`Remove ${state.supplements.find((s) => s.id === b.dataset.delSup)?.name}?`)) return;
      state.supplements = state.supplements.filter((s) => s.id !== b.dataset.delSup);
      persist('supplements'); renderAll();
    });
  });
}

function toggleSupplement(supId) {
  const s = state.supplements.find((x) => x.id === supId);
  if (!s) return;
  const ds = todayStr();
  s.log = s.log || {};
  s.log[ds] = !s.log[ds];
  persist('supplements');
  renderSupplements();
}

document.getElementById('btn-add-supplement').addEventListener('click', () => {
  const name = prompt('Supplement name?');
  if (!name) return;
  const unit = prompt('Amount / unit? (e.g. 1000 IU, 500mg)', '') || '';
  state.supplements.push({ id: uid(), name, unit, log: {} });
  persist('supplements');
  renderAll();
});

/* ===================== JABS ===================== */
function sortedJabs() { return [...state.jabs].sort((a, b) => a.date.localeCompare(b.date)); }

function daysBetween(d1, d2) {
  return (new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / 86400000;
}

// Estimated mg in system on a given date, summing exponential decay of every prior jab.
function mgInSystemOn(dateStr) {
  const hl = state.jabConfig.halfLifeDays || 5;
  return sortedJabs().reduce((sum, j) => {
    const t = daysBetween(j.date, dateStr);
    if (t < 0) return sum;
    return sum + j.doseMg * Math.pow(0.5, t / hl);
  }, 0);
}

function nearestWeightTo(dateStr, windowDays = 3) {
  let best = null, bestDist = Infinity;
  state.weights.forEach((w) => {
    const dist = Math.abs(daysBetween(w.date, dateStr));
    if (dist <= windowDays && dist < bestDist) { best = w; bestDist = dist; }
  });
  return best;
}

function renderJabs() {
  document.getElementById('jabs-sub').textContent = state.jabConfig.name || 'Injections';
  const jabs = sortedJabs();
  const last = jabs.at(-1);

  // Next jab card
  if (last) {
    const due = new Date(last.date + 'T00:00:00');
    due.setDate(due.getDate() + (state.jabConfig.intervalDays || 7));
    const dueStr = due.toISOString().slice(0, 10);
    const daysLeft = Math.round(daysBetween(todayStr(), dueStr));
    document.getElementById('jab-due-pill').textContent = daysLeft > 0 ? `in ${daysLeft}d` : daysLeft === 0 ? 'today' : `${-daysLeft}d ago`;
  } else {
    document.getElementById('jab-due-pill').textContent = 'not yet logged';
  }
  document.getElementById('jab-next-dose').textContent = `${state.jabConfig.doseMg}mg ${state.jabConfig.name}`;
  document.getElementById('jab-next-site').textContent = state.jabConfig.site || '';

  // In your system
  renderDecayChart();

  // Total change
  if (jabs.length) {
    const firstW = nearestWeightTo(jabs[0].date, 6);
    const latestW = latestWeight();
    const changeEl = document.getElementById('jab-total-change');
    if (firstW && latestW) {
      const delta = (latestW.kg - firstW.kg);
      changeEl.textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`;
      changeEl.style.color = delta < 0 ? 'var(--good)' : delta > 0 ? 'var(--danger)' : 'var(--text)';
    } else {
      changeEl.textContent = '—';
      changeEl.style.color = 'var(--text)';
    }
  } else {
    document.getElementById('jab-total-change').textContent = '—';
  }
  document.getElementById('jab-count').textContent = jabs.length;

  renderJabHistory();
}

function renderDecayChart() {
  const svg = document.getElementById('jab-decay-chart');
  const w = 390, h = 160;
  const padL = 8, padR = 8, padTop = 38, padBottom = 24;
  if (!state.jabs.length) {
    svg.innerHTML = `<text x="195" y="84" fill="#555E70" font-size="12" text-anchor="middle" font-family="Inter">start logging to see this</text>`;
    return;
  }

  const days = 28;
  const jabs = sortedJabs();
  const lastJab = jabs.at(-1);
  const startDate = new Date(); startDate.setDate(startDate.getDate() - days);

  const points = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(startDate); d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    points.push({ date: ds, mg: mgInSystemOn(ds) });
  }
  const maxMg = Math.max(...points.map((p) => p.mg), state.jabConfig.doseMg);
  const innerW = w - padL - padR, innerH = h - padTop - padBottom;
  const xStep = innerW / (points.length - 1);
  const xAt = (i) => padL + i * xStep;
  const yAt = (mg) => padTop + innerH - (mg / maxMg) * innerH;

  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.mg) }));

  // Smooth curve through midpoints (quadratic segments) — softer than straight joins
  let curve = `M${coords[0].x},${coords[0].y} `;
  for (let i = 0; i < coords.length - 1; i++) {
    const c0 = coords[i], c1 = coords[i + 1];
    const midX = (c0.x + c1.x) / 2, midY = (c0.y + c1.y) / 2;
    curve += `Q${c0.x},${c0.y} ${midX},${midY} `;
  }
  curve += `L${coords.at(-1).x},${coords.at(-1).y}`;
  const area = `M${padL},${h - padBottom} L` + coords.map((c) => `${c.x},${c.y}`).join(' L') + ` L${w - padR},${h - padBottom} Z`;

  // Marker for the most recent jab
  const lastJabIdx = points.findIndex((p) => p.date === lastJab.date);
  const markerX = lastJabIdx >= 0 ? xAt(lastJabIdx) : null;
  const peakMg = Math.max(...points.map((p) => p.mg));

  const fmtShort = (ds) => new Date(ds + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  svg.innerHTML = `
    <defs>
      <linearGradient id="decayGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#3D7BFF"/>
        <stop offset="100%" stop-color="#FF5C93"/>
      </linearGradient>
      <linearGradient id="decayFill" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FF5C93" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="#3D7BFF" stop-opacity="0.02"/>
      </linearGradient>
    </defs>

    <!-- axis baseline -->
    <line x1="${padL}" y1="${h - padBottom}" x2="${w - padR}" y2="${h - padBottom}" stroke="#232938" stroke-width="1"/>

    ${markerX !== null ? `<line x1="${markerX}" y1="${padTop - 14}" x2="${markerX}" y2="${h - padBottom}" stroke="#3D7BFF" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.7"/>` : ''}

    <path d="${area}" fill="url(#decayFill)" stroke="none"/>
    <path d="${curve}" fill="none" stroke="url(#decayGrad)" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    <path d="${curve}" fill="none" stroke="#FF8FB4" stroke-width="3.6" stroke-dasharray="0.1 8" stroke-linecap="round"/>

    ${markerX !== null ? `
      <text x="${Math.min(Math.max(markerX, 38), w - 60)}" y="${padTop - 22}" fill="#F2F4F8" font-size="12" font-weight="600" text-anchor="middle" font-family="Inter">${fmtShort(lastJab.date)}</text>
      <text x="${Math.min(Math.max(markerX, 38), w - 60)}" y="${padTop - 8}" fill="#8B93A7" font-size="10.5" text-anchor="middle" font-family="JetBrains Mono">${fmtShort(lastJab.date)}</text>
    ` : ''}

    <text x="${padL}" y="${padTop - 22}" fill="#8B93A7" font-size="11.5" text-anchor="start" font-family="JetBrains Mono">${peakMg.toFixed(1)}mg (est)</text>
    <text x="${padL}" y="${padTop - 9}" fill="#555E70" font-size="10" text-anchor="start" font-family="Inter">peak</text>

    <text x="${padL}" y="${h - 6}" fill="#555E70" font-size="11" font-family="Inter">${fmtShort(points[0].date)}</text>
    <text x="${w - padR}" y="${h - 6}" fill="#555E70" font-size="11" text-anchor="end" font-family="Inter">${fmtShort(points.at(-1).date)}</text>
  `;
}

function renderJabHistory() {
  const wrap = document.getElementById('jab-history');
  const jabs = sortedJabs().reverse();
  if (!jabs.length) { wrap.innerHTML = `<div class="empty-state">No history yet.</div>`; return; }
  let prevWeight = null;
  // compute deltas in chronological order first
  const chrono = [...jabs].reverse();
  const deltas = {};
  chrono.forEach((j) => {
    const w = nearestWeightTo(j.date, 6);
    if (w && prevWeight) deltas[j.id] = w.kg - prevWeight.kg;
    if (w) prevWeight = w;
  });

  wrap.innerHTML = jabs.map((j) => {
    const w = nearestWeightTo(j.date, 6);
    const delta = deltas[j.id];
    let deltaHtml = '';
    if (delta !== undefined) {
      const cls = delta < 0 ? 'jab-delta-down' : delta > 0 ? 'jab-delta-up' : '';
      deltaHtml = ` · <span class="${cls}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}kg since last</span>`;
    }
    return `
      <div class="jab-history-item">
        <div class="jab-history-top">
          <span class="jab-history-date">${fmtDate(j.date)}</span>
          <button class="btn btn-ghost btn-sm" data-del-jab="${j.id}" style="padding:4px 9px;">✕</button>
        </div>
        <div class="jab-history-dose">${j.doseMg}mg ${esc(state.jabConfig.name)}</div>
        <div class="jab-history-site">${esc(j.site || '')}</div>
        <div class="jab-history-weight">${w ? `${w.kg}kg logged` : 'no weight logged nearby'}${deltaHtml}</div>
      </div>`;
  }).join('');
  wrap.querySelectorAll('[data-del-jab]').forEach((b) => {
    b.addEventListener('click', () => {
      state.jabs = state.jabs.filter((j) => j.id !== b.dataset.delJab);
      persist('jabs'); renderAll();
    });
  });
}

document.getElementById('btn-log-jab').addEventListener('click', () => {
  const date = prompt('Date (YYYY-MM-DD)?', todayStr()) || todayStr();
  const doseMg = parseFloat(prompt('Amount (mg)?', state.jabConfig.doseMg)) || state.jabConfig.doseMg;
  const site = prompt('Site?', state.jabConfig.site) || state.jabConfig.site;
  state.jabs.push({ id: uid(), date, doseMg, site });
  persist('jabs');
  const logWeight = confirm('Also log weight for this date?');
  if (logWeight) {
    const kg = parseFloat(prompt('Weight in kg?'));
    if (kg && !isNaN(kg)) { state.weights.push({ id: uid(), date, kg }); persist('weights'); }
  }
  renderAll();
  toast('Logged');
});

document.getElementById('btn-jab-settings').addEventListener('click', () => goTo('settings'));

function renderJabSettings() {
  document.getElementById('jset-name').value = state.jabConfig.name;
  document.getElementById('jset-dose').value = state.jabConfig.doseMg;
  document.getElementById('jset-interval').value = state.jabConfig.intervalDays;
  document.getElementById('jset-halflife').value = state.jabConfig.halfLifeDays;
  document.getElementById('jset-site').value = state.jabConfig.site;
}
document.getElementById('btn-save-jab-settings').addEventListener('click', () => {
  state.jabConfig = {
    name: document.getElementById('jset-name').value.trim() || 'Tirzepatide',
    doseMg: parseFloat(document.getElementById('jset-dose').value) || 7.5,
    intervalDays: parseInt(document.getElementById('jset-interval').value) || 7,
    halfLifeDays: parseFloat(document.getElementById('jset-halflife').value) || 5,
    site: document.getElementById('jset-site').value.trim()
  };
  persist('jabConfig');
  renderAll();
  toast('Medication settings saved');
});

/* ===================== MILESTONES ===================== */
function earliestRecordDate() {
  const dates = [...state.weights.map((w) => w.date), ...state.jabs.map((j) => j.date)];
  return dates.length ? dates.sort()[0] : null;
}

function pctChangeFromGoalStart() {
  if (!state.goal || !state.goal.start) return null;
  const latest = latestWeight();
  if (!latest) return null;
  return ((latest.kg - state.goal.start) / state.goal.start) * 100;
}

function whoopRecoveryStreak() {
  if (!state.whoop || !state.whoop.days.length) return 0;
  const sorted = [...state.whoop.days].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const d of sorted) {
    if (d.recovery !== null && d.recovery !== undefined && d.recovery >= 67) streak++;
    else break;
  }
  return streak;
}

const MILESTONES = [
  { id: 'first_weight', label: 'First weigh-in', icon: 'scale', check: () => state.weights.length >= 1 },
  { id: 'weigh_4', label: '4 weigh-ins logged', icon: 'scale', check: () => state.weights.length >= 4 },
  { id: 'weigh_12', label: '12 weigh-ins logged', icon: 'scale', check: () => state.weights.length >= 12 },
  { id: 'goal_set', label: 'Goal set', icon: 'flag', check: () => !!(state.goal && state.goal.goal) },
  { id: 'first_jab', label: 'First dose logged', icon: 'jab', check: () => state.jabs.length >= 1 },
  { id: 'jab_streak_4', label: '4 weeks on schedule', icon: 'jab', check: () => jabStreak() >= 4 },
  { id: 'jab_streak_12', label: '12 weeks on schedule', icon: 'jab', check: () => jabStreak() >= 12 },
  { id: 'change_5', label: '5% change reached', icon: 'star', check: () => { const p = pctChangeFromGoalStart(); return p !== null && Math.abs(p) >= 5; } },
  { id: 'change_10', label: '10% change reached', icon: 'star', check: () => { const p = pctChangeFromGoalStart(); return p !== null && Math.abs(p) >= 10; } },
  { id: 'three_months', label: '3 months in Drift', icon: 'clock', check: () => { const e = earliestRecordDate(); return e && daysBetween(e, todayStr()) >= 90; } },
  { id: 'whoop_connected', label: 'Whoop connected', icon: 'whoop', check: () => !!(state.whoop && state.whoop.days.length >= 1) },
  { id: 'whoop_week', label: '7 days of Whoop data', icon: 'whoop', check: () => !!(state.whoop && state.whoop.days.length >= 7) },
  { id: 'whoop_month', label: '30 days of Whoop data', icon: 'whoop', check: () => !!(state.whoop && state.whoop.days.length >= 30) },
  { id: 'recovery_streak_3', label: '3 days green recovery', icon: 'whoop', check: () => whoopRecoveryStreak() >= 3 }
];

const MILESTONE_ICONS = {
  scale: '<path d="M12 3v2M5 21h14M7 21V9a5 5 0 0110 0v12"/>',
  flag: '<path d="M5 21V4M5 4h13l-3 4 3 4H5"/>',
  whoop: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  jab: '<path d="M19 3l2 2-2 2M13 9l6-6M5 19l4-1 9-9-3-3-9 9-1 4z"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'
};

function renderMilestones() {
  const earned = MILESTONES.filter((m) => m.check());
  const earnedIds = earned.map((m) => m.id);
  document.getElementById('milestone-count').textContent = `${earned.length} of ${MILESTONES.length}`;

  document.getElementById('milestone-row').innerHTML = MILESTONES.map((m) => {
    const isEarned = earnedIds.includes(m.id);
    return `
      <div class="milestone-item ${isEarned ? 'earned' : ''}">
        <div class="milestone-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="${isEarned ? '#0B0E13' : '#555E70'}" stroke-width="2">${MILESTONE_ICONS[m.icon]}</svg>
        </div>
        <div class="milestone-label">${m.label}</div>
      </div>`;
  }).join('');

  const next = MILESTONES.find((m) => !earnedIds.includes(m.id));
  document.getElementById('milestone-next').textContent = next ? `Next: ${next.label}` : 'All current milestones earned — nice work.';

  // Notify on newly earned milestones since last render
  const newlyEarned = earnedIds.filter((id) => !state.milestonesSeen.includes(id));
  if (newlyEarned.length) {
    const label = MILESTONES.find((m) => m.id === newlyEarned[0]).label;
    toast(`Milestone unlocked: ${label}`);
    state.milestonesSeen = earnedIds;
    persist('milestonesSeen');
  }
}

/* ===================== PLATEAU DETECTION ===================== */
// Looks at the last few weigh-ins; if they span 3+ weeks and barely moved, flags a plateau.
function detectPlateau() {
  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 3) return null;
  const recent = sorted.slice(-4);
  const span = daysBetween(recent[0].date, recent.at(-1).date);
  if (span < 18) return null;
  const vals = recent.map((w) => w.kg);
  const range = Math.max(...vals) - Math.min(...vals);
  const threshold = Math.max(0.5, vals[0] * 0.006); // ~0.6% of bodyweight or 0.5kg, whichever is larger
  if (range > threshold) return null;
  return { weeks: Math.round(span / 7), range };
}

function renderPlateau() {
  const p = detectPlateau();
  const card = document.getElementById('plateau-card');
  if (!p) {
    card.style.display = 'none';
    document.getElementById('plateau-pill').style.display = 'none';
    if (state.plateauNotified) { state.plateauNotified = false; persist('plateauNotified'); }
    return;
  }
  card.style.display = 'block';
  document.getElementById('plateau-weeks').textContent = p.weeks;
  document.getElementById('plateau-detail').textContent =
    `Your weight has stayed within ${p.range.toFixed(1)}kg for about ${p.weeks} weeks. That's normal — bodies hold steady sometimes, especially with consistent training. Worth checking: recovery trend, sleep, and whether your medication schedule has stayed consistent, before changing anything drastically.`;

  document.getElementById('plateau-pill').style.display = 'inline-flex';
  document.getElementById('plateau-pill').textContent = `steady ${p.weeks}w`;

  if (!state.plateauNotified) {
    state.coachHistory.push({
      role: 'ai',
      text: `I noticed your weight's been steady for about ${p.weeks} weeks (within ${p.range.toFixed(1)}kg). That's a normal plateau, not a failure — ${state.whoop && state.whoop.days.length ? "worth glancing at your recovery trend, " : ''}and worth keeping your routine consistent for another couple of weeks before changing anything. Want a refreshed plan?`
    });
    state.plateauNotified = true;
    persist('plateauNotified');
    persist('coachHistory');
  }
}

/* ===================== COACH ===================== */
let planType = 'run';
document.getElementById('plan-tab-run').addEventListener('click', () => { planType = 'run'; renderPlanForm(); });
document.getElementById('plan-tab-walk').addEventListener('click', () => { planType = 'walk'; renderPlanForm(); });

function renderPlanForm() {
  document.getElementById('plan-tab-run').className = 'btn btn-sm ' + (planType === 'run' ? 'btn-primary' : 'btn-ghost');
  document.getElementById('plan-tab-walk').className = 'btn btn-sm ' + (planType === 'walk' ? 'btn-primary' : 'btn-ghost');
  const form = document.getElementById('plan-form');
  if (planType === 'run') {
    form.innerHTML = `
      <div class="field"><label>Current ability</label>
        <select id="pf-level"><option value="beginner">New to running</option><option value="some">Run sometimes</option><option value="regular">Run regularly</option></select>
      </div>
      <div class="field"><label>Goal</label>
        <select id="pf-goal"><option value="5k">Run a 5K</option><option value="10k">Run a 10K</option><option value="fitness">General fitness</option></select>
      </div>
      <div class="field"><label>Days per week</label><input type="number" id="pf-days" value="3" min="2" max="6"></div>
    `;
  } else {
    form.innerHTML = `
      <div class="field"><label>Current habit</label>
        <select id="pf-level"><option value="beginner">Mostly sedentary</option><option value="some">Walk occasionally</option><option value="regular">Walk daily</option></select>
      </div>
      <div class="field"><label>Goal</label>
        <select id="pf-goal"><option value="steps">Hit a daily step target</option><option value="distance">Build up distance</option><option value="habit">Build a consistent habit</option></select>
      </div>
      <div class="field"><label>Days per week</label><input type="number" id="pf-days" value="5" min="3" max="7"></div>
    `;
  }
}
renderPlanForm();

document.getElementById('btn-make-plan').addEventListener('click', () => {
  const level = document.getElementById('pf-level').value;
  const goal = document.getElementById('pf-goal').value;
  const days = parseInt(document.getElementById('pf-days').value) || 3;
  const plan = generatePlan(planType, level, goal, days);
  document.getElementById('plan-output-card').style.display = 'block';
  document.getElementById('plan-output').innerHTML = plan;
});

function generatePlan(type, level, goal, days) {
  const recovery = state.whoop && state.whoop.days.length ? [...state.whoop.days].sort((a,b)=>a.date.localeCompare(b.date)).at(-1).recovery : null;
  const note = recovery !== null && recovery !== undefined
    ? `<div class="sub" style="margin-bottom:10px;">Your last logged recovery was ${num(recovery)}% — ${recovery < 40 ? 'plan starts easier than usual to account for that' : 'factored in as normal load'}.</div>`
    : '';
  let weeks = [];
  if (type === 'run') {
    const base = level === 'beginner' ? ['Walk 5m, jog 1m ×6', 'Rest', 'Walk 5m, jog 1m ×6', 'Rest', 'Easy 20m walk', 'Rest', 'Rest']
               : level === 'some' ? ['Jog 20m easy', 'Rest', 'Jog 25m easy', 'Rest', 'Intervals: 5×2m hard/2m easy', 'Long jog 30m', 'Rest']
               : ['Easy 30m', 'Tempo 20m', 'Rest', 'Intervals 6×3m', 'Easy 25m', 'Long run 45m', 'Rest'];
    for (let w = 1; w <= 4; w++) {
      weeks.push({ label: `Week ${w}`, days: base.slice(0, days).map((d, i) => scaleSession(d, w)) });
    }
  } else {
    const base = level === 'beginner' ? ['10m gentle walk','Rest','10m gentle walk','Rest','15m walk','Rest','Rest']
               : level === 'some' ? ['20m walk','Rest','25m brisk walk','20m walk','Rest','30m walk','Rest']
               : ['30m brisk walk','30m walk','Rest','35m brisk walk','30m walk','40m walk','Rest'];
    for (let w = 1; w <= 4; w++) {
      weeks.push({ label: `Week ${w}`, days: base.slice(0, days).map((d, i) => scaleSession(d, w)) });
    }
  }
  return note + weeks.map((wk) => `
    <div class="coach-plan">
      <div class="day">${wk.label}</div>
      ${wk.days.map((d, i) => `<div class="sub">Day ${i+1}: ${d}</div>`).join('')}
    </div>
  `).join('') + `<div class="sub" style="margin-top:10px;">Goal focus: ${labelForGoal(goal)}. Adjust down anytime your recovery or energy says to.</div>`;
}
function scaleSession(text, week) {
  if (text === 'Rest') return text;
  // crude progression: add a little volume each week
  return `${text}${week > 1 ? ` (+${(week-1)*10}% vs week 1)` : ''}`;
}
function labelForGoal(g) {
  const map = { '5k':'building to a 5K', '10k':'building to a 10K', fitness:'general fitness', steps:'daily step target', distance:'building walking distance', habit:'consistency over intensity' };
  return map[g] || g;
}

/* ---- Coach chat ---- */
function renderCoachStatus() {
  document.getElementById('ai-status').textContent = state.apikey ? 'AI connected' : 'local mode';
}
function renderCoachChat() {
  const wrap = document.getElementById('coach-chat');
  wrap.innerHTML = state.coachHistory.map((m) =>
    `<div class="coach-msg ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'ai' ? renderMarkdownLite(m.text) : esc(m.text)}</div>`
  ).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

// Minimal, dependency-free markdown rendering for coach replies — escapes
// everything first so the only HTML present is what we deliberately insert,
// then handles headers, bold/italic, and bullet lists, which covers the vast
// majority of how Claude formats short structured answers.
function renderMarkdownLite(raw) {
  let text = esc(raw);
  text = text.replace(/^### (.*)$/gm, '<div class="coach-h3">$1</div>');
  text = text.replace(/^## (.*)$/gm, '<div class="coach-h2">$1</div>');
  text = text.replace(/^# (.*)$/gm, '<div class="coach-h2">$1</div>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/(^|\n)((?:[-•] .*(?:\n|$))+)/g, (m, lead, block) => {
    const items = block.trim().split('\n').map((l) => `<li>${l.replace(/^[-•]\s*/, '')}</li>`).join('');
    return `${lead}<ul class="coach-list">${items}</ul>`;
  });
  text = text.replace(/\n/g, '<br>');
  text = text.replace(/(<\/div>|<\/ul>)(<br>)+/g, '$1');
  return text;
}

document.getElementById('coach-send').addEventListener('click', sendCoachMsg);
document.getElementById('coach-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCoachMsg(); });

async function sendCoachMsg() {
  const input = document.getElementById('coach-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  state.coachHistory.push({ role: 'user', text });
  persist('coachHistory');
  renderCoachChat();

  if (state.apikey) {
    state.coachHistory.push({ role: 'ai', text: '…' });
    renderCoachChat();
    try {
      const reply = await askClaude(text);
      state.coachHistory[state.coachHistory.length - 1] = { role: 'ai', text: reply };
    } catch (err) {
      state.coachHistory[state.coachHistory.length - 1] = { role: 'ai', text: `Couldn't reach the AI coach (${err.message}). Check your API key in Settings.` };
    }
  } else {
    state.coachHistory.push({ role: 'ai', text: localCoachReply(text) });
  }
  persist('coachHistory');
  renderCoachChat();
}

function buildContext() {
  const sortedW = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedW.at(-1);
  const first = sortedW[0];

  const pctMoved = pctChangeFromGoalStart();
  const goalLine = state.goal
    ? `Goal: ${state.goal.start}kg -> ${state.goal.goal}kg${pctMoved !== null ? ` (${num(Math.abs(pctMoved))}% of body weight moved so far)` : ''}.`
    : 'No weight goal set yet.';

  const weightLine = latest
    ? `Weight: latest ${latest.kg}kg on ${latest.date}${sortedW.length > 1 ? `, started tracking at ${first.kg}kg on ${first.date} (${sortedW.length} entries total)` : ''}.`
    : 'No weight entries logged yet.';

  let whoopLine = 'No Whoop data connected.';
  if (state.whoop && state.whoop.days.length) {
    const days = [...state.whoop.days].sort((a, b) => a.date.localeCompare(b.date));
    const last = days.at(-1);
    const avg = (arr, key) => { const v = arr.map((d) => d[key]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const last7 = avg(days.slice(-7), 'recovery');
    const prev7 = avg(days.slice(-14, -7), 'recovery');
    whoopLine = `Whoop today: recovery ${num(last.recovery)}%, sleep ${num(last.sleep)}%, strain ${num(last.strain)}, HRV ${num(last.hrv)}ms, RHR ${num(last.rhr)}bpm. ` +
      `7-day avg recovery ${last7 !== null ? num(last7) + '%' : 'n/a'}${prev7 !== null ? ` vs ${num(prev7)}% the 7 days before that` : ''}. (${days.length} days of history synced.)`;
  }

  let jabLine = 'No medication logged yet.';
  if (state.jabs.length) {
    const jabs = sortedJabs();
    const last = jabs.at(-1);
    const due = new Date(last.date + 'T00:00:00');
    due.setDate(due.getDate() + (state.jabConfig.intervalDays || 7));
    jabLine = `${state.jabConfig.name}, ${state.jabConfig.doseMg}mg every ${state.jabConfig.intervalDays} days. Last taken ${last.date}, next ${due.toISOString().slice(0, 10)}. ` +
      `On-schedule streak: ${jabStreak()} in a row. ${jabs.length} total.`;
  }

  const plateau = detectPlateau();
  const plateauLine = plateau ? `Plateau flag: weight has stayed within ${num(plateau.range)}kg for about ${plateau.weeks} weeks.` : '';

  const thisCI = checkInThisWeek();
  const ciLine = thisCI
    ? `Weekly check-in (this week): energy ${thisCI.energy}/5, appetite ${thisCI.appetite}/5${thisCI.note ? `, note: "${thisCI.note}"` : ''}.`
    : state.checkIns.length ? `Last check-in: energy ${state.checkIns.at(-1).energy}/5, appetite ${state.checkIns.at(-1).appetite}/5.` : '';

  return [goalLine, weightLine, whoopLine, jabLine, plateauLine, ciLine].filter(Boolean).join(' ');
}

async function askClaude(userText) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.apikey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 650,
      system: `You are Drift's AI coach — sharp, supportive, and direct, with full access to this person's real tracked data below. Always reference their actual numbers; never give generic advice that could apply to anyone. For substantive answers, use a short bold headline, then 2-4 bullet points citing specific figures, then one clear, concrete recommendation for today. Keep simple questions short (2-4 sentences, no headers needed). Don't just restate their numbers back — interpret them and say what to actually do. Avoid medical claims; you're a coach, not a clinician.\n\n${buildContext()}`,
      messages: [{ role: 'user', content: userText }]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status}${body ? ': ' + body.slice(0,120) : ''}`);
  }
  const data = await res.json();
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() || 'No response.';
}

function localCoachReply(text) {
  const latest = latestWeight();
  const lower = text.toLowerCase();
  if (lower.includes('plan') || lower.includes('run') || lower.includes('walk')) {
    return `Use the "Build a plan" card above — pick Running or Walking, your level, and a goal, and I'll generate a 4-week progression. Add your own Anthropic API key in Settings for fully personalized AI coaching.`;
  }
  if (state.whoop && state.whoop.days.length) {
    const days = [...state.whoop.days].sort((a, b) => a.date.localeCompare(b.date));
    const w = days.at(-1);
    if (lower.includes('recover') || lower.includes('stat') || lower.includes('whoop')) {
      const avg = (arr) => { const v = arr.map((d) => d.recovery).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const last7 = avg(days.slice(-7));
      const prev7 = avg(days.slice(-14, -7));
      const trend = last7 !== null && prev7 !== null
        ? ` Your 7-day average recovery is ${num(last7)}%, ${last7 > prev7 ? 'up' : last7 < prev7 ? 'down' : 'flat'} from ${num(prev7)}% the week before.`
        : '';
      return `Today: recovery ${num(w.recovery)}%, sleep ${num(w.sleep)}%, strain ${num(w.strain)}.${trend} ${w.recovery < 40 ? "That's low — today's a good day to keep training light." : "That's a reasonable base to train normally on."}`;
    }
  }
  if (latest && state.goal) {
    const remaining = (latest.kg - state.goal.goal).toFixed(1);
    return `You're at ${latest.kg}kg, ${Math.abs(remaining)}kg ${remaining > 0 ? 'above' : 'below'} your goal of ${state.goal.goal}kg. Small, repeatable weekly habits beat big swings — what's one thing you can keep consistent this week?`;
  }
  return `I'm running in local mode (no AI key yet) so I can only respond to your logged data and plans. Log a weight entry, set a goal, or add your Anthropic API key in Settings for full AI coaching.`;
}

/* ===================== Helpers ===================== */
function fmtDate(d) { const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderAll() {
  renderHome();
  renderTodayCard();
  renderVelocityChart();
  renderInsights();
  renderCheckInNudge();
  renderWeightHistory();
  renderSettings();
  renderJabs();
  renderJabSettings();
  renderSupplements();
  renderMilestones();
  renderPlateau();
  renderCoachStatus();
  renderCoachChat();
  renderWhoopSettingsFields();
  checkWhoopStatus();
  renderPushStatus();
}
renderAll();
if (state.whoopConfig.workerUrl && state.whoopConfig.sharedKey) {
  syncWhoop(false);
  pullState();
}

/* ===================== Service worker ===================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(() => {
      navigator.serviceWorker.ready.then(() => sendConfigToSW());
    }).catch(() => {});
  });
}
