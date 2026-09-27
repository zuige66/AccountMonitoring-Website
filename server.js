const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

loadEnv();
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, 'public');
const SETTLE = (process.env.GATE_SETTLE || 'usdt').toLowerCase();
const BASE = process.env.GATE_BASE_URL || 'https://api.gateio.ws/api/v4';

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'gate-pulse.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS ledger (
    time INTEGER NOT NULL,
    type TEXT NOT NULL,
    contract TEXT NOT NULL DEFAULT '',
    change REAL NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (time, type, contract, change, text)
  );
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    create_time INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
const insertLedgerRow = db.prepare('INSERT OR IGNORE INTO ledger (time,type,contract,change,text) VALUES (?,?,?,?,?)');
const insertTradeRow = db.prepare('INSERT OR IGNORE INTO trades (id,create_time,payload) VALUES (?,?,?)');
const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMeta = db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

// Gate 的 account_book / my_trades 默认只返回最近约 30 天（from/to 对 my_trades 无效），
// 所以 account_book 需要分段 from/to 回填历史，成交明细只能滚动收录进本地库。
const SYNC_CHUNK = 7 * 86400;
const SYNC_OVERLAP = 86400;

function historyStartSec() {
  const raw = process.env.GATE_HISTORY_START;
  if (raw) {
    const t = Date.parse(/T/.test(raw) ? raw : `${raw}T00:00:00Z`);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Math.floor(Date.now() / 1000) - 90 * 86400;
}

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function sign(method, apiPath, query = '', body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = crypto.createHash('sha512').update(body).digest('hex');
  const message = [method, `/api/v4${apiPath}`, query, hash, timestamp].join('\n');
  return { KEY: process.env.GATE_API_KEY, Timestamp: timestamp,
    SIGN: crypto.createHmac('sha512', process.env.GATE_API_SECRET).update(message).digest('hex') };
}

async function gateGet(apiPath, params = {}) {
  const query = new URLSearchParams(params).toString();
  const headers = { Accept: 'application/json', ...sign('GET', apiPath, query) };
  const response = await fetch(`${BASE}${apiPath}${query ? `?${query}` : ''}`, { headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.label || `Gate API ${response.status}`);
  return data;
}

async function fetchLedgerRange(fromSec, toSec) {
  for (let start = fromSec; start < toSec; start += SYNC_CHUNK) {
    const end = Math.min(start + SYNC_CHUNK, toSec);
    for (let offset = 0; offset < 100000; offset += 1000) {
      const page = await gateGet(`/futures/${SETTLE}/account_book`, { from: start, to: end, limit: 1000, offset });
      db.exec('BEGIN');
      try {
        for (const row of page) {
          insertLedgerRow.run(Number(row.time), String(row.type || ''), String(row.contract || ''),
            Number(row.change || 0), String(row.text || ''));
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      if (page.length < 1000) break;
    }
  }
}

async function syncLedger() {
  const nowSec = Math.floor(Date.now() / 1000);
  const start = historyStartSec();
  const stored = getMeta.get('ledger_from');
  const from = stored ? Number(stored.value) : null;
  if (from == null) {
    await fetchLedgerRange(start, nowSec);
    setMeta.run('ledger_from', String(start));
    return;
  }
  if (start < from) {
    await fetchLedgerRange(start, from);
    setMeta.run('ledger_from', String(start));
  }
  const row = db.prepare('SELECT MAX(time) AS t FROM ledger').get();
  const edge = row && row.t ? Number(row.t) : from;
  await fetchLedgerRange(edge - SYNC_OVERLAP, nowSec);
}

async function syncTrades() {
  for (let offset = 0; offset < 100000; offset += 1000) {
    const page = await gateGet(`/futures/${SETTLE}/my_trades`, { limit: 1000, offset });
    db.exec('BEGIN');
    try {
      for (const trade of page) {
        insertTradeRow.run(String(trade.id ?? trade.order_id), Number(trade.create_time || 0), JSON.stringify(trade));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    if (page.length < 1000) break;
  }
}

let syncChain = Promise.resolve();
let firstSyncDone = false;
function syncAll() {
  syncChain = syncChain
    .then(() => syncLedger())
    .then(() => syncTrades())
    .catch(e => console.error('数据同步失败，继续使用本地已有数据:', e.message));
  return syncChain;
}

function readAllLedger() {
  return db.prepare('SELECT time, type, contract, change, text FROM ledger ORDER BY time').all();
}

function readAllTrades() {
  return db.prepare('SELECT payload FROM trades ORDER BY create_time DESC').all().map(r => JSON.parse(r.payload));
}

function buildClosedPositions(trades, positions, ledger) {
  const cashByOrder = new Map();
  for (const row of ledger) {
    if (!['pnl', 'fee'].includes(row.type) || !row.text?.includes(':')) continue;
    const orderId = row.text.split(':').at(-1);
    const cash = cashByOrder.get(orderId) || { pnl:0, fee:0 };
    cash[row.type] += Number(row.change || 0);
    cashByOrder.set(orderId, cash);
  }

  const positionState = new Map();
  for (const position of positions) {
    positionState.set(`${position.contract}:${position.side}`, Math.abs(Number(position.size)));
  }

  const orderGroups = new Map();
  for (const trade of trades) {
    const orderId = String(trade.order_id || trade.id);
    if (!orderGroups.has(orderId)) orderGroups.set(orderId, []);
    orderGroups.get(orderId).push(trade);
  }

  const groups = [...orderGroups.entries()].sort((a,b) =>
    Math.max(...b[1].map(x => Number(x.create_time))) - Math.max(...a[1].map(x => Number(x.create_time)))
  );
  const records = [];

  // Walk backwards from the current positions. This lets us determine whether
  // each reduce order left a remainder (partial close) or reduced the leg to 0.
  for (const [orderId, fills] of groups) {
    for (const fill of fills) {
      const openedSize = Number(fill.size) - Number(fill.close_size || 0);
      if (!openedSize) continue;
      const openedSide = openedSize > 0 ? 'long' : 'short';
      const key = `${fill.contract}:${openedSide}`;
      positionState.set(key, Math.max(0, (positionState.get(key) || 0) - Math.abs(openedSize)));
    }

    const closingFills = fills.filter(x => Number(x.close_size));
    if (!closingFills.length) continue;
    const signedClosedSize = closingFills.reduce((sum,x) => sum + Number(x.close_size), 0);
    const side = signedClosedSize > 0 ? 'short' : 'long';
    const contract = closingFills[0].contract;
    const key = `${contract}:${side}`;
    const remainingAfter = positionState.get(key) || 0;
    const closedSize = closingFills.reduce((sum,x) => sum + Math.abs(Number(x.close_size)), 0);
    const closePrice = closingFills.reduce((sum,x) => sum + Number(x.price) * Math.abs(Number(x.close_size)), 0) / closedSize;
    const cash = cashByOrder.get(orderId);
    const fee = cash?.fee ?? -closingFills.reduce((sum,x) => sum + Math.abs(Number(x.fee || 0)), 0);
    const pnl = cash?.pnl ?? null;
    positionState.set(key, remainingAfter + closedSize);
    records.push({
      id:orderId,
      time:Math.max(...closingFills.map(x => Number(x.create_time))) * 1000,
      contract,
      side,
      status:remainingAfter < 1e-9 ? 'closed' : 'partial',
      closedSize,
      remainingAfter,
      closePrice,
      pnl,
      fee,
      netPnl:pnl == null ? null : pnl + fee,
      role:[...new Set(closingFills.map(x => x.role))].join('/')
    });
  }
  return records.filter(r => !/^(doge|sui)_/i.test(r.contract));
}

function buildOpenPositions(trades, ledger, positions) {
  const cashByOrder = new Map();
  for (const row of ledger) {
    if (!['fee'].includes(row.type) || !row.text?.includes(':')) continue;
    const orderId = row.text.split(':').at(-1);
    const cash = cashByOrder.get(orderId) || { fee:0 };
    cash.fee += Number(row.change || 0);
    cashByOrder.set(orderId, cash);
  }

  const orderGroups = new Map();
  for (const trade of trades) {
    const orderId = String(trade.order_id || trade.id);
    if (!orderGroups.has(orderId)) orderGroups.set(orderId, []);
    orderGroups.get(orderId).push(trade);
  }

  const groups = [...orderGroups.entries()].sort((a,b) =>
    Math.max(...b[1].map(x => Number(x.create_time))) - Math.max(...a[1].map(x => Number(x.create_time)))
  );
  const records = [];

  const positionMap = new Map();
  for (const p of positions) {
    const lev = Number(p.leverage || p.lever || 0);
    const m = Number(p.initialMargin || p.margin || 0);
    const v = Math.abs(Number(p.value || 0));
    positionMap.set(`${p.contract}:${p.side}`, {
      margin: m,
      leverage: lev || (m && v ? v / m : 0),
      entryPrice: Number(p.entryPrice || 0)
    });
  }

  for (const [orderId, fills] of groups) {
    const openingFills = fills.filter(x => !Number(x.close_size));
    if (!openingFills.length) continue;
    const signedOpenedSize = openingFills.reduce((sum,x) => {
      const openedSize = Number(x.size) - Number(x.close_size || 0);
      return sum + openedSize;
    }, 0);
    if (!signedOpenedSize) continue;
    const side = signedOpenedSize > 0 ? 'long' : 'short';
    const contract = openingFills[0].contract;
    const openedSize = openingFills.reduce((sum,x) => {
      const openedSize = Number(x.size) - Number(x.close_size || 0);
      return sum + Math.abs(openedSize);
    }, 0);
    const openPrice = openingFills.reduce((sum,x) => {
      const openedSize = Math.abs(Number(x.size) - Number(x.close_size || 0));
      return sum + Number(x.price) * openedSize;
    }, 0) / openedSize;
    const cash = cashByOrder.get(orderId);
    const fee = cash?.fee ?? -openingFills.reduce((sum,x) => sum + Math.abs(Number(x.fee || 0)), 0);
    const pos = positionMap.get(`${contract}:${side}`);
    const leverage = pos?.leverage || 0;
    const margin = pos?.margin || (leverage ? openedSize * openPrice / leverage : null);
    records.push({
      id:orderId,
      time:Math.max(...openingFills.map(x => Number(x.create_time))) * 1000,
      contract,
      side,
      openedSize,
      openPrice,
      margin,
      leverage:leverage || null,
      fee,
      role:[...new Set(openingFills.map(x => x.role))].join('/')
    });
  }
  return records.filter(r => !/^(doge|sui)_/i.test(r.contract));
}

function buildIntradaySeries(ledger, now = Date.now()) {
  const ignored = new Set(['dnw','point_dnw','bonus_dnw','bonus_offset','cross_settle']);
  const cutoff = now - 86400000;
  const changes = new Map();
  for (const row of ledger) {
    if (ignored.has(row.type)) continue;
    const time = Number(row.time) * 1000;
    changes.set(time, (changes.get(time) || 0) + Number(row.change || 0));
  }
  const ordered = [...changes].sort((a,b) => a[0] - b[0]);
  let cumulative = 0;
  for (const [time, change] of ordered) if (time < cutoff) cumulative += change;
  const points = [{time:cutoff, pnl:cumulative, equity:cumulative, drawdown:0}];
  for (const [time, change] of ordered) {
    if (time < cutoff) continue;
    cumulative += change;
    points.push({time, pnl:cumulative, equity:cumulative, drawdown:0});
  }
  if (points.at(-1).time < now) points.push({time:now, pnl:cumulative, equity:cumulative, drawdown:0});
  return points;
}

function buildContractPnls(ledger, positions) {
  const ignored = new Set(['dnw','point_dnw','bonus_dnw','bonus_offset','cross_settle']);
  const contracts = new Map();
  const get = contract => {
    if (!contracts.has(contract)) contracts.set(contract, {
      contract, closePnl:0, fees:0, funding:0, other:0, realisedNet:0,
      unrealised:0, activePositions:0, lastActivity:0
    });
    return contracts.get(contract);
  };
  for (const row of ledger) {
    if (!row.contract || ignored.has(row.type)) continue;
    const item = get(row.contract);
    const change = Number(row.change || 0);
    item.realisedNet += change;
    item.lastActivity = Math.max(item.lastActivity, Number(row.time || 0) * 1000);
    if (row.type === 'pnl') item.closePnl += change;
    else if (row.type === 'fee') item.fees += change;
    else if (row.type === 'fund') item.funding += change;
    else item.other += change;
  }
  for (const position of positions) {
    const item = get(position.contract);
    item.unrealised += Number(position.unrealisedPnl || 0);
    item.activePositions += 1;
  }
  return [...contracts.values()]
    .filter(item => !/^(doge|sui)_/i.test(item.contract))
    .map(item => ({...item, totalPnl:item.realisedNet + item.unrealised}))
    .sort((a,b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl));
}

function mockData() {
  const positions = [
    { contract:'BTC_USDT', size:0.038, side:'long', leverage:8, entryPrice:116420.4, markPrice:118742.8, liqPrice:104280.2, value:4512.23, margin:564.03, unrealisedPnl:88.25, realisedPnl:164.82, roe:15.65 },
    { contract:'ETH_USDT', size:-1.42, side:'short', leverage:5, entryPrice:4392.1, markPrice:4341.8, liqPrice:5128.4, value:6165.36, margin:1233.07, unrealisedPnl:71.43, realisedPnl:-24.16, roe:5.79 },
    { contract:'SOL_USDT', size:18, side:'long', leverage:3, entryPrice:182.64, markPrice:180.92, liqPrice:126.77, value:3256.56, margin:1085.52, unrealisedPnl:-30.96, realisedPnl:42.61, roe:-2.85 }
  ];
  const now = Date.now(), series = []; let equity = 11842, peak = equity;
  for (let i=30; i>=0; i--) {
    const wave = Math.sin(i*.73)*73 + Math.cos(i*.31)*42 + (30-i)*14;
    const value = equity + wave; peak = Math.max(peak, value);
    series.push({ time: now-i*86400000, equity:+value.toFixed(2), pnl:+(value-11842).toFixed(2), drawdown:+((value-peak)/peak*100).toFixed(2) });
  }
  const intradaySeries = [];
  let intradayPnl = series.at(-2)?.pnl || 0;
  for (let i=24; i>=0; i-=2) {
    intradayPnl += Math.sin(i*.9)*3.4 + Math.cos(i*.37)*1.8 + .55;
    intradaySeries.push({time:now-i*3600000,pnl:+intradayPnl.toFixed(2),equity:+intradayPnl.toFixed(2),drawdown:0});
  }
  const closedPositions = [
    {id:'demo-2',time:now-7200000,contract:'ETH_USDT',side:'short',status:'partial',closedSize:0.38,remainingAfter:1.42,closePrice:4368.2,pnl:9.08,fee:-0.42,netPnl:8.66,role:'taker'},
    {id:'demo-1',time:now-86400000,contract:'BTC_USDT',side:'long',status:'closed',closedSize:0.012,remainingAfter:0,closePrice:117920.5,pnl:21.34,fee:-0.57,netPnl:20.77,role:'maker'}
  ];
  const openPositions = [
    {id:'demo-open-3',time:now-1800000,contract:'SOL_USDT',side:'long',openedSize:18,openPrice:182.64,margin:1085.52,leverage:3,fee:-1.82,role:'taker'},
    {id:'demo-open-2',time:now-7200000,contract:'ETH_USDT',side:'short',openedSize:1.8,openPrice:4392.1,margin:1542.09,leverage:5,fee:-3.86,role:'maker'},
    {id:'demo-open-1',time:now-172800000,contract:'BTC_USDT',side:'long',openedSize:0.05,openPrice:116420.4,margin:726.38,leverage:8,fee:-5.82,role:'taker'}
  ];
  const contractPnls = [
    {contract:'BTC_USDT',closePnl:142.8,fees:-18.31,funding:4.22,other:0,realisedNet:128.71,unrealised:88.25,totalPnl:216.96,activePositions:1,lastActivity:now},
    {contract:'ETH_USDT',closePnl:51.2,fees:-12.45,funding:-3.19,other:0,realisedNet:35.56,unrealised:71.43,totalPnl:106.99,activePositions:1,lastActivity:now-3600000},
    {contract:'SOL_USDT',closePnl:38.7,fees:-14.74,funding:-1.96,other:0,realisedNet:22,unrealised:-30.96,totalPnl:-8.96,activePositions:1,lastActivity:now-7200000}
  ];
  return { mode:'demo', updatedAt:now, account:{ wallet:12846.72, equity:12975.44, available:9821.34, margin:2882.62, unrealised:128.72, realised:183.27, todayPnl:46.18 }, positions, closedPositions, openPositions, series, intradaySeries, contractPnls };
}

async function dashboard() {
  if (!process.env.GATE_API_KEY || !process.env.GATE_API_SECRET) return mockData();
  // 同步放后台跑，响应只读本地库，避免被 Gate 慢接口（my_trades 可达 15s+）拖住；
  // 首次请求等待回填完成，保证首访就能看到完整历史。
  const sync = syncAll();
  const live = Promise.all([
    gateGet(`/futures/${SETTLE}/positions`),
    gateGet(`/futures/${SETTLE}/accounts`)
  ]);
  if (!firstSyncDone) { await sync; firstSyncDone = true; }
  const [rawPositions, futuresAccount] = await live;
  const ledger = readAllLedger();
  const trades = readAllTrades();
  const positions = rawPositions.filter(p => Number(p.size)).map(p => {
    const margin = Number(p.margin || 0), initialMargin = Number(p.initial_margin || 0);
    const effectiveMargin = initialMargin || margin;
    const unrealisedPnl = Number(p.unrealised_pnl || 0);
    const size = Number(p.size);
    const markPrice = Number(p.mark_price);
    const reportedLiqPrice = Number(p.liq_price || 0);
    // In cross hedge mode Gate can return one portfolio liquidation price for
    // both legs. Reject it on the leg where its direction is impossible.
    const liqPrice = reportedLiqPrice > 0 &&
      (size > 0 ? reportedLiqPrice < markPrice : reportedLiqPrice > markPrice)
      ? reportedLiqPrice : 0;
    return {
      contract:p.contract, size, side:size>=0?'long':'short', leverage:Number(p.leverage || p.lever || 0),
      entryPrice:Number(p.entry_price), markPrice, liqPrice, value:Math.abs(Number(p.value)),
      margin, initialMargin, maintenanceMargin:Number(p.maintenance_margin || 0), unrealisedPnl, realisedPnl:Number(p.realised_pnl),
      roe:effectiveMargin ? unrealisedPnl/effectiveMargin*100 : 0
    };
  });
  const daily = new Map();
  for (const row of ledger) {
    if (['dnw','point_dnw','bonus_dnw','bonus_offset','cross_settle'].includes(row.type)) continue;
    const date = new Date(Number(row.time)*1000);
    const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    daily.set(day, (daily.get(day)||0) + Number(row.change||0));
  }
  let cumulative=0, peak=0;
  const entries = [...daily].sort((a,b)=>a[0].localeCompare(b[0]));
  const series = entries.length ? [{time:+new Date(`${entries[0][0]}T00:00:00`)-1,pnl:0,equity:0,drawdown:0}] : [];
  for (const [day,pnl] of entries) { cumulative+=pnl; peak=Math.max(peak,cumulative); series.push({time:+new Date(`${day}T23:59:59`),pnl:cumulative,equity:cumulative,drawdown:peak?(cumulative-peak)/Math.max(Math.abs(peak),1)*100:0}); }
  const wallet = Number(futuresAccount.total || futuresAccount.cross_margin_balance || 0);
  const unrealised = Number(futuresAccount.unrealised_pnl || futuresAccount.cross_unrealised_pnl || positions.reduce((s,p)=>s+p.unrealisedPnl,0));
  const available = Number(futuresAccount.available || futuresAccount.cross_available || 0);
  const orderMargin = Number(futuresAccount.order_margin || futuresAccount.cross_order_margin || 0);
  // In cross/dual mode, summing each leg's theoretical initial margin
  // overstates funds occupied because Gate offsets hedged exposure. The actual
  // wallet deduction is the balance that is no longer available.
  const margin = Math.max(0,wallet-available-orderMargin);
  const closedPositions = buildClosedPositions(trades, positions, ledger);
  const openPositions = buildOpenPositions(trades, ledger, positions);
  const intradaySeries = buildIntradaySeries(ledger);
  const contractPnls = buildContractPnls(ledger, positions);
  const h = futuresAccount.history || {};
  const closePnl = Number(h.pnl || 0);
  const fees = Number(h.fee || 0);
  const funding = Number(h.fund || 0);
  const rebates = Number(h.refr || 0);
  const now = new Date(), todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return { mode:'live', updatedAt:Date.now(), account:{ wallet, equity:wallet+unrealised, available, margin, orderMargin, unrealised, realised:cumulative, closePnl, fees, funding, rebates, lifetimeNet:closePnl+fees+funding+rebates, todayPnl:daily.get(todayKey)||0 }, positions, closedPositions, openPositions, series, intradaySeries, contractPnls };
}

const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer(async (req,res) => {
  try {
    if (req.url === '/api/dashboard') {
      const data = await dashboard();
      res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'}); return res.end(JSON.stringify(data));
    }
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':mime[path.extname(file)]||'application/octet-stream'}); fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(502, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
});
server.listen(PORT, () => console.log(`Gate Pulse → http://localhost:${PORT}`));
