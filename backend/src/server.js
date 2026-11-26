/* ============================================================
 * LÔ TÔ TẾT - SERVER
 * - Vé dò: 9 ô ngang x 9 ô dọc. 90 số (1..90) chia random cho 200 vé.
 * - Mỗi cột là một chục: 1-10, 11-20, ... 81-90, xếp tăng dần từ trên xuống.
 * - Người chơi: ĐỔI VÉ (chọn bộ khác) -> CHỐT VÉ.
 * - Màn hình chính chỉ hiện danh sách người ĐÃ CHỐT.
 * - KINH khi một hàng ngang đủ số. Hàng còn 1 số -> báo đợi số đó.
 * - Lưu mọi lượt xổ + lịch sử ván.
 * ============================================================ */

const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const stateMod = require('./state');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// Replace this derived value before any public deployment.
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || 'loto-tet-admin-v1';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ||
  'eda684c6fce2ec211dac0118fa995de83dfc91a3579e8e98ecab750c07b5707e';
const ADMIN_LOGIN_FAILURES = new Map();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const STATE_FILE = path.join(DATA_DIR, 'game-state.json');
const FINANCE_FILE = path.join(DATA_DIR, 'finance.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- Tiện ích ---------------- */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('[Lỗi ghi file]', e.message); }
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// Ưu tiên IP LAN thực tế: 192.168.x.x > 10.x.x.x > 172.16-31.x.x > IP khác.
function getLocalIP() {
  const priority = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  const candidates = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address) {
        candidates.push(iface.address);
      }
    }
  }
  if (!candidates.length) return 'localhost';
  candidates.sort((a, b) => priority(a) - priority(b));
  return candidates[0];
}
function makeId() {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}
function validAdminPassword(password) {
  // Use scrypt to avoid storing or comparing plaintext passwords.
  const derived = crypto.scryptSync(String(password || ''), ADMIN_PASSWORD_SALT, 32);
  const expected = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}

/* ---------------- Tạo lưới vé 9x9 ----------------
 * - Mỗi HÀNG có 9 ô: ĐỤC 4 ô (trống) -> còn ĐÚNG 5 ô có số.
 * - Mỗi CỘT là một chục: cột 1 = 1..9, cột 2 = 10..19, ... cột 9 = 80..90.
 * - Số trong mỗi cột xếp TĂNG DẦN từ trên xuống (số nhỏ nhất ở hàng trên cùng).
 * - Vị trí các ô bị đục được xáo trộn mỗi vé nên vé nào cũng khác nhau.
 */
const ROWS = 9;
const COLS = 9;
const PER_ROW = 5;   // 5 số / hàng (đục 4 ô)
function buildGrid(drawn) {
  const used = new Set(drawn || []);
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const offsets = shuffle([...Array(COLS).keys()]);   // xáo trộn vị trí các cột

  for (let c = 0; c < COLS; c++) {
    const lo = c === 0 ? 1 : c * 10;
    const hi = c === COLS - 1 ? 90 : c * 10 + 9;

    // Chọn 5 số ngẫu nhiên trong chục của cột, rồi xếp tăng dần
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    shuffle(pool);
    const nums = pool.slice(0, PER_ROW).sort((a, b) => a - b);

    // 5 hàng nhận số của cột này (mỗi hàng cũng nhận đúng 5 số tổng cộng)
    const rowSlots = [];
    for (let j = 0; j < PER_ROW; j++) rowSlots.push((offsets[c] + j) % ROWS);
    rowSlots.sort((a, b) => a - b);

    nums.forEach((value, i) => {
      grid[rowSlots[i]][c] = { value, matched: used.has(value) };
    });
  }

  return grid.map((cells) => {
    const unmatched = cells.filter(Boolean).filter((cell) => !cell.matched).length;
    return {
      cells,
      complete: unmatched === 0,
      awarded: unmatched === 0,   // hàng đã đủ trước khi nhận vé -> không tính giải
      waitingNotified: false,
      kinhPosition: null,
    };
  });
}

/* ---------------- Trạng thái game ---------------- */
// Chữ ký của vé = toàn bộ lưới (giá trị số + ô đục). Dùng để đảm bảo 200 vé KHÔNG trùng nhau.
function gridSignature(rows) {
  return rows.map((r) => r.cells.map((c) => (c ? c.value : '_')).join(',')).join('|');
}

function freshGame(config) {
  const cfg = Object.assign({
    maxPlayers: 200,           // tổng kho vé phát hành (V001..V200)
    maxTicketsPerPlayer: 3,    // tối đa vé mỗi người
    betPerTicket: 5000,
    maxWinners: 2,
    rollSeconds: 4.5,
    autoRollSeconds: 9,
    minNumber: 1,
    maxNumber: 90,
  }, config || {});
  const g = {
    id: makeId(),
    startedAt: Date.now(),
    config: cfg,
    tickets: [],   // 200 vé: { code, owner, name, locked, socketId, rows, won, joinedAt }
    drawn: [],
    winners: [],
    topWinners: (typeof game !== 'undefined' && game && Array.isArray(game.topWinners)) ? game.topWinners : [],
    payments: {},
    maxWinnersReached: false,
    settled: false,
  };
  const seen = new Set();
  for (let i = 0; i < cfg.maxPlayers; i++) {
    let rows;
    let signature;
    let tries = 0;
    // Sinh lại ngay nếu trùng một vé đã có trong kho
    do {
      rows = buildGrid([]);
      signature = gridSignature(rows);
      tries++;
    } while (seen.has(signature) && tries < 200);
    seen.add(signature);
    g.tickets.push({
      code: 'V' + String(i + 1).padStart(3, '0'),
      owner: null, name: '', locked: false, socketId: null,
      rows, won: false, joinedAt: null,
    });
  }
  return g;
}

let game = readJSON(STATE_FILE, null);
if (!game || !game.config || !Array.isArray(game.drawn) || !Array.isArray(game.tickets)) {
  game = freshGame();
}
game.config = Object.assign({ maxPlayers: 200, maxTicketsPerPlayer: 3, betPerTicket: 5000, maxWinners: 2, rollSeconds: 4.5, autoRollSeconds: 9, minNumber: 1, maxNumber: 90 }, game.config || {});
if (!Array.isArray(game.topWinners)) game.topWinners = [];
if (!game.payments || typeof game.payments !== 'object') game.payments = {};
if (typeof game.maxWinnersReached !== 'boolean') game.maxWinnersReached = false;
if (typeof game.settled !== 'boolean') game.settled = false;
let finances = readJSON(FINANCE_FILE, {});

// Đang trong lượt quay số (chưa chốt kết quả)
let rolling = false;
let pendingPhysicsDraw = null; // { snapshot, onDone, timer } - chờ bóng từ lồng cầu physics gửi lên

// Chế độ tự xổ liên tục cho đến khi có người KINH
let autoRunning = false;
let roundStartWinners = 0;
// Admin bật Bot đọc số:server giữ nhịp tự xổ chậm lại để giọng đọc kịp phát.
let botEnabled = false;
let sfxEnabled = true;
let announcerStyleIndex = 0;
let showRules = false;
let leaderboardVisible = false;

// Vé dùng để XEM TRƯỚC trên trang quản lý (tách riêng, không tính vào 200 vé)
let previewTickets = [];
let waitingPlayers = Array.isArray(game.waitingPlayers) ? game.waitingPlayers : [];
const joiningPlayers = new Map();

function uniquePlayerName(base, ignorePlayerId) {
  const used = new Set();
  game.tickets.filter((t) => t.owner && t.owner !== ignorePlayerId).forEach((t) => used.add(t.name));
  waitingPlayers.filter((w) => w.playerId !== ignorePlayerId).forEach((w) => used.add(w.name));
  joiningPlayers.forEach((player) => {
    if (player.playerId !== ignorePlayerId) used.add(player.name);
  });
  let name = String(base || '').trim().slice(0, 20);
  if (!name) name = `Người chơi ${used.size + 1}`;
  if (!used.has(name)) return name;
  let i = 2;
  let candidate;
  do {
    const suffix = ` (${i++})`;
    candidate = `${name.slice(0, 20 - suffix.length)}${suffix}`;
  } while (used.has(candidate));
  return candidate;
}
function financeKey(name) {
  return String(name || '').trim().toLocaleLowerCase('vi');
}
function accountFor(name) {
  const key = financeKey(name);
  if (!finances[key]) finances[key] = { name: String(name || ''), deposited: 0, winnings: 0, totalWon: 0, debt: 0, balance: 0, transactions: [] };
  const account = finances[key];
  if (!Number.isFinite(Number(account.deposited))) account.deposited = Number(account.balance) || 0;
  if (!Number.isFinite(Number(account.balance))) account.balance = Number(account.deposited) || 0;
  // totalWon = tổng tiền thắng TÍCH LŨY (không bị trừ khi trả thưởng/cấn nợ).
  if (!Number.isFinite(Number(account.totalWon))) account.totalWon = 0;
  if (!Array.isArray(account.transactions)) account.transactions = [];
  return account;
}
function saveFinances() { writeJSON(FINANCE_FILE, finances); }
function positiveMoney(value) {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}
function maxTicketsPerPlayer() {
  return Math.max(1, Math.min(10, Number(game.config.maxTicketsPerPlayer) || 3));
}
function appendFinanceTransaction(account, type, amount, extra = {}) {
  account.transactions.push({ type, amount, ...extra, at: Date.now() });
  account.transactions = account.transactions.slice(-200);
}
function markPaymentFromWallet(playerId, status) {
  const player = lockedPlayers().find((entry) => entry.playerId === playerId);
  if (!player) return;
  const current = game.payments[playerId];
  if (current && current.status === status) return;
  if (current && current.status !== 'pending') return;
  const account = accountFor(player.name);
  game.payments[playerId] = {
    status,
    paid: status === 'paid' ? player.bet : 0,
    debt: account.debt,
    updatedAt: Date.now(),
  };
  persistState();
}
function creditWallet(playerId, amount, type, reason, fallbackName) {
  const name = playerNameForId(playerId) || fallbackName;
  if (!name || !amount) return false;
  const resolvedId = playerNameForId(playerId) ? playerId : playerIdForName(name);
  const account = accountFor(name);
  if (type === 'deposit') {
    account.deposited += amount;
    account.balance += amount;
  } else if (type === 'loan') {
    account.debt += amount;
    account.balance += amount;
  } else {
    return false;
  }
  appendFinanceTransaction(account, type, amount, { reason });
  saveFinances();
  const player = lockedPlayers().find((entry) => entry.playerId === playerId);
  if (type === 'loan') {
    markPaymentFromWallet(playerId, 'debt');
  } else if (player && amount >= player.bet) {
    markPaymentFromWallet(playerId, 'paid');
  }
  emitWalletSummary(resolvedId || playerId);
  emitHostState();
}
function renameFinanceAccount(oldName, newName) {
  const oldKey = financeKey(oldName);
  const newKey = financeKey(newName);
  if (!oldKey || oldKey === newKey) {
    if (finances[newKey]) finances[newKey].name = newName;
    return;
  }
  const oldAccount = finances[oldKey];
  if (!oldAccount) return;
  const target = accountFor(newName);
  target.winnings += Number(oldAccount.winnings) || 0;
  target.totalWon = (Number(target.totalWon) || 0) + (Number(oldAccount.totalWon) || 0);
  target.debt += Number(oldAccount.debt) || 0;
  target.balance += Number(oldAccount.balance) || 0;
  target.deposited += Number(oldAccount.deposited ?? oldAccount.balance) || 0;
  target.transactions = [...(oldAccount.transactions || []), ...(target.transactions || [])].slice(-200);
  target.name = newName;
  delete finances[oldKey];
}
function leaderboard() {
  // Chỉ xếp hạng theo thành tích totalWon > 0, giảm dần.
  return Object.values(finances)
    .map((account) => ({
      name: account.name,
      totalWon: Number(account.totalWon) || 0,
      winnings: Number(account.winnings) || 0, // giữ alias cho client/test cũ
    }))
    .filter((entry) => entry.totalWon > 0)
    .sort((a, b) => b.totalWon - a.totalWon || a.name.localeCompare(b.name, 'vi'));
}

function playerProgress(ticket) {
  let minRemaining = 99;
  let waitingRows = 0;
  (ticket.rows || []).forEach((row) => {
    const nums = (row.cells || []).filter(Boolean).map((c) => c.value);
    const remaining = nums.filter((v) => !(game.drawn || []).includes(v)).length;
    if (remaining < minRemaining) minRemaining = remaining;
    if (remaining === 1) waitingRows++;
  });
  return { minRemaining: minRemaining === 99 ? 0 : minRemaining, waitingRows };
}

function assignWaitingPlayers() {
  const still = [];
  for (const w of waitingPlayers) {
    const want = Math.max(1, Math.min(maxTicketsPerPlayer(), Number(w.ticketCount) || 1));
    const free = game.tickets.filter((t) => !t.owner);
    if (free.length < want) { still.push(w); continue; }
    shuffle(free);
    const owned = free.slice(0, want);
    owned.forEach((t) => giveTicket(t, w.playerId, w.name, w.socketId));
    if (w.socketId) {
      const sock = io.sockets.sockets.get(w.socketId);
      if (sock) sock.emit('ticket:assigned', multiPayload(w.playerId));
    }
  }
  waitingPlayers = still;
  persistState();
  emitHostState();
}

function persistState() {
  game.waitingPlayers = waitingPlayers;
  writeJSON(STATE_FILE, game);
}
// Throttle phát host:state trong lúc tự xổ để giảm tải socket/UI.
let lastHostStateAt = 0;
function emitHostStateThrottled(minGapMs = 450) {
  const now = Date.now();
  if (now - lastHostStateAt < minGapMs) return;
  lastHostStateAt = now;
  emitHostState();
}
function appendHistory() {
  const history = readJSON(HISTORY_FILE, []);
  history.unshift({
    id: game.id, startedAt: game.startedAt, endedAt: Date.now(),
    config: game.config, drawn: game.drawn, winners: game.winners,
    players: lockedPlayers().length, issued: game.tickets.filter((t) => t.owner).length,
  });
  writeJSON(HISTORY_FILE, history.slice(0, 50));
}
// Tổng giải = tổng tiền cược thực thu = số vé đã bán × mức cược/vé
function prizePool() {
  const sold = game.tickets.filter((t) => t.owner && t.locked).length;
  return sold * (Number(game.config.betPerTicket) || 0);
}
function prizePerWinner() {
  const pool = prizePool();
  if (!game.winners.length) return pool;
  // Chia đều và làm tròn xuống bội số 1.000đ cho gọn khi trả thưởng.
  return Math.max(0, Math.floor(pool / game.winners.length / 1000) * 1000);
}
function lockedPlayers() {
  const map = new Map();
  game.tickets.filter((t) => t.locked && t.owner).forEach((t) => {
    if (!map.has(t.owner)) {
      map.set(t.owner, {
        playerId: t.owner,
        name: t.name,
        codes: [],
        kinh: 0,
        bet: 0,
        minRemaining: 99,
        waitingRows: 0,
      });
    }
    const p = map.get(t.owner);
    p.codes.push(t.code);
    p.bet += Number(game.config.betPerTicket) || 0;
    if (t.won) p.kinh += game.winners.filter((w) => w.playerId === t.owner).length;
    const prog = playerProgress(t);
    p.minRemaining = Math.min(p.minRemaining, prog.minRemaining);
    p.waitingRows += prog.waitingRows;
  });
  return [...map.values()].map((p) => ({
    playerId: p.playerId,
    code: p.codes.join(', '),
    name: p.name,
    kinh: p.kinh,
    bet: p.bet,
    minRemaining: p.minRemaining === 99 ? 0 : p.minRemaining,
    waitingRows: p.waitingRows,
    paymentStatus: (game.payments[p.playerId] && game.payments[p.playerId].status) || 'pending',
    deposited: Number(accountFor(p.name).deposited ?? accountFor(p.name).balance) || 0,
    debt: Number(accountFor(p.name).debt) || 0,
    winnings: Number(accountFor(p.name).winnings) || 0,
    totalWon: Number(accountFor(p.name).totalWon) || 0,
    balance: Number(accountFor(p.name).balance) || 0,
  }));
}
function adminPlayers() {
  const participants = new Map();
  game.tickets.filter((ticket) => ticket.owner).forEach((ticket) => {
    let player = participants.get(ticket.owner);
    if (!player) {
      const account = accountFor(ticket.name);
      player = {
        playerId: ticket.owner, name: ticket.name, codes: [], kinh: 0, bet: 0,
        minRemaining: 99, waitingRows: 0, locked: true, waitingNextRound: false, ticketCount: 0,
        paymentStatus: (game.payments[ticket.owner] || {}).status || 'pending',
        deposited: Number(account.deposited ?? account.balance) || 0,
        debt: Number(account.debt) || 0, winnings: Number(account.winnings) || 0,
        totalWon: Number(account.totalWon) || 0,
        balance: Number(account.balance) || 0,
      };
      participants.set(ticket.owner, player);
    }
    player.ticketCount++;
    player.codes.push(ticket.code);
    player.locked = player.locked && ticket.locked;
    if (ticket.won) player.kinh = game.winners.filter((winner) => winner.playerId === ticket.owner).length;
    const progress = playerProgress(ticket);
    player.minRemaining = Math.min(player.minRemaining, progress.minRemaining);
    player.waitingRows += progress.waitingRows;
    if (ticket.locked) player.bet += Number(game.config.betPerTicket) || 0;
  });
  waitingPlayers.forEach((waiting) => {
    if (participants.has(waiting.playerId)) return;
    const account = accountFor(waiting.name);
    participants.set(waiting.playerId, {
      playerId: waiting.playerId, name: waiting.name, code: '', ticketCount: waiting.ticketCount || 0,
      kinh: 0, bet: 0, minRemaining: 0, waitingRows: 0, locked: false, waitingNextRound: true,
      paymentStatus: 'pending', debt: Number(account.debt) || 0,
      deposited: Number(account.deposited ?? account.balance) || 0,
      winnings: Number(account.winnings) || 0, balance: Number(account.balance) || 0,
    });
  });
  joiningPlayers.forEach((joining) => {
    if (participants.has(joining.playerId)) return;
    const account = finances[financeKey(joining.name)] || {};
    participants.set(joining.playerId, {
      playerId: joining.playerId, name: joining.name, code: '', ticketCount: 0,
      kinh: 0, bet: 0, minRemaining: 0, waitingRows: 0, locked: false,
      waitingNextRound: false, awaitingTicket: true, paymentStatus: 'pending',
      deposited: Number(account.deposited ?? account.balance) || 0,
      debt: Number(account.debt) || 0, winnings: Number(account.winnings) || 0,
      balance: Number(account.balance) || 0,
    });
  });
  return [...participants.values()].map((player) => ({
    ...player, code: (player.codes || []).join(', '),
    minRemaining: player.minRemaining === 99 ? 0 : player.minRemaining,
  }));
}
function tvParticipants() {
  const participants = new Map();
  game.tickets.filter((ticket) => ticket.owner).forEach((ticket) => {
    let participant = participants.get(ticket.owner);
    if (!participant) {
      participant = {
        name: ticket.name,
        ticketCount: 0,
        locked: true,
        minRemaining: 99,
        waitingRows: 0,
      };
      participants.set(ticket.owner, participant);
    }
    participant.ticketCount++;
    participant.locked = participant.locked && ticket.locked;
    const progress = playerProgress(ticket);
    participant.minRemaining = Math.min(participant.minRemaining, progress.minRemaining);
    participant.waitingRows += progress.waitingRows;
  });
  waitingPlayers.forEach((player) => {
    if (participants.has(player.playerId)) return;
    participants.set(player.playerId, {
      name: player.name,
      ticketCount: player.ticketCount || 0,
      locked: false,
      waitingNextRound: true,
      minRemaining: 0,
      waitingRows: 0,
    });
  });
  joiningPlayers.forEach((player) => {
    if (participants.has(player.playerId)) return;
    participants.set(player.playerId, {
      name: player.name,
      ticketCount: 0,
      locked: false,
      awaitingTicket: true,
      minRemaining: 0,
      waitingRows: 0,
    });
  });
  return [...participants.values()].map((participant) => ({
    ...participant,
    minRemaining: participant.minRemaining === 99 ? 0 : participant.minRemaining,
  }));
}
function rowNumbers(row) { return row.cells.filter(Boolean); }
function countWaiting() {
  let n = 0;
  game.tickets.forEach((t) => {
    if (!t.owner) return;
    t.rows.forEach((r) => {
      if (!r.complete && rowNumbers(r).filter((c) => !c.matched).length === 1) n++;
    });
  });
  return n;
}
function serializeRows(ticket) {
  return ticket.rows.map((row, i) => {
    const nums = rowNumbers(row);
    const waiting = !row.complete && nums.filter((n) => !n.matched).length === 1;
    const missing = waiting ? nums.find((n) => !n.matched).value : null;
    return {
      index: i + 1,
      cells: row.cells.map((c) => (c ? { value: c.value, matched: c.matched } : null)),
      complete: row.complete, kinhPosition: row.kinhPosition,
      waiting, missing,
    };
  });
}
function serializeTicket(ticket) {
  return {
    code: ticket.code, name: ticket.name, locked: ticket.locked,
    rows: serializeRows(ticket), drawn: game.drawn,
    config: game.config,
  };
}
function findTickets(playerId) { return game.tickets.filter((t) => t.owner === playerId); }
function walletSummaryForName(name) {
  const account = accountFor(name);
  return {
    deposited: Number(account.deposited ?? account.balance) || 0,
    winnings: Number(account.winnings) || 0,
    debt: Number(account.debt) || 0,
  };
}
function playerNameForId(playerId) {
  return game.tickets.find((ticket) => ticket.owner === playerId)?.name
    || waitingPlayers.find((player) => player.playerId === playerId)?.name
    || joiningPlayers.get(playerId)?.name
    || '';
}
function playerIdForName(name) {
  const target = String(name || '').trim();
  if (!target) return '';
  const ticket = game.tickets.find((t) => t.owner && t.name === target);
  if (ticket) return ticket.owner;
  const waiting = waitingPlayers.find((w) => w.name === target);
  if (waiting) return waiting.playerId;
  const joining = [...joiningPlayers.values()].find((j) => j.name === target);
  if (joining) return joining.playerId;
  return '';
}
function emitWalletSummary(playerId) {
  const name = playerNameForId(playerId);
  if (!name) return;
  const socketIds = new Set(findTickets(playerId).map((ticket) => ticket.socketId).filter(Boolean));
  const waiting = waitingPlayers.find((player) => player.playerId === playerId);
  const joining = joiningPlayers.get(playerId);
  if (waiting && waiting.socketId) socketIds.add(waiting.socketId);
  if (joining && joining.socketId) socketIds.add(joining.socketId);
  const summary = walletSummaryForName(name);
  socketIds.forEach((id) => io.to(id).emit('wallet:summary', summary));
}

// Gói dữ liệu tất cả vé của một người chơi (hỗ trợ mua nhiều vé)
function multiPayload(playerId, activeCode) {
  const owned = findTickets(playerId);
  const active = owned.find((t) => t.code === activeCode) || owned[0];
  return {
    code: active ? active.code : '',
    name: active ? active.name : '',
    locked: active ? active.locked : false,
    rows: active ? serializeRows(active) : [],
    activeCode: active ? active.code : '',
    tickets: owned.map((t) => ({
      code: t.code, name: t.name, locked: t.locked, won: t.won,
      rows: serializeRows(t),
    })),
    drawn: game.drawn,
    config: game.config,
    gameId: game.id,
    wallet: active ? walletSummaryForName(active.name) : null,
  };
}
function previewPayload(pv) {
  return previewMultiPayload(pv.playerId, pv.code);
}
function previewMultiPayload(playerId, activeCode) {
  const owned = previewTickets.filter((t) => t.playerId === playerId);
  const active = owned.find((t) => t.code === activeCode) || owned[0];
  return {
    code: active ? active.code : '',
    name: active ? active.name : '',
    locked: active ? active.locked : false,
    rows: active ? serializeRows(active) : [],
    activeCode: active ? active.code : '',
    tickets: owned.map((t) => ({
      code: t.code, name: t.name, locked: t.locked, won: t.won, rows: serializeRows(t),
    })),
    drawn: game.drawn, config: game.config, gameId: game.id,
  };
}
function emitHostState() {
  const state = {
    config: game.config,
    drawn: game.drawn,
    winners: game.winners,
    topWinners: game.topWinners || [],
    playerCount: lockedPlayers().length,
    issuedCount: game.tickets.filter((t) => t.owner).length,
    maxPlayers: game.config.maxPlayers,
    waitingCount: countWaiting(),
    waitingPlayers: waitingPlayers.length,
    showRules,
    rulesVisible: showRules,
    leaderboardVisible,
    leaderboard: leaderboard(),
    maxWinnersReached: game.maxWinnersReached,
    botEnabled: botEnabled,
    sfxEnabled: sfxEnabled,
    announcerStyle: announcerStyleIndex,
    prize: prizePool(),
    prizePerWinner: prizePerWinner(),
    players: adminPlayers(),
    history: readJSON(HISTORY_FILE, []),
  };
  io.to('admins').emit('host:state', state);
  const publicState = Object.assign({}, state, {
    players: state.players.map(({ playerId, paymentStatus, debt, bet, balance, winnings, ...player }) => player),
    participants: tvParticipants(),
    leaderboard: leaderboardVisible ? state.leaderboard : [],
  });
  io.emit('tv:state', publicState);
}

// Bật/tắt bảng luật trên TV. Khi tắt do Admin bắt đầu quay số, TV nhận event ngay.
function setRulesVisible(visible) {
  const next = !!visible;
  if (showRules === next) return;
  showRules = next;
  io.emit('tv:rules', { visible: showRules });
}

// Ván được coi là kết thúc khi đủ số người Kinh (hoặc maxWinners = 0 và có >= 1 Kinh).
function isRoundComplete() {
  const limit = Number(game.config.maxWinners) || 0;
  return limit > 0 ? game.winners.length >= limit : game.winners.length > 0;
}

// Chốt ván: trả thưởng vào ví + thành tích, ghi lịch sử. Trả false nếu đã chốt trước đó.
function settleGame() {
  if (game.settled) return false;
  const paidPlayers = new Set();
  (game.winners || []).forEach((w) => {
    if (!game.topWinners.find((t) => t.playerId === w.playerId)) {
      game.topWinners.push({ playerId: w.playerId, name: w.name, wins: 1 });
    } else {
      const t = game.topWinners.find((x) => x.playerId === w.playerId);
      t.wins = (t.wins || 0) + 1;
      t.name = w.name;
    }
    const account = accountFor(w.name);
    const amount = prizePerWinner();
    const debtOffset = Math.min(Number(account.debt) || 0, amount);
    account.winnings += amount;       // reward/pendingReward - dùng trả thưởng & cấn nợ
    account.totalWon += amount;       // thành tích tích lũy - KHÔNG bị trừ khi trả thưởng
    account.balance += amount - debtOffset;
    appendFinanceTransaction(account, 'prize', amount, { gameId: game.id });
    if (debtOffset > 0) {
      account.debt -= debtOffset;
      appendFinanceTransaction(account, 'debt-offset', -debtOffset, {
        reason: 'Trừ nợ từ tiền thưởng', gameId: game.id,
      });
    }
    if (game.payments[w.playerId]) game.payments[w.playerId].debt = account.debt;
    paidPlayers.add(w.playerId);
  });
  game.settled = true;
  saveFinances();
  persistState();
  appendHistory();
  paidPlayers.forEach((playerId) => emitWalletSummary(playerId));
  return true;
}

/* ---------------- QR ---------------- */
function buildJoinUrl() { return `http://${getLocalIP()}:${PORT}/play.html`; }
function sendQR(target) {
  const joinUrl = buildJoinUrl();
  const tvUrl = joinUrl.replace(/\/play\.html$/, '/tv.html');
  QRCode.toDataURL(joinUrl, {
    width: 360, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#8a0f10', light: '#fff8e7' },
  }).then((dataUrl) => {
    (target ? io.to(target) : io).emit('qr:ready', { dataUrl, joinUrl, tvUrl });
  }).catch((e) => console.error('[QR]', e.message));
}

/* ---------------- Gán / đổi vé ---------------- */
function releaseTicket(ticket) {
  ticket.owner = null;
  ticket.socketId = null;
  ticket.name = '';
  ticket.won = false;
  ticket.joinedAt = null;
  ticket.rows.forEach((r) => {
    r.cells.forEach((c) => { if (c) c.matched = false; });
    r.complete = false; r.awarded = false;
    r.waitingNotified = false; r.kinhPosition = null;
  });
}
function giveTicket(ticket, playerId, name, socketId) {
  ticket.owner = playerId;
  ticket.socketId = socketId;
  ticket.name = String(name || 'Người chơi').slice(0, 20);
  ticket.joinedAt = Date.now();
  // Đánh dấu các số đã xổ trước đó
  ticket.rows.forEach((r) => {
    r.cells.forEach((c) => { if (c && stateMod.hasDrawn(c.value)) c.matched = true; });
    const unmatched = rowNumbers(r).filter((c) => !c.matched).length;
    r.complete = unmatched === 0;
    r.awarded = unmatched === 0;
    r.waitingNotified = false;
    r.kinhPosition = null;
  });
  ticket.won = false;
}
function pickFreeTicket(exclude) {
  const free = game.tickets.filter((t) => !t.owner && t !== exclude);
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

/* ---------------- Xổ số (quay rồi chốt) ---------------- */
function doDraw(manualNumber, onDone, durationOverride) {
  // Bắt đầu quay số thì luật chơi phải biến mất để không che lồng cầu.
  setRulesVisible(false);
  if (game.maxWinnersReached) {
    io.emit('draw:error', { message: 'Đã đạt số người KINH tối đa của ván này.' });
    return;
  }
  const players = lockedPlayers();
  if (!players.length) {
    io.emit('draw:error', { message: 'Chưa có người chơi chốt vé. Không thể bắt đầu xổ số.' });
    return;
  }
  // Lần xổ đầu tiên của ván: kiểm tra và trừ tiền cược
  if (game.drawn.length === 0) {
    const insufficient = [];
    for (const p of players) {
      const account = accountFor(p.name);
      const bet = p.bet || 0;
      if ((Number(account.deposited) || 0) < bet) {
        insufficient.push(`${p.name} (thiếu ${(bet - (Number(account.deposited) || 0)).toLocaleString('vi-VN')}đ)`);
      }
    }
    if (insufficient.length) {
      io.emit('draw:error', { message: `Không đủ số dư: ${insufficient.join(', ')}. Vui lòng nạp thêm.` });
      return;
    }
    for (const p of players) {
      const account = accountFor(p.name);
      const bet = p.bet || 0;
      account.deposited -= bet;
      account.balance -= bet;
      appendFinanceTransaction(account, 'game-start', -bet, { gameId: game.id });
      saveFinances();
      emitWalletSummary(p.playerId);
    }
  }
  if (rolling) {
    io.emit('draw:error', { message: 'Đang quay số, vui lòng đợi…' });
    return;
  }
  const cfg = game.config;
  const manual = manualNumber !== undefined && manualNumber !== null && manualNumber !== '';
  let manualNum = null;
  if (manual) {
    manualNum = Number(manualNumber);
    if (!Number.isInteger(manualNum) || manualNum < cfg.minNumber || manualNum > cfg.maxNumber || stateMod.hasDrawn(manualNum)) {
      io.emit('draw:error', { message: 'Số không hợp lệ hoặc đã được xổ.' });
      return;
    }
  } else {
    let hasAvailable = false;
    for (let n = cfg.minNumber; n <= cfg.maxNumber; n++) {
      if (!stateMod.hasDrawn(n)) { hasAvailable = true; break; }
    }
    if (!hasAvailable) { io.emit('draw:error', { message: 'Đã xổ hết các số!' }); return; }
  }

  const duration = durationOverride
    ? Math.max(300, Math.min(20000, Number(durationOverride)))
    : Math.max(1000, Math.min(20000, (Number(cfg.rollSeconds) || 6) * 1000));
  const snapshot = game;              // nếu đổi ván trong lúc quay thì bỏ kết quả cũ
  rolling = true;
  io.emit('draw:rolling', {
    duration, min: cfg.minNumber, max: cfg.maxNumber,
    mode: manual ? 'manual' : 'physics', drawn: game.drawn.slice(),
  });

  if (manual) {
    setTimeout(() => {
      if (game !== snapshot) { rolling = false; return; }
      commitDraw(manualNum, snapshot, onDone);
    }, duration);
    return;
  }

  // Chế độ physics: TV sẽ chạy mô phỏng và gửi số bóng lọt qua sensor lên
  pendingPhysicsDraw = { snapshot, onDone };
  pendingPhysicsDraw.timer = setTimeout(() => {
    if (pendingPhysicsDraw && pendingPhysicsDraw.snapshot === snapshot) {
      pendingPhysicsDraw = null;
      rolling = false;
      io.emit('draw:error', { message: 'Không nhận được kết quả từ lồng cầu. Vui lòng thử lại.' });
      if (autoRunning) {
        autoRunning = false;
        io.emit('auto:state', { running: false });
      }
      if (typeof onDone === 'function') onDone();
    }
  }, 20000);
}

function commitDraw(num, snapshot, onDone) {
  if (game !== snapshot) { rolling = false; return; }
  game.drawn.push(num);

    const newKinh = [];
    const newWaiting = [];
    // Cho phép các vé ĐỒNG KINH trong CÙNG lượt này vượt số người thắng tối đa,
    // nhưng không nhận thêm ở các lượt sau khi đã đạt giới hạn.
    const winnersAtDrawStart = game.winners.length;

    game.tickets.forEach((ticket) => {
      // Chỉ vé đã CHỐT mới được xét Kinh và tính vào giải.
      if (!ticket.owner || !ticket.locked) return;
      ticket.rows.forEach((row, ri) => {
        rowNumbers(row).forEach((c) => { if (c.value === num) c.matched = true; });
        const unmatched = rowNumbers(row).filter((c) => !c.matched);
        row.complete = unmatched.length === 0;

        if (row.complete && !row.awarded) {
          if (game.config.maxWinners > 0
            && game.winners.length >= game.config.maxWinners
            && game.winners.length === winnersAtDrawStart) {
            row.awarded = true;
            return;
          }
          // Mỗi vé chỉ được tính KINH 1 lần trong ván (dù có nhiều hàng hoàn thành).
          if (game.winners.some((winner) => winner.code === ticket.code)) {
            row.awarded = true;
            return;
          }
          row.awarded = true;
          ticket.won = true;
          row.kinhPosition = game.winners.length + 1;
          const winner = {
            playerId: ticket.owner, code: ticket.code, name: ticket.name, row: ri + 1,
            position: row.kinhPosition, time: Date.now(), acked: false,
            // Mini ticket preview trên TV: lưới 9x9 + hàng vừa Kinh để đối chiếu.
            ticketRows: serializeRows(ticket),
          };
          game.winners.push(winner);
          newKinh.push({ ticket, winner });
        } else if (!row.complete && unmatched.length === 1 && !row.waitingNotified) {
          row.waitingNotified = true;
          newWaiting.push({ ticket, row: ri + 1, missing: unmatched[0].value });
        }
      });
    });

    // Vé xem trước: đánh dấu & báo kinh/đợi nhưng KHÔNG tính vào giải/danh sách
    previewTickets.forEach((ticket) => {
      ticket.rows.forEach((row, ri) => {
        rowNumbers(row).forEach((c) => { if (c.value === num) c.matched = true; });
        const unmatched = rowNumbers(row).filter((c) => !c.matched);
        row.complete = unmatched.length === 0;

        if (row.complete && !row.awarded) {
          row.awarded = true;
          ticket.won = true;
          ticket.previewKinhCount = (ticket.previewKinhCount || 0) + 1;
          row.kinhPosition = ticket.previewKinhCount;
          if (ticket.socketId) {
            io.to(ticket.socketId).emit('kinh:notify', {
              winner: {
                playerId: ticket.playerId, code: ticket.code, name: 'XEM TRƯỚC',
                row: ri + 1, position: row.kinhPosition, time: Date.now(),
              },
              prize: prizePool(), prizePerWinner: prizePool(), totalWinners: 1,
            });
          }
        } else if (!row.complete && unmatched.length === 1 && !row.waitingNotified) {
          row.waitingNotified = true;
          if (ticket.socketId) {
            io.to(ticket.socketId).emit('row:waiting', {
              row: ri + 1, missing: unmatched[0].value, name: 'XEM TRƯỚC',
            });
          }
        }
      });
    });
    const previewSockets = new Set();
    previewTickets.forEach((ticket) => {
      if (ticket.socketId && !previewSockets.has(ticket.socketId)) {
        previewSockets.add(ticket.socketId);
        io.to(ticket.socketId).emit('ticket:update', previewMultiPayload(ticket.playerId));
      }
    });

    // Ghi đồng bộ nhưng chỉ định kỳ vài lượt: tránh chồng async writes làm hỏng file,
    // vẫn giảm đáng kể số lần write so với mỗi lượt xổ.
    if (game.drawn.length % 5 === 0) persistState();
    io.emit('draw:result', { number: num, drawn: game.drawn });

    // Người gần KINH (hàng còn đúng 1 số)
    const nearPlayers = [];
    const seenNear = new Set();
    game.tickets.forEach((ticket) => {
      if (!ticket.owner || !ticket.locked || seenNear.has(ticket.owner)) return;
      ticket.rows.forEach((row, ri) => {
        const nums = rowNumbers(row);
        const remaining = nums.filter((c) => !c.matched).length;
        if (remaining === 1 && !seenNear.has(ticket.owner)) {
          seenNear.add(ticket.owner);
          nearPlayers.push({ name: ticket.name, row: ri + 1, missing: nums.find((c) => !c.matched).value });
        }
      });
    });
    io.emit('near:kinh', { players: nearPlayers });

    const updatedSockets = new Set();
    game.tickets.forEach((ticket) => {
      if (ticket.socketId && !updatedSockets.has(ticket.socketId)) {
        updatedSockets.add(ticket.socketId);
        io.to(ticket.socketId).emit('ticket:update', multiPayload(ticket.owner));
      }
    });
    newWaiting.forEach(({ ticket, row, missing }) => {
      if (ticket.socketId) {
        io.to(ticket.socketId).emit('row:waiting', { row, missing, name: ticket.name });
      }
    });
    newKinh.forEach(({ ticket, winner }) => {
      if (ticket.socketId) {
        io.to(ticket.socketId).emit('kinh:notify', {
          winner, prize: prizePool(),
          prizePerWinner: prizePerWinner(), totalWinners: game.winners.length,
        });
      }
    });
    const limit = Number(game.config.maxWinners) || 0;
    const reached = limit > 0 ? game.winners.length >= limit : game.winners.length > 0;
    if (newKinh.length && !reached) {
      // Chưa đủ người Kinh: banner phụ, KHÔNG dừng tự xổ, KHÔNG hiện overlay vinh danh.
      const last = newKinh[newKinh.length - 1].winner;
      io.emit('kinh:progress', {
        count: game.winners.length, limit,
        message: `Đã có ${game.winners.length}/${limit || '?'} người Kinh: ${last.name} (Vé ${last.code}) — Đang tiếp tục xổ...`,
        winner: last,
      });
      io.emit('host:kinh', {
        winners: game.winners, prizePerWinner: prizePerWinner(),
        latest: newKinh.map((w) => w.winner),
      });
    }
    if (reached) {
      // Đạt điều kiện dừng: dừng tự xổ + bật bảng vinh danh trên TV/admin.
      if (!game.maxWinnersReached) {
        game.maxWinnersReached = true;
        if (autoRunning) {
          autoRunning = false;
          io.emit('auto:state', { running: false });
          io.emit('auto:stopped', Object.assign(buildRoundSummary(), { maxWinnersReached: true }));
        }
        io.emit('game:limit-reached', {
          maxWinners: limit, winnerCount: game.winners.length,
          winners: game.winners,
          prizePerWinner: prizePerWinner(),
        });
        persistState();
        // Chốt ván ngay: chia giải vào ví thưởng + thành tích, ghi lịch sử.
        if (settleGame()) {
          io.emit('game:finished', {
            winners: game.winners, drawn: game.drawn, topWinners: game.topWinners,
            prizePerWinner: prizePerWinner(),
          });
        }
      }
    }
    rolling = false;
    emitHostStateThrottled();
    if (typeof onDone === 'function') onDone();
}

/* ---------------- Tự xổ đến khi có KINH ---------------- */
function buildRoundSummary() {
  const pool = prizePool();
  const roundWinners = game.winners.slice(roundStartWinners);
  const per = roundWinners.length ? Math.floor(pool / roundWinners.length) : 0;

  const map = new Map();
  game.tickets.filter((t) => t.owner).forEach((t) => {
    let p = map.get(t.owner);
    if (!p) {
      p = { playerId: t.owner, name: t.name, tickets: 0, bet: 0, kinh: 0, win: 0, net: 0 };
      map.set(t.owner, p);
    }
    p.tickets++;
    p.bet += Number(game.config.betPerTicket) || 0;
  });
  roundWinners.forEach((w) => {
    const p = map.get(w.playerId);
    if (p) { p.kinh++; p.win += per; }
  });
  const players = [...map.values()].map((p) => Object.assign(p, { net: p.win - p.bet }));
  players.sort((a, b) => b.net - a.net);

  return {
    pool, per, winnerCount: roundWinners.length,
    winners: roundWinners, players,
    drawn: game.drawn.slice(),
  };
}

function nextAutoDraw() {
  if (!autoRunning) return;
  // Hết số thì dừng
  const available = [];
  for (let n = game.config.minNumber; n <= game.config.maxNumber; n++) {
    if (!stateMod.hasDrawn(n)) available.push(n);
  }
  if (!available.length) {
    autoRunning = false;
    io.emit('auto:stopped', Object.assign(buildRoundSummary(), { exhausted: true }));
    io.emit('auto:state', { running: false });
    return;
  }
  const autoMs = Math.max(300, Math.min(30000, (Number(game.config.autoRollSeconds) || 6) * 1000));
  doDraw(undefined, () => {
    if (!autoRunning) return;
    // Chỉ DỪNG khi đã đạt điều kiện kết thúc ván (đủ số người Kinh).
    // Nếu mới có 1/2 người Kinh thì TIẾP TỤC tự xổ.
    const limit = Number(game.config.maxWinners) || 0;
    const reached = limit > 0 ? game.winners.length >= limit : game.winners.length > 0;
    if (reached) {
      autoRunning = false;
      io.emit('auto:state', { running: false });
      io.emit('auto:stopped', buildRoundSummary());
    } else {
      // Khi bật Bot đọc số: lượt tự xổ kế tiếp chỉ chạy sau khi giọng đọc
      // hiện tại phát ít nhất 2.5 giây.
      setTimeout(nextAutoDraw, botEnabled ? 2500 : 400);
    }
  }, autoMs);
}

/* ---------------- Socket ---------------- */
io.on('connection', (socket) => {
  // realtime.js quản lý client + sync:full khi mới kết nối.
  try { require('./realtime').addClient(socket); } catch (e) {}
  socket.use(([event], next) => {
    const privileged = new Set([
      'host:register', 'settings:update', 'config:update', 'game:new', 'game:finish',
      'draw:request', 'auto:start', 'auto:stop', 'admin:rename-player',
      'admin:kick-player', 'admin:kick-all', 'admin:adjust-wallet', 'admin:set-payment', 'admin:clear-debt',
      'admin:wallet-set',
      'admin:wallet-deposit-quick', 'admin:wallet-deposit', 'admin:wallet-loan',
      'admin:zero-balance', 'tv:rules', 'tv:leaderboard',
      'admin:reset-achievements', 'admin:wipe-all-data',
      'admin:pay-reward', 'admin:offset-debt', 'admin:next-round',
      'bot:state', 'announcer:style', 'sfx:state',
    ]);
    if (privileged.has(event) && !socket.data.isAdmin) {
      socket.emit('admin:required');
      return;
    }
    next();
  });
  socket.on('admin:login', ({ password } = {}) => {
    const address = socket.handshake.address || 'unknown';
    const attempts = ADMIN_LOGIN_FAILURES.get(address) || { count: 0, blockedUntil: 0 };
    if (attempts.blockedUntil > Date.now()) {
      socket.emit('admin:login-failed', { message: 'Quá nhiều lần thử. Vui lòng chờ một phút.' });
      return;
    }
    if (!validAdminPassword(password)) {
      attempts.count++;
      if (attempts.count >= 5) {
        attempts.count = 0;
        attempts.blockedUntil = Date.now() + 60_000;
      }
      ADMIN_LOGIN_FAILURES.set(address, attempts);
      socket.emit('admin:login-failed', { message: 'Mật khẩu không đúng.' });
      return;
    }
    ADMIN_LOGIN_FAILURES.delete(address);
    socket.data.isAdmin = true;
    socket.join('admins');
    socket.emit('admin:authenticated');
    emitHostState();
    sendQR(socket.id);
  });
  socket.on('host:register', () => { emitHostState(); sendQR(socket.id); });
  socket.on('tv:register', () => {
    socket.emit('tv:state', {
      config: game.config, drawn: game.drawn, winners: game.winners,
      topWinners: game.topWinners || [], playerCount: lockedPlayers().length,
      issuedCount: game.tickets.filter((t) => t.owner).length,
      maxPlayers: game.config.maxPlayers, waitingCount: countWaiting(),
      waitingPlayers: waitingPlayers.length, showRules,
      leaderboardVisible,
      leaderboard: leaderboardVisible ? leaderboard() : [],
      participants: tvParticipants(),
      maxWinnersReached: game.maxWinnersReached,
      prize: prizePool(), prizePerWinner: prizePerWinner(),
      players: lockedPlayers().map(({ playerId, paymentStatus, debt, bet, balance, winnings, ...player }) => player),
      history: readJSON(HISTORY_FILE, []),
    });
    sendQR(socket.id);
  });
  socket.on('tv:rules', ({ visible } = {}) => {
    setRulesVisible(Boolean(visible));
    emitHostState();
  });
  socket.on('tv:leaderboard', ({ visible } = {}) => {
    leaderboardVisible = Boolean(visible);
    emitHostState();
  });

  // Cập nhật giá trực tiếp trước khi phát vé; sau khi phát vé phải dùng
  // cấu hình ván mới để không làm thay đổi khoản cược đã thông báo/thu.
  socket.on('bot:state', ({ enabled } = {}) => {
    botEnabled = !!enabled;
  });
  socket.on('announcer:style', ({ index } = {}) => {
    const n = Number(index);
    if (Number.isFinite(n)) announcerStyleIndex = n;
  });
  socket.on('sfx:state', ({ enabled } = {}) => {
    sfxEnabled = !!enabled;
    io.emit('sfx:state', { enabled: sfxEnabled });
    emitHostState();
  });

  // Auto-save từng ô khi rời ô / Enter. Các ô bị khóa trong ván bị từ chối.
  socket.on('settings:update', (s) => {
    if (!s) return;
    const LOCKED_FIELDS = ['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'];
    const roundStarted = game.drawn.length > 0 || rolling || game.tickets.some((t) => t.locked);
    for (const key of LOCKED_FIELDS) {
      if (s[key] !== undefined && roundStarted) {
        socket.emit('settings:error', {
          message: 'Thông số này đã bị khóa trong ván. Tự mở khóa khi Qua ván mới.', field: key,
        });
        return;
      }
    }
    if (s.betPerTicket !== undefined) {
      const v = Number(s.betPerTicket);
      if (!Number.isFinite(v) || v < 0) {
        socket.emit('settings:error', { message: 'Mức cược phải là số không âm.', field: 'betPerTicket' });
        return;
      }
      game.config.betPerTicket = v;
    }
    if (s.maxPlayers !== undefined) {
      game.config.maxPlayers = Math.max(1, Math.min(1000, Number(s.maxPlayers) || 200));
    }
    if (s.maxTicketsPerPlayer !== undefined) {
      game.config.maxTicketsPerPlayer = Math.max(1, Math.min(10, Number(s.maxTicketsPerPlayer) || 3));
    }
    if (s.maxWinners !== undefined) {
      game.config.maxWinners = Math.max(0, Number(s.maxWinners) || 0);
    }
    if (s.rollSeconds !== undefined) {
      game.config.rollSeconds = Math.max(1, Math.min(15, Number(s.rollSeconds) || 4.5));
    }
    if (s.autoRollSeconds !== undefined) {
      game.config.autoRollSeconds = Math.max(0.3, Math.min(30, Number(s.autoRollSeconds) || 9));
    }
    // Quay tự động luôn lớn hơn thời gian quay ít nhất 3.5 giây (đủ thời gian đọc chốt số).
    if (game.config.autoRollSeconds < game.config.rollSeconds + 3.5) {
      game.config.autoRollSeconds = game.config.rollSeconds + 3.5;
      socket.emit('settings:error', { message: 'Quay tự động phải lớn hơn thời gian quay ít nhất 3.5 giây.', field: 'autoRollSeconds' });
    }
    persistState();
    emitHostState();
    socket.emit('settings:saved', { at: Date.now(), config: game.config });
  });

  socket.on('config:update', (cfg) => {
    // Chặn luôn đường vòng: config:update không được đổi 4 ô bị khóa trong ván.
    const LOCKED_FIELDS = ['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'];
    const roundStarted = game.drawn.length > 0 || rolling || game.tickets.some((t) => t.locked);
    if (cfg && LOCKED_FIELDS.some((key) => cfg[key] !== undefined) && roundStarted) {
      socket.emit('settings:error', {
        message: 'Thông số này đã bị khóa trong ván. Tự mở khóa khi Qua ván mới.',
      });
      return;
    }
    const maxPlayers = Math.max(1, Math.min(1000, Number(cfg.maxPlayers) || 200));
    const rollSeconds = Math.max(1, Math.min(15, Number(cfg.rollSeconds) || game.config.rollSeconds || 4.5));
    let autoRollSeconds = Math.max(0.3, Math.min(30, Number(cfg.autoRollSeconds) || game.config.autoRollSeconds || 9));
    if (autoRollSeconds < rollSeconds + 3.5) autoRollSeconds = rollSeconds + 3.5;
    const requestedBet = Number(cfg.betPerTicket);
    const betPerTicket = Math.max(0, Number.isFinite(requestedBet) ? requestedBet : game.config.betPerTicket);
    const maxWinners = Math.max(0, Number(cfg.maxWinners) || 0);
    if (pendingPhysicsDraw) { clearTimeout(pendingPhysicsDraw.timer); pendingPhysicsDraw = null; }
    rolling = false;
    autoRunning = false;
    setRulesVisible(false);
    leaderboardVisible = false;
    previewTickets = [];
    io.emit('draw:cancel');
    game = freshGame({ maxPlayers, rollSeconds, autoRollSeconds, betPerTicket, maxWinners });
stateMod.syncTicketMap();
    persistState();
    io.emit('game:reset', { config: game.config });
    emitHostState();
    sendQR();
    assignWaitingPlayers();
stateMod.syncTicketMap();
  });

  socket.on('game:new', () => {
    if (pendingPhysicsDraw) { clearTimeout(pendingPhysicsDraw.timer); pendingPhysicsDraw = null; }
    rolling = false;
    autoRunning = false;
    setRulesVisible(false);
    leaderboardVisible = false;
    previewTickets = [];
    io.emit('draw:cancel');
    game = freshGame(game.config);
stateMod.syncTicketMap();
    persistState();
    io.emit('game:reset', { config: game.config });
    io.emit('auto:state', { running: false });
    emitHostState();
    sendQR();
    assignWaitingPlayers();
stateMod.syncTicketMap();
  });

  socket.on('game:finish', () => {
    const changed = settleGame();
    if (changed) {
      io.emit('game:finished', {
        winners: game.winners, drawn: game.drawn, topWinners: game.topWinners,
        prizePerWinner: prizePerWinner(),
      });
    }
    // Luôn phát state mới ngay cả khi ván đã được tự chốt ở lượt đủ KINH.
    emitHostState();
  });

  // Gộp 3 nút quản lý ván thành 1: "Qua ván mới".
  // - Đã đủ người Kinh: tự lưu kết quả vào lịch sử rồi reset ván.
  // - Chưa đủ: Admin đã xác nhận ở client; hủy ván và reset (không ghi lịch sử).
  socket.on('admin:next-round', () => {
    const wasSettled = !!game.settled;
    const saved = isRoundComplete() ? (wasSettled || settleGame()) : false;
    const savedGameId = game.id;
    if (pendingPhysicsDraw) { clearTimeout(pendingPhysicsDraw.timer); pendingPhysicsDraw = null; }
    rolling = false;
    autoRunning = false;
    setRulesVisible(false);
    leaderboardVisible = false;
    previewTickets = [];
    io.emit('draw:cancel');
    // Xóa thông báo Kinh / overlay vinh danh trên TV trước khi reset lồng cầu.
    io.emit('kinh:clear', { previousGameId: savedGameId, saved });
    game = freshGame(game.config);
stateMod.syncTicketMap();
    persistState();
    io.emit('game:reset', { config: game.config, saved });
    io.emit('auto:state', { running: false });
    emitHostState();
    sendQR();
    assignWaitingPlayers();
stateMod.syncTicketMap();
    socket.emit('admin:next-round-done', { saved, gameId: game.id });
  });

  socket.on('draw:request', (payload) => {
    if (autoRunning) {
      io.emit('draw:error', { message: 'Đang tự xổ… bấm DỪNG nếu muốn dừng.' });
      return;
    }
    doDraw(payload && payload.manual);
  });

  // Kết quả lấy từ va chạm vật lý trong lồng cầu trên màn hình TV.
  socket.on('draw:physics-result', ({ number, gameId } = {}) => {
    if (!pendingPhysicsDraw || !rolling) return;
    const { snapshot, onDone, timer } = pendingPhysicsDraw;
    if (game !== snapshot || (gameId && gameId !== game.id)) return;
    const num = Number(number);
    const cfg = game.config;
    if (!Number.isInteger(num) || num < cfg.minNumber || num > cfg.maxNumber || stateMod.hasDrawn(num)) {
      io.emit('draw:error', { message: 'Số từ lồng cầu không hợp lệ. Đang thử lại…' });
      return;
    }
    clearTimeout(timer);
    pendingPhysicsDraw = null;
    commitDraw(num, snapshot, onDone);
  });

  socket.on('auto:start', () => {
    if (game.maxWinnersReached) {
      io.emit('draw:error', { message: 'Đã đạt số người KINH tối đa của ván này.' });
      return;
    }
    if (rolling || autoRunning) {
      io.emit('draw:error', { message: 'Đang quay rồi, vui lòng đợi…' });
      return;
    }
    autoRunning = true;
    roundStartWinners = game.winners.length;
    io.emit('auto:state', { running: true, round: roundStartWinners + 1 });
    nextAutoDraw();
  });

  socket.on('auto:stop', () => {
    if (!autoRunning) return;
    autoRunning = false;
    io.emit('auto:state', { running: false });
    io.emit('auto:stopped', Object.assign(buildRoundSummary(), { cancelled: true }));
  });

  socket.on('player:join', (payload) => {
    const playerId = payload && payload.playerId;
    if (!playerId) return;

    // Chế độ XEM TRƯỚC: vé riêng, không tính vào kho 200 vé / danh sách chốt
    if (payload.preview) {
      const want = Math.max(1, Math.min(maxTicketsPerPlayer(), Number(payload.ticketCount) || 1));
      let owned = previewTickets.filter((t) => t.playerId === playerId);
      // Đổi số vé muốn mua trong khung xem trước -> tạo lại bộ vé xem trước
      if (owned.length !== want) {
        previewTickets = previewTickets.filter((t) => t.playerId !== playerId);
        owned = [];
        for (let i = 0; i < want; i++) {
          const rows = buildGrid(game.drawn);
          rows.forEach((r) => { if (r.complete) r.awarded = true; });
          const pv = {
            playerId, code: i === 0 ? 'PREVIEW' : 'PREVIEW-' + (i + 1),
            name: 'XEM TRƯỚC', locked: false, socketId: socket.id,
            rows, won: false, previewKinhCount: 0,
          };
          previewTickets.push(pv);
          owned.push(pv);
        }
      }
      owned.forEach((t) => { t.socketId = socket.id; });
      socket.emit('ticket:assigned', previewMultiPayload(playerId, owned[0] && owned[0].code));
      return;
    }

    // Người đã nhập tên nhưng chưa có vé vẫn phải hiện trong admin và nhận
    // cập nhật ví sau khi refresh (disconnect xoá entry cũ).
    let existingTickets = findTickets(playerId);
    if (!existingTickets.length) {
      const joining = joiningPlayers.get(playerId);
      if (joining) {
        joining.socketId = socket.id;
      } else if (payload.name) {
        joiningPlayers.set(playerId, {
          playerId,
          name: uniquePlayerName(String(payload.name).trim(), playerId),
          socketId: socket.id,
          joinedAt: Date.now(),
        });
      }
      if (joiningPlayers.has(playerId)) emitHostState();
    }

    // Tên là định danh để khôi phục vé trên thiết bị khác; không bắt người chơi
    // phải nhớ và nhập lại mã vé. Tên trùng đã được uniquePlayerName xử lý.
    const hadTickets = existingTickets.length > 0;
    if (!existingTickets.length && payload.name) {
      const requestedName = String(payload.name).trim().slice(0, 20);
      const byName = game.tickets.filter((t) => {
        if (!t.owner || t.name !== requestedName) return false;
        // Vé đã chốt luôn khôi phục được theo tên (đổi thiết bị).
        // Vé chưa chốt chỉ khôi phục khi tab cũ đã đóng, tránh chiếm vé đang chơi.
        if (t.locked) return true;
        return !t.socketId || t.socketId === socket.id || !io.sockets.sockets.has(t.socketId);
      });
      if (byName.length) {
        byName.forEach((t) => { t.owner = playerId; t.socketId = socket.id; });
        existingTickets = findTickets(playerId);
      }
    }
    if (existingTickets.length && (hadTickets || payload.name)) socket.emit('player:returning');

    // Nếu ván đã bắt đầu và người chơi chưa có vé -> vào hàng chờ
    if (Array.isArray(game.drawn) && game.drawn.length > 0) {
      const owned = existingTickets;
      if (!owned.length) {
        const existing = waitingPlayers.find((w) => w.playerId === playerId);
        const name = uniquePlayerName(payload.name || (existing && existing.name) || '', playerId);
        if (existing) {
          existing.name = name;
          existing.socketId = socket.id;
          existing.ticketCount = Math.max(1, Math.min(maxTicketsPerPlayer(), Number(payload.ticketCount) || existing.ticketCount || 1));
        } else {
          waitingPlayers.push({
            playerId,
            name,
            socketId: socket.id,
            ticketCount: Math.max(1, Math.min(maxTicketsPerPlayer(), Number(payload.ticketCount) || 1)),
            joinedAt: Date.now(),
          });
        }
        joiningPlayers.delete(playerId);
        persistState();
        socket.emit('player:waiting', {
          message: 'Ván đang chơi. Bạn đã vào hàng chờ, sẽ nhận vé ở ván tiếp theo.',
          config: game.config,
        });
        socket.emit('wallet:summary', walletSummaryForName(name));
        emitHostState();
        return;
      }
    }

    // Tránh tên trùng
    // Số vé người chơi muốn mua (tối đa 4 vé/người)
    const want = Math.max(1, Math.min(maxTicketsPerPlayer(), Number(payload.ticketCount) || 1));
    let owned = findTickets(playerId);
    const ownedHadTickets = owned.length > 0;
    const name = owned.length
      ? owned[0].name
      : (joiningPlayers.get(playerId)?.name || uniquePlayerName(payload.name || '', playerId));
    // Cho phép tăng thêm vé nếu người chơi muốn nhiều hơn hiện có
    const needMore = Math.max(0, want - owned.length);
    if (needMore > 0) {
      const free = game.tickets.filter((t) => !t.owner);
      // Kiểm tra số dư trước khi phân vé
      const account = accountFor(name);
      const bet = needMore * (Number(game.config.betPerTicket) || 0);
      if ((Number(account.deposited) || 0) < bet) {
        const shortage = bet - (Number(account.deposited) || 0);
        socket.emit('wallet:summary', walletSummaryForName(name));
        socket.emit('player:rejected', {
          message: `Không đủ số dư. Cần nạp thêm ${shortage.toLocaleString('vi-VN')}đ.`,
          config: game.config,
        });
        return;
      }
      if (free.length < needMore) {
        socket.emit('player:rejected', {
          message: `Chỉ còn ${free.length} vé trống, không đủ thêm ${needMore} vé. Vui lòng giảm số vé!`,
          config: game.config,
        });
        return;
      }
      free.slice(0, needMore).forEach((t) => giveTicket(t, playerId, name, socket.id));
      stateMod.syncTicketMap();
      owned = findTickets(playerId);
    }
    if (!owned.length) {
      socket.emit('player:rejected', {
        message: 'Không có vé nào được phân.',
        config: game.config,
      });
      return;
    }
    if (ownedHadTickets) socket.emit('player:returning');
    owned.forEach((t) => {
      t.socketId = socket.id;
      if (name) t.name = name;
    });
    joiningPlayers.delete(playerId);
    persistState();
    socket.emit('ticket:assigned', multiPayload(playerId));
    emitHostState();
  });

  // Đổi sang một vé random khác (chưa ai giữ)
  socket.on('ticket:change', (payload) => {
    const playerId = payload && payload.playerId;
    const pvList = previewTickets.filter((t) => t.playerId === playerId);
    if (pvList.length) {
      const pv = pvList.find((t) => t.code === payload.code) || pvList[0];
      pv.rows = buildGrid(game.drawn);
      pv.rows.forEach((r) => { if (r.complete) r.awarded = true; });
      pv.won = false;
      pv.previewKinhCount = 0;
      socket.emit('ticket:assigned', previewMultiPayload(playerId, pv.code));
      socket.emit('ticket:changed', { code: pv.code });
      return;
    }
    const owned = findTickets(playerId);
    if (!owned.length) return;
    const cur = owned.find((t) => t.code === payload.code) || owned[0];
    if (cur.locked) {
      socket.emit('ticket:error', { message: 'Bạn đã chốt vé, không thể đổi nữa!' });
      return;
    }
    const name = cur.name;
    const next = pickFreeTicket(cur);
    if (!next) {
      socket.emit('ticket:error', { message: 'Không còn vé nào để đổi.' });
      return;
    }
    releaseTicket(cur);
    stateMod.syncTicketMap();
    giveTicket(next, playerId, name, socket.id);
    stateMod.syncTicketMap();
    persistState();
    socket.emit('ticket:assigned', multiPayload(playerId, next.code));
    socket.emit('ticket:changed', { code: next.code });
    emitHostState();
  });

  // Chốt vé -> xuất hiện trong danh sách người chơi trên màn hình chính
  socket.on('ticket:lock', (payload) => {
    const pvOwned = previewTickets.filter((t) => t.playerId === payload.playerId);
    if (pvOwned.length) {
      pvOwned.forEach((t) => { t.locked = true; });
      socket.emit('ticket:locked', {
        code: pvOwned[0].code, name: 'XEM TRƯỚC', codes: pvOwned.map((t) => t.code),
      });
      return;
    }
    const owned = findTickets(payload && payload.playerId);
    if (!owned.length) return;
    const codes = owned.map((t) => t.code);
    // Chốt đúp: không ghi state lại, vẫn gửi ack để client không chờ.
    if (owned.every((t) => t.locked)) {
      socket.emit('ticket:locked', { code: owned[0].code, name: owned[0].name, codes });
      return;
    }
    // Ván đã xổ số thì không nhận thêm vé chốt muộn (tránh lệch tổng giải).
    if (game.drawn.length > 0 || rolling) {
      socket.emit('ticket:error', { message: 'Ván đã bắt đầu, không thể chốt vé muộn!' });
      return;
    }
    owned.forEach((t) => { t.locked = true; });
    persistState();
    socket.emit('ticket:locked', { code: owned[0].code, name: owned[0].name, codes: owned.map((t) => t.code) });
    io.to('admins').emit('host:players', { players: adminPlayers() });
    emitHostState();
  });

  socket.on('player:ack', (payload) => {
    const ticket = game.tickets.find((t) => t.owner === (payload && payload.playerId));
    if (!ticket || !ticket.won) return;
    game.winners.forEach((w) => { if (w.playerId === ticket.owner) w.acked = true; });
    persistState();
    io.emit('host:ack', { name: ticket.name, code: ticket.code, winners: game.winners });
    emitHostState();
  });

  socket.on('player:rename', (payload) => {
    const playerId = payload && payload.playerId;
    if (!playerId || !payload.name) return;
    if (findTickets(playerId).length || waitingPlayers.some((player) => player.playerId === playerId) || joiningPlayers.has(playerId)) return;
    const requestedName = uniquePlayerName(String(payload.name).trim(), playerId);
    joiningPlayers.set(playerId, {
      playerId, name: requestedName, socketId: socket.id, joinedAt: Date.now(),
    });
    emitHostState();
  });

  socket.on('admin:rename-player', (payload) => {
    const playerId = payload && payload.playerId;
    const name = payload && payload.name;
    if (!playerId || !name) return;
    const owned = game.tickets.filter((t) => t.owner === playerId);
    const newName = uniquePlayerName(String(name).trim(), playerId);
    renameFinanceAccount(owned[0]?.name, newName);
    owned.forEach((t) => { t.name = newName; });
    (game.winners || []).forEach((w) => { if (w.playerId === playerId) w.name = newName; });
    (game.topWinners || []).forEach((w) => { if (w.playerId === playerId) w.name = newName; });
    saveFinances();
    const wp = waitingPlayers.find((w) => w.playerId === playerId);
    if (wp) wp.name = newName;
    const joining = joiningPlayers.get(playerId);
    if (joining) joining.name = newName;
    persistState();
    emitHostState();
  });

  function kickPlayer(playerId) {
    if (!playerId) return;
    const waitingEntry = waitingPlayers.find((player) => player.playerId === playerId);
    const joiningEntry = joiningPlayers.get(playerId);
    const playerName = game.tickets.find((ticket) => ticket.owner === playerId)?.name || waitingEntry?.name || joiningEntry?.name;
    // Tính tiền cược đã trừ (nếu ván đã bắt đầu) để hoàn lại
    const kickedTickets = game.tickets.filter((ticket) => ticket.owner === playerId && ticket.locked);
    const refundBet = game.drawn.length > 0 ? kickedTickets.length * (Number(game.config.betPerTicket) || 0) : 0;
    const targetSockets = new Set(game.tickets
      .filter((ticket) => ticket.owner === playerId && ticket.socketId)
      .map((ticket) => ticket.socketId));
    if (waitingEntry && waitingEntry.socketId) targetSockets.add(waitingEntry.socketId);
    if (joiningEntry && joiningEntry.socketId) targetSockets.add(joiningEntry.socketId);
    targetSockets.forEach((id) => {
      io.to(id).emit('player:kicked', { message: 'Quản trò đã xoá dữ liệu vé của bạn trong ván này.' });
    });
    game.tickets.forEach((t) => {
      if (t.owner === playerId) {
        t.owner = null; t.name = ''; t.locked = false; t.socketId = null; t.won = false; t.joinedAt = null;
        t.rows.forEach((r) => {
          r.cells.forEach((c) => { if (c) c.matched = false; });
          r.complete = false; r.awarded = false; r.waitingNotified = false; r.kinhPosition = null;
        });
      }
    });
    waitingPlayers = waitingPlayers.filter((w) => w.playerId !== playerId);
    joiningPlayers.delete(playerId);
    stateMod.syncTicketMap();
    // Hoàn tiền nếu ván đã bắt đầu
    if (refundBet > 0 && playerName) {
      const account = accountFor(playerName);
      account.deposited += refundBet;
      account.balance += refundBet;
      appendFinanceTransaction(account, 'refund-kick', refundBet, { gameId: game.id });
      saveFinances();
      emitWalletSummary(playerId);
    } else if (playerName) {
      delete finances[financeKey(playerName)];
      saveFinances();
    }
    delete game.payments[playerId];
    game.winners = game.winners.filter((winner) => winner.playerId !== playerId);
    game.topWinners = game.topWinners.filter((winner) => winner.playerId !== playerId);
  }

  socket.on('admin:kick-player', (payload) => {
    const playerId = payload && payload.playerId;
    if (!playerId) return;
    kickPlayer(playerId);
    saveFinances();
    persistState();
    emitHostState();
  });

  socket.on('admin:kick-all', () => {
    const ids = new Set();
    game.tickets.filter((t) => t.owner).forEach((t) => ids.add(t.owner));
    waitingPlayers.forEach((w) => ids.add(w.playerId));
    joiningPlayers.forEach((_, id) => ids.add(id));
    ids.forEach((id) => kickPlayer(id));
    saveFinances();
    persistState();
    emitHostState();
  });

  socket.on('admin:adjust-wallet', (payload) => {
    const playerId = payload && payload.playerId;
    const amount = Number(payload && payload.amount) || 0;
    const reason = String((payload && payload.reason) || '').slice(0, 80);
    if (!playerId) return;
    const player = game.tickets.find((ticket) => ticket.owner === playerId);
    const waiting = waitingPlayers.find((entry) => entry.playerId === playerId);
    const account = accountFor((player && player.name) || (waiting && waiting.name));
    account.balance += amount;
    if (payload && payload.addDebt && amount > 0) account.debt += amount;
    account.transactions.push({
      type: payload && payload.addDebt ? 'debt-adjustment' : 'balance-adjustment',
      amount, reason, at: Date.now(),
    });
    account.transactions = account.transactions.slice(-200);
    saveFinances();
    const sockets = new Set();
    game.tickets.filter((t) => t.owner === playerId).forEach((t) => { if (t.socketId) sockets.add(t.socketId); });
    const wp = waitingPlayers.find((w) => w.playerId === playerId);
    if (wp && wp.socketId) sockets.add(wp.socketId);
    sockets.forEach((sid) => {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.emit('wallet:adjust', { amount, reason, addDebt: Boolean(payload && payload.addDebt) });
    });
    emitHostState();
  });

  socket.on('admin:wallet-deposit-quick', ({ playerId, name } = {}) => {
    if (!playerId && !name) return;
    const participant = playerId ? adminPlayers().find((player) => player.playerId === playerId) : null;
    const ticketCount = Math.max(1, Number(participant && participant.ticketCount) || 1);
    const amount = positiveMoney((Number(game.config.betPerTicket) || 0) * ticketCount);
    if (!amount) return;
    creditWallet(playerId || name, amount, 'deposit', 'Nạp nhanh', name);
  });

  socket.on('admin:wallet-deposit', ({ playerId, name, amount } = {}) => {
    const value = positiveMoney(amount);
    if ((!playerId && !name) || !value) return;
    creditWallet(playerId || name, value, 'deposit', 'Nạp tiền', name);
  });

  socket.on('admin:wallet-loan', ({ playerId, name, amount } = {}) => {
    const value = positiveMoney(amount);
    if ((!playerId && !name) || !value) return;
    creditWallet(playerId || name, value, 'loan', 'Cho vay', name);
  });

  socket.on('admin:wallet-set', ({ playerId, field, amount } = {}) => {
    if (!playerId || !['deposited', 'winnings', 'debt'].includes(field)) return;
    const name = playerNameForId(playerId);
    if (!name) return;
    const value = Number(amount);
    if (!Number.isFinite(value)) return;
    const account = accountFor(name);
    account[field] = Math.max(0, Math.floor(value));
    appendFinanceTransaction(account, 'wallet-set', Math.floor(value), { field });
    saveFinances();
    emitWalletSummary(playerId);
    emitHostState();
  });

  socket.on('admin:set-payment', (payload) => {
    const playerId = payload && payload.playerId;
    const status = payload && payload.status;
    if (!playerId || !['paid', 'debt'].includes(status)) return;
    const player = lockedPlayers().find((entry) => entry.playerId === playerId);
    if (!player) return;
    const account = accountFor(player.name);
    const previousStatus = game.payments[playerId] && game.payments[playerId].status;
    if (status === 'debt' && previousStatus !== 'debt') {
      account.debt += player.bet;
      account.transactions.push({ type: 'ticket-debt', amount: player.bet, gameId: game.id, at: Date.now() });
    } else if (status === 'paid') {
      account.transactions.push({ type: 'ticket-paid', amount: player.bet, gameId: game.id, at: Date.now() });
      if (account.debt > 0) {
        account.transactions.push({ type: 'debt-cleared', amount: -account.debt, gameId: game.id, at: Date.now() });
        account.debt = 0;
      }
    }
    account.transactions = account.transactions.slice(-200);
    game.payments[playerId] = {
      status,
      paid: status === 'paid' ? player.bet : 0,
      debt: account.debt,
      updatedAt: Date.now(),
    };
    saveFinances();
    persistState();
    new Set(game.tickets.filter((ticket) => ticket.owner === playerId && ticket.socketId)
      .map((ticket) => ticket.socketId)).forEach((id) => {
      io.to(id).emit('wallet:debt', { debt: account.debt });
    });
    emitHostState();
  });

  socket.on('admin:clear-debt', ({ playerId } = {}) => {
    const player = lockedPlayers().find((entry) => entry.playerId === playerId);
    if (!player) return;
    const account = accountFor(player.name);
    if (account.debt) {
      account.transactions.push({ type: 'debt-cleared', amount: -account.debt, at: Date.now() });
      account.debt = 0;
      account.transactions = account.transactions.slice(-200);
      saveFinances();
    }
    game.payments[playerId] = Object.assign({}, game.payments[playerId], { debt: 0, updatedAt: Date.now() });
    persistState();
    new Set(game.tickets.filter((ticket) => ticket.owner === playerId && ticket.socketId)
      .map((ticket) => ticket.socketId)).forEach((id) => io.to(id).emit('wallet:debt', { debt: 0 }));
    emitHostState();
  });

  // Trả thưởng: chuyển reward (winnings) vào số dư, reset reward về 0.
  // totalWon (thành tích) GIỮ NGUYÊN.
  socket.on('admin:pay-reward', ({ playerId } = {}) => {
    const player = lockedPlayers().find((entry) => entry.playerId === playerId);
    if (!player) return;
    const account = accountFor(player.name);
    const reward = Number(account.winnings) || 0;
    if (reward <= 0) return;
    account.balance += reward;
    account.winnings = 0;
    appendFinanceTransaction(account, 'reward-paid', reward, { reason: 'Trả thưởng' });
    account.transactions = account.transactions.slice(-200);
    saveFinances();
    emitWalletSummary(playerId);
    emitHostState();
  });

  // Cấn nợ bằng tiền thưởng chưa trả: giảm winnings & debt, totalWon GIỮ NGUYÊN.
  socket.on('admin:offset-debt', ({ playerId } = {}) => {
    const player = lockedPlayers().find((entry) => entry.playerId === playerId);
    if (!player) return;
    const account = accountFor(player.name);
    const used = Math.min(Number(account.winnings) || 0, Number(account.debt) || 0);
    if (used <= 0) return;
    account.winnings -= used;
    account.debt -= used;
    appendFinanceTransaction(account, 'reward-offset-debt', -used, { reason: 'Cấn nợ từ tiền thưởng' });
    account.transactions = account.transactions.slice(-200);
    saveFinances();
    game.payments[playerId] = Object.assign({}, game.payments[playerId], { debt: account.debt });
    persistState();
    emitWalletSummary(playerId);
    emitHostState();
  });

  // Chỉ đặt lại THÀNH TÍCH (totalWon), giữ nguyên tiền nạp/reward chưa trả/nợ.
  socket.on('admin:reset-achievements', () => {
    Object.values(finances).forEach((account) => { account.totalWon = 0; });
    saveFinances();
    emitHostState();
    io.emit('admin:achievements-reset');
  });

  // XÓA TOÀN BỘ dữ liệu người chơi: ví, vé, lịch sử nạp/thưởng/nợ, thành tích.
  socket.on('admin:wipe-all-data', () => {
    // Giữ cấu hình ván hiện tại, tạo lại state sạch.
    const config = Object.assign({}, game.config);
    game = freshGame(config);
stateMod.syncTicketMap();
    waitingPlayers = [];
    joiningPlayers.clear();
    previewTickets = [];
    finances = {};
    saveFinances();
    persistState();
    writeJSON(HISTORY_FILE, []);
    emitHostState();
    io.emit('game:reset', { config: game.config });
    io.emit('admin:data-wiped');
  });

  socket.on('admin:zero-balance', ({ playerId } = {}) => {
    const player = lockedPlayers().find((entry) => entry.playerId === playerId);
    if (!player) return;
    const account = accountFor(player.name);
    if (account.balance) {
      account.transactions.push({ type: 'balance-reset', amount: -account.balance, at: Date.now() });
      account.balance = 0;
      account.transactions = account.transactions.slice(-200);
      saveFinances();
    }
    new Set(game.tickets.filter((ticket) => ticket.owner === playerId && ticket.socketId)
      .map((ticket) => ticket.socketId)).forEach((id) => io.to(id).emit('wallet:balance', { balance: 0 }));
    emitHostState();
  });

  socket.on('disconnect', () => {
    game.tickets.forEach((t) => { if (t.socketId === socket.id) t.socketId = null; });
    previewTickets.forEach((t) => { if (t.socketId === socket.id) t.socketId = null; });
    const joining = [...joiningPlayers.values()].find((player) => player.socketId === socket.id);
    if (joining) {
      joiningPlayers.delete(joining.playerId);
      emitHostState();
    }
  });
});

/* ---------------- Static ---------------- */
app.use(require('./static-handler')(path.join(__dirname, '..', '..', 'frontend')));
app.get('/api/state', (req, res) => {
  const players = lockedPlayers().map(({ playerId, paymentStatus, debt, bet, balance, winnings, ...player }) => player);
  res.json({
    serverTime: Date.now(), joinUrl: buildJoinUrl(),
    config: game.config, drawn: game.drawn,
    playerCount: lockedPlayers().length,
    issued: game.tickets.filter((t) => t.owner).length,
    waitingCount: countWaiting(),
    waitingPlayers: waitingPlayers.length,
    maxWinnersReached: game.maxWinnersReached,
    players, winners: game.winners,
    topWinners: game.topWinners || [],
    leaderboardVisible,
    showRules,
    leaderboard: leaderboardVisible ? leaderboard() : [],
    prize: prizePool(), prizePerWinner: prizePerWinner(),
    history: readJSON(HISTORY_FILE, []),
  });
});

// Mở đồng thời 3 trang khi chạy với cờ --open / -o.
function openAllPages(urls) {
  const openOne = (url) => {
    try {
      let child;
      if (process.platform === 'darwin') child = spawn('open', [url], { stdio: 'ignore', detached: true });
      else if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '', `"${url}"`], { stdio: 'ignore', detached: true });
      else child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
      if (child && child.on) child.on('error', () => {});
      if (child && child.unref) child.unref();
    } catch (error) {
      console.error(`  ⚠ Không mở được ${url}: ${error.message}`);
    }
  };
  urls.forEach(openOne);
}

if (process.env.LOTO_SERVER_AUTOSTART === '1' || require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
  const signatures = game.tickets.map((t) => gridSignature(t.rows));
  const unique = new Set(signatures).size;
  const dup = game.tickets.length - unique;
  const lan = getLocalIP();
  const local = `http://localhost:${PORT}`;
  const lanBase = `http://${lan}:${PORT}`;
  const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m',
    gold: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m', dim: '\x1b[2m',
  };
  const line = `${C.gold}========================================================${C.reset}`;
  console.log(line);
  console.log(`  ${C.bold}${C.red}🧧 LÔ TÔ TẾT - MÁY CHỦ ĐÃ SẴN SÀNG${C.reset}`);
  console.log(`  ${C.dim}Kiểm tra vé: ${game.tickets.length} vé · ${unique} khác nhau · ${dup} trùng${C.reset}`);
  console.log(`  ${C.dim}Vé 9x9 · ${game.config.maxPlayers} vé · cược ${game.config.betPerTicket.toLocaleString('vi-VN')}đ/vé${C.reset}`);
  console.log(line);
  console.log(`  ${C.bold}${C.green}1. Quản trò (Admin)${C.reset}`);
  console.log(`     ${C.cyan}Local:${C.reset} ${local}/`);
  console.log(`     ${C.cyan}LAN  :${C.reset} ${lanBase}/`);
  console.log(`  ${C.bold}${C.green}2. Màn hình TV${C.reset}`);
  console.log(`     ${C.cyan}Local:${C.reset} ${local}/tv.html`);
  console.log(`     ${C.cyan}LAN  :${C.reset} ${lanBase}/tv.html`);
  console.log(`  ${C.bold}${C.green}3. Người chơi (Play)${C.reset}`);
  console.log(`     ${C.cyan}Local:${C.reset} ${local}/play.html`);
  console.log(`     ${C.cyan}LAN  :${C.reset} ${lanBase}/play.html`);
  console.log(`  ${C.dim}Quét QR trên TV bằng điện thoại cùng mạng LAN.${C.reset}`);
  console.log(line);

  if (process.argv.includes('--open') || process.argv.includes('-o')) {
    console.log(`  ${C.gold}🚀 Đang mở cả 3 trang trên trình duyệt...${C.reset}`);
    openAllPages([`${local}/`, `${local}/tv.html`, `${local}/play.html`]);
  }
});
}

// Trạng thái tập trung để các module src/* truy xuất mà không copy logic.
const state = {
  get game() { return game; },
  set game(v) { game = v; },
  get finances() { return finances; },
  set finances(v) { finances = v; },
  get waitingPlayers() { return waitingPlayers; },
  set waitingPlayers(v) { waitingPlayers = v; },
  get joiningPlayers() { return joiningPlayers; },
  get previewTickets() { return previewTickets; },
  set previewTickets(v) { previewTickets = v; },
  get rolling() { return rolling; },
  set rolling(v) { rolling = v; },
  get autoRunning() { return autoRunning; },
  set autoRunning(v) { autoRunning = v; },
  get botEnabled() { return botEnabled; },
  set botEnabled(v) { botEnabled = v; },
  get sfxEnabled() { return sfxEnabled; },
  set sfxEnabled(v) { sfxEnabled = v; },
  get showRules() { return showRules; },
  set showRules(v) { showRules = v; },
  get leaderboardVisible() { return leaderboardVisible; },
  set leaderboardVisible(v) { leaderboardVisible = v; },
};

module.exports = {
  app, server, io, PORT, DATA_DIR,
  state,
  game: () => game, finances: () => finances,
  getLocalIP, buildJoinUrl, freshGame, accountFor, leaderboard,
  prizePool, prizePerWinner, lockedPlayers, adminPlayers, tvParticipants,
  isRoundComplete, settleGame, setRulesVisible,
  buildGrid, gridSignature, rowNumbers, positiveMoney, maxTicketsPerPlayer,
  persistState, emitHostState, emitHostStateThrottled,
  doDraw, commitDraw, nextAutoDraw, start: () => {},
};
try { require('./state').syncTicketMap(); } catch (e) {}
