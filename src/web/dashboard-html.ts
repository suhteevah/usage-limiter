/**
 * Self-contained HTML dashboard template.
 * Inline CSS + JS, no external dependencies.
 * Fetches data from sibling API routes.
 */

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Usage Limiter - OpenClaw</title>
<style>
  :root {
    --bg: #0f1117;
    --card: #1a1d27;
    --border: #2a2d3a;
    --text: #e1e4ec;
    --text-dim: #8b8fa3;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --blue: #3b82f6;
    --purple: #a855f7;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    padding: 24px;
    max-width: 1100px;
    margin: 0 auto;
  }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: var(--text-dim); font-size: 0.875rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }
  .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 16px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem; }
  .limit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .limit-label { width: 70px; font-size: 0.875rem; color: var(--text-dim); }
  .bar-container {
    flex: 1;
    height: 24px;
    background: #252836;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }
  .bar-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.5s ease, background 0.3s ease;
  }
  .bar-fill.ok { background: linear-gradient(90deg, #16a34a, #22c55e); }
  .bar-fill.warn { background: linear-gradient(90deg, #ca8a04, #eab308); }
  .bar-fill.blocked { background: linear-gradient(90deg, #dc2626, #ef4444); }
  .bar-text {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
  .limit-value {
    width: 120px;
    text-align: right;
    font-size: 0.8rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .status-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .status-badge.ok { background: rgba(34,197,94,0.15); color: var(--green); }
  .status-badge.warn { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .status-badge.blocked { background: rgba(239,68,68,0.15); color: var(--red); }

  /* Chart */
  .chart-container { position: relative; padding: 10px 0; }
  .chart-svg { width: 100%; height: 200px; }
  .chart-line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .chart-area { opacity: 0.15; }
  .chart-dot { r: 3; }
  .chart-label { fill: var(--text-dim); font-size: 11px; }
  .chart-grid { stroke: var(--border); stroke-width: 0.5; }

  /* Model table */
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; color: var(--text-dim); font-weight: 500; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.75rem; text-transform: uppercase; }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }

  /* Controls */
  .controls { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .btn {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn:hover { background: #252836; }
  .btn.active { background: var(--blue); border-color: var(--blue); }
  .btn.danger { border-color: var(--red); color: var(--red); }
  .btn.danger:hover { background: rgba(239,68,68,0.1); }

  /* Config info */
  .config-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .config-item { font-size: 0.8rem; }
  .config-label { color: var(--text-dim); }
  .config-value { font-weight: 600; }

  .loading { text-align: center; padding: 40px; color: var(--text-dim); }
  .error { color: var(--red); padding: 16px; text-align: center; }
  .refresh-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--blue);
    color: white;
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(59,130,246,0.4);
    transition: transform 0.3s;
  }
  .refresh-btn:hover { transform: scale(1.1); }
  .refresh-btn.spinning { animation: spin 0.8s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
</head>
<body>

<h1>Usage Limiter</h1>
<p class="subtitle">Monitor and control your OpenClaw model usage</p>

<div id="app"><div class="loading">Loading usage data...</div></div>

<button class="refresh-btn" onclick="refreshAll()" title="Refresh">&#x21bb;</button>

<script>
const BASE = window.location.pathname.replace(/\\/dashboard$/, '');
const API = {
  summary: BASE + '/api/summary',
  history: BASE + '/api/history',
  limits: BASE + '/api/limits',
};

let summaryData = null;
let historyData = null;
let chartMode = 'cost';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function refreshAll() {
  const btn = document.querySelector('.refresh-btn');
  btn.classList.add('spinning');
  try {
    [summaryData, historyData] = await Promise.all([
      fetchJson(API.summary),
      fetchJson(API.history + '?days=30'),
    ]);
    render();
  } catch (err) {
    document.getElementById('app').innerHTML = '<div class="error">Failed to load data: ' + err.message + '</div>';
  }
  btn.classList.remove('spinning');
}

function render() {
  if (!summaryData) return;
  const app = document.getElementById('app');

  let html = '';

  // Budget cards
  html += '<div class="grid">';
  for (const period of ['daily', 'weekly', 'monthly']) {
    const data = summaryData.summaries[period];
    if (!data || !data.limits || data.limits.length === 0) continue;
    html += renderPeriodCard(period, data);
  }
  html += '</div>';

  // Chart
  if (historyData && historyData.history && historyData.history.length > 0) {
    html += '<div class="card" style="margin-bottom: 16px;">';
    html += '<h2>Usage History (30 Days)</h2>';
    html += '<div class="controls">';
    html += '<button class="btn ' + (chartMode === 'cost' ? 'active' : '') + '" onclick="setChartMode(\\'cost\\')">Cost</button>';
    html += '<button class="btn ' + (chartMode === 'tokens' ? 'active' : '') + '" onclick="setChartMode(\\'tokens\\')">Tokens</button>';
    html += '<button class="btn ' + (chartMode === 'requests' ? 'active' : '') + '" onclick="setChartMode(\\'requests\\')">Requests</button>';
    html += '</div>';
    html += renderChart(historyData.history, chartMode);
    html += '</div>';
  }

  // Model breakdown
  if (historyData && historyData.models && historyData.models.length > 0) {
    html += '<div class="card" style="margin-bottom: 16px;">';
    html += '<h2>Model Breakdown (Today)</h2>';
    html += renderModelTable(historyData.models);
    html += '</div>';
  }

  // Config info
  if (summaryData.config) {
    html += '<div class="card">';
    html += '<h2>Configuration</h2>';
    html += renderConfig(summaryData.config);
    html += '</div>';
  }

  app.innerHTML = html;
}

function renderPeriodCard(period, data) {
  const title = period.charAt(0).toUpperCase() + period.slice(1);
  let html = '<div class="card"><h2>' + title + '</h2>';

  for (const limit of data.limits) {
    const pct = Math.min(limit.ratio * 100, 100);
    const status = limit.status;
    const current = formatValue(limit.type, limit.current);
    const max = formatValue(limit.type, limit.limit);
    const typeLabel = limit.type.charAt(0).toUpperCase() + limit.type.slice(1);

    html += '<div class="limit-row">';
    html += '<span class="limit-label">' + typeLabel + '</span>';
    html += '<div class="bar-container">';
    html += '<div class="bar-fill ' + status + '" style="width: ' + pct + '%"></div>';
    html += '<span class="bar-text">' + pct.toFixed(1) + '%</span>';
    html += '</div>';
    html += '<span class="limit-value">' + current + ' / ' + max + '</span>';
    html += '<span class="status-badge ' + status + '">' + status + '</span>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderChart(history, mode) {
  if (!history || history.length === 0) return '<p style="color:var(--text-dim)">No data</p>';

  const w = 1000, h = 180, pad = { t: 10, r: 20, b: 30, l: 60 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const values = history.map(d => {
    if (mode === 'cost') return d.totalCost;
    if (mode === 'tokens') return d.totalTokens;
    return d.requestCount;
  });

  const maxVal = Math.max(...values, 1);

  const points = history.map((d, i) => {
    const x = pad.l + (i / Math.max(history.length - 1, 1)) * iw;
    const y = pad.t + ih - (values[i] / maxVal) * ih;
    return { x, y, date: d.date, val: values[i] };
  });

  const lineColor = mode === 'cost' ? '#22c55e' : mode === 'tokens' ? '#3b82f6' : '#a855f7';

  let pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');
  let areaD = pathD + ' L' + points[points.length-1].x + ',' + (pad.t + ih) + ' L' + points[0].x + ',' + (pad.t + ih) + ' Z';

  // Y axis labels
  let yLabels = '';
  for (let i = 0; i <= 4; i++) {
    const val = (maxVal / 4) * i;
    const y = pad.t + ih - (i / 4) * ih;
    yLabels += '<text x="' + (pad.l - 8) + '" y="' + (y + 4) + '" class="chart-label" text-anchor="end">' + formatChartValue(mode, val) + '</text>';
    yLabels += '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (w - pad.r) + '" y2="' + y + '" class="chart-grid" />';
  }

  // X axis labels (show ~5 dates)
  let xLabels = '';
  const step = Math.max(1, Math.floor(history.length / 5));
  for (let i = 0; i < history.length; i += step) {
    const p = points[i];
    const label = history[i].date.slice(5); // MM-DD
    xLabels += '<text x="' + p.x + '" y="' + (h - 5) + '" class="chart-label" text-anchor="middle">' + label + '</text>';
  }

  let dots = points.map(p =>
    '<circle cx="' + p.x + '" cy="' + p.y + '" class="chart-dot" fill="' + lineColor + '" />'
  ).join('');

  return '<div class="chart-container"><svg class="chart-svg" viewBox="0 0 ' + w + ' ' + h + '">'
    + yLabels + xLabels
    + '<path d="' + areaD + '" class="chart-area" fill="' + lineColor + '" />'
    + '<path d="' + pathD + '" class="chart-line" stroke="' + lineColor + '" />'
    + dots
    + '</svg></div>';
}

function renderModelTable(models) {
  let html = '<table><thead><tr><th>Model</th><th style="text-align:right">Tokens</th><th style="text-align:right">Cost</th><th style="text-align:right">Requests</th></tr></thead><tbody>';
  for (const m of models) {
    html += '<tr>';
    html += '<td>' + m.provider + '/' + m.model + '</td>';
    html += '<td style="text-align:right">' + formatValue('tokens', m.totalTokens) + '</td>';
    html += '<td style="text-align:right">' + formatValue('cost', m.totalCost) + '</td>';
    html += '<td style="text-align:right">' + m.requestCount + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function renderConfig(cfg) {
  let html = '<div class="config-grid">';
  html += configItem('Warn Threshold', (cfg.warnThreshold * 100) + '%');
  html += configItem('Block Threshold', (cfg.blockThreshold * 100) + '%');
  html += configItem('Fallback Model', cfg.fallbackModel || 'Not set');
  html += configItem('Auto Downgrade', cfg.autoDowngrade ? 'Enabled' : 'Disabled');
  html += configItem('Timezone', cfg.timezone || 'UTC');
  html += '</div>';
  return html;
}

function configItem(label, value) {
  return '<div class="config-item"><span class="config-label">' + label + ': </span><span class="config-value">' + value + '</span></div>';
}

function formatValue(type, val) {
  if (type === 'cost') {
    return val >= 1 ? '$' + val.toFixed(2) : '$' + val.toFixed(4);
  }
  if (type === 'tokens') {
    if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
    return String(Math.round(val));
  }
  return String(Math.round(val));
}

function formatChartValue(mode, val) {
  if (mode === 'cost') return '$' + val.toFixed(2);
  if (mode === 'tokens') {
    if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(0) + 'K';
    return String(Math.round(val));
  }
  return String(Math.round(val));
}

function setChartMode(mode) {
  chartMode = mode;
  render();
}

// Auto-refresh every 30 seconds
setInterval(refreshAll, 30000);
refreshAll();
</script>
</body>
</html>`;
}
