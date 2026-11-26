#!/usr/bin/env node
/* ============================================================
   LOTO TET - LOAD TEST ĐỘC LẬP (chạy trên máy local)
   Chỉ dùng module có sẵn của dự án: Node core + socket.io-client
   (đã có trong backend/node_modules, không cần cài thêm).

   Chạy:
     npm run load-test
     npm run load-test -- --players=100 --url=http://localhost:3000
     LOAD_TEST_PLAYERS=80 node backend/test/load-test.js
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');

function parseArgs(argv) {
  const out = {
    players: Number(process.env.LOAD_TEST_PLAYERS) || 50,
    url: process.env.BASE_URL || process.env.LOAD_TEST_URL || 'http://localhost:3000',
    password: process.env.ADMIN_PASSWORD || 'test123',
  };
  const flags = {
    '--players': 'players', '-p': 'players',
    '--url': 'url', '-u': 'url',
    '--password': 'password',
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const name = eq >= 0 ? raw.slice(0, eq) : raw;
    const key = flags[name];
    if (!key) continue;
    const value = eq >= 0 ? raw.slice(eq + 1) : argv[++i];
    if (value !== undefined) out[key] = key === 'players' ? Number(value) : value;
  }
  if (!Number.isInteger(out.players) || out.players < 1 || out.players > 250) {
    throw new Error('Số người chơi phải là số nguyên từ 1 đến 250.');
  }
  return out;
}

function event(socket, name, predicate = () => true, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`Timeout ${name}`));
    }, timeout);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(name, handler);
      resolve(payload);
    }
    socket.on(name, handler);
  });
}

async function connect(url) {
  const socket = io(url, { reconnection: false, timeout: 5000, transports: ['websocket', 'polling'] });
  await event(socket, 'connect', () => true, 10000);
  return socket;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}
function stats(values) {
  if (!values.length) return { count: 0, avg: 0, min: 0, p95: 0, p99: 0, max: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: Math.round(sum / values.length),
    min: Math.round(Math.min(...values)),
    p95: Math.round(percentile(values, 95)),
    p99: Math.round(percentile(values, 99)),
    max: Math.round(Math.max(...values)),
  };
}
function row(label, value) { console.log(`  ${label.padEnd(34)} ${value}`); }
function hr(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`); }

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const { players, url, password } = opts;
  const sockets = [];
  const lockLatency = [];
  const drawLatency = [];
  let assigned = 0;
  let rejected = 0;
  let locked = 0;
  let drawResults = 0;
  let drawErrors = 0;
  let lockErrors = 0;
  let drawRollingAt = 0;

  console.log(`🚀 LOTO TET LOAD TEST · ${players} người chơi ảo · ${url}`);
  console.log('__PROGRESS__:' + JSON.stringify({ stage: 'init', percent: 10 }));
  try {
    const ping = await fetch(`${url}/api/state`);
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch (error) {
    console.error(`❌ Không kết nối được server ${url}: ${error.message}`);
    process.exit(1);
  }

  const admin = await connect(url);
  sockets.push(admin);
  const authenticated = event(admin, 'admin:authenticated', () => true, 10000);
  admin.emit('admin:login', { password });
  await authenticated;
  admin.emit('host:register');

  // Đảm bảo ván sạch trước khi đổi cấu hình (tránh bị khóa do state cũ).
  const reset = event(admin, 'game:reset', () => true, 10000);
  admin.emit('game:new');
  await reset;

  const maxPlayers = Math.max(200, players * 3);
  const betPerTicket = 1000;
  const configured = event(admin, 'host:state', (s) =>
    s.config && s.config.maxPlayers === maxPlayers && s.config.maxTicketsPerPlayer === 3, 15000);
  admin.emit('config:update', {
    maxPlayers, maxTicketsPerPlayer: 3, betPerTicket,
    maxWinners: 1, rollSeconds: 1, autoRollSeconds: 4.5,
  });
  await configured;

  // Nạp tiền cho toàn bộ người chơi ảo.
  for (let i = 1; i <= players; i++) {
    admin.emit('admin:wallet-deposit', { name: `Load${i}`, amount: 10000 });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Mở đồng thời các kết nối người chơi.
  const clients = await Promise.all(Array.from({ length: players }, () => connect(url)));
  sockets.push(...clients);

  hr('1) Tham gia phòng (đồng thời)');
  const joinStart = Date.now();
  await Promise.all(clients.map((client, i) => new Promise((resolve) => {
    const timer = setTimeout(() => { rejected++; resolve(); }, 12000);
    const finish = (ok) => {
      clearTimeout(timer);
      client.off('ticket:assigned', onAssigned);
      client.off('player:rejected', onRejected);
      if (ok) assigned++; else rejected++;
      resolve();
    };
    const onAssigned = () => finish(true);
    const onRejected = () => finish(false);
    client.once('ticket:assigned', onAssigned);
    client.once('player:rejected', onRejected);
    client.emit('player:join', { playerId: `load-${i + 1}`, name: `Load${i + 1}`, ticketCount: 3 });
  })));
  row('Thời gian tham gia', `${Date.now() - joinStart}ms`);
  row('Nhận vé / bị từ chối', `${assigned} / ${rejected}`);
  console.log('__PROGRESS__:' + JSON.stringify({ stage: 'joined', percent: 30 }));

  hr('2) Chốt vé (đồng thời)');
  await Promise.all(clients.map((client, i) => new Promise((resolve) => {
    const started = Date.now();
    const timer = setTimeout(() => { lockErrors++; resolve(); }, 12000);
    const done = (ok) => {
      clearTimeout(timer);
      client.off('ticket:locked', onLocked);
      client.off('ticket:error', onError);
      if (ok) { locked++; lockLatency.push(Date.now() - started); }
      else lockErrors++;
      resolve();
    };
    const onLocked = () => done(true);
    const onError = () => done(false);
    client.once('ticket:locked', onLocked);
    client.once('ticket:error', onError);
    client.emit('ticket:lock', { playerId: `load-${i + 1}` });
  })));

  console.log('__PROGRESS__:' + JSON.stringify({ stage: 'locked', percent: 50 }));

  hr('3) Quay số liên tục');
  // Giả lập TV trả kết quả bóng lăn NGAY (không đợi autoRollSeconds) để test nhanh.
  let finishedOk = false;
  admin.on('draw:rolling', ({ mode, drawn, gameId } = {}) => {
    if (mode !== 'physics') return;
    drawRollingAt = Date.now();
    const used = new Set(drawn || []);
    const available = [];
    for (let n = 1; n <= 90; n++) if (!used.has(n)) available.push(n);
    if (!available.length) return;
    const number = available[Math.floor(Math.random() * available.length)];
    setTimeout(() => admin.emit('draw:physics-result', { number, gameId }), 40);
  });
  admin.on('draw:result', () => {
    drawResults++;
    if (drawRollingAt) drawLatency.push(Date.now() - drawRollingAt);
    drawRollingAt = 0;
    console.log('__PROGRESS__:' + JSON.stringify({
      stage: 'draw', draws: drawResults,
      percent: Math.min(95, 50 + drawResults * 0.5),
    }));
  });
  admin.on('draw:error', () => { drawErrors++; });
  admin.on('game:finished', () => { finishedOk = true; });
  admin.on('game:limit-reached', () => { finishedOk = true; });

  for (let i = 0; i < 90 && !finishedOk; i++) {
    const result = event(admin, 'draw:result', () => true, 10000);
    admin.emit('draw:request', {});
    await result;
    // Chờ event game:finished/game:limit-reached được giao trước khi gửi lượt tiếp.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const snapshot = await (await fetch(`${url}/api/state`)).json();
    if (snapshot.maxWinnersReached) { finishedOk = true; break; }
  }
  if (!finishedOk) throw new Error('Không có người Kinh sau 90 lượt xổ');

  hr('KẾT QUẢ LOAD TEST');
  const successes = assigned + locked + drawResults;
  const failures = rejected + lockErrors + drawErrors;
  const errorRate = successes + failures ? (failures / (successes + failures)) * 100 : 0;
  row('Tổng request thành công', successes);
  row('Tổng request thất bại', failures);
  row('Tỷ lệ lỗi', `${errorRate.toFixed(2)}%`);

  const lockStats = stats(lockLatency);
  const drawStats = stats(drawLatency);
  row('Chốt vé · trung bình / p95 / p99', `${lockStats.avg}ms / ${lockStats.p95}ms / ${lockStats.p99}ms (n=${lockStats.count})`);
  row('Kết quả xổ · trung bình / p95 / p99', `${drawStats.avg}ms / ${drawStats.p95}ms / ${drawStats.p99}ms (n=${drawStats.count})`);

  // Kiểm tra nhất quán cuối ván.
  const state = await (await fetch(`${url}/api/state`)).json();
  const stateFile = path.join(__dirname, '..', 'data', 'game-state.json');
  let tickets = [];
  try { tickets = JSON.parse(fs.readFileSync(stateFile, 'utf8')).tickets || []; } catch {}
  const lockedTickets = tickets.filter((t) => t.locked && t.owner);
  const codes = lockedTickets.map((t) => t.code);
  const duplicateCodes = codes.length - new Set(codes).size;
  const ownerCounts = new Map();
  lockedTickets.forEach((t) => ownerCounts.set(t.owner, (ownerCounts.get(t.owner) || 0) + 1));
  const overOwned = [...ownerCounts.values()].filter((n) => n > 3).length;
  const expectedPrize = lockedTickets.length * betPerTicket;
  const prizeOk = state.prize === expectedPrize;
  const consistent = assigned === players && locked === players && drawResults > 0
    && duplicateCodes === 0 && overOwned === 0 && prizeOk;

  row('Vé đã chốt / kỳ vọng', `${lockedTickets.length} / ${assigned * 3}`);
  row('Tổng giải / tiền thu', `${state.prize}đ / ${expectedPrize}đ`);
  row('Mã vé trùng / chủ sở hữu > 3 vé', `${duplicateCodes} / ${overOwned}`);
  row('Số lượt xổ', drawResults);
  console.log('__IO__:' + JSON.stringify({
    input: { players, url, betPerTicket, maxTicketsPerPlayer: 3 },
    output: {
      success: successes, failures, errorRate: Number(errorRate.toFixed(2)),
      lockLatency: lockStats, drawLatency: drawStats,
      lockedTickets: lockedTickets.length, prize: state.prize, expectedPrize,
      duplicateCodes, overOwned, drawResults, consistent,
    },
  }));
  console.log(consistent
    ? '\n✅ ĐẠT: tải ổn định, dữ liệu nhất quán cuối ván.'
    : '\n❌ KHÔNG ĐẠT: kiểm tra lại các chỉ số trên.');

  sockets.forEach((socket) => socket.close());
  process.exit(consistent ? 0 : 1);
})().catch((error) => {
  console.error('❌ Load test lỗi:', error && error.message ? error.message : error);
  process.exit(1);
});
