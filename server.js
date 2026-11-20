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
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const STATE_FILE = path.join(DATA_DIR, 'game-state.json');
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
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
function makeId() {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
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
    maxPlayers: 200,
    prize: 1000000,
    rollSeconds: 6,
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
game.config = Object.assign({ maxPlayers: 200, prize: 1000000, rollSeconds: 6, minNumber: 1, maxNumber: 90 }, game.config || {});

// Đang trong lượt quay số (chưa chốt kết quả)
let rolling = false;

function persistState() { writeJSON(STATE_FILE, game); }
function appendHistory() {
  const history = readJSON(HISTORY_FILE, []);
  history.unshift({
    id: game.id, startedAt: game.startedAt, endedAt: Date.now(),
    config: game.config, drawn: game.drawn, winners: game.winners,
    players: lockedPlayers().length, issued: game.tickets.filter((t) => t.owner).length,
  });
  writeJSON(HISTORY_FILE, history.slice(0, 50));
}
function prizePerWinner() {
  return game.winners.length ? Math.floor(game.config.prize / game.winners.length) : game.config.prize;
}
function lockedPlayers() {
  return game.tickets
    .filter((t) => t.locked && t.owner)
    .map((t) => ({ code: t.code, name: t.name, kinh: t.won ? game.winners.filter((w) => w.playerId === t.owner).length : 0 }));
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
function emitHostState() {
  io.emit('host:state', {
    config: game.config,
    drawn: game.drawn,
    playerCount: lockedPlayers().length,
    issuedCount: game.tickets.filter((t) => t.owner).length,
    maxPlayers: game.config.maxPlayers,
    waitingCount: countWaiting(),
    winners: game.winners,
    prize: game.config.prize,
    prizePerWinner: prizePerWinner(),
    players: lockedPlayers(),
    history: readJSON(HISTORY_FILE, []),
  });
}

/* ---------------- QR ---------------- */
function buildJoinUrl() { return `http://${getLocalIP()}:${PORT}/play.html`; }
function sendQR(target) {
  const joinUrl = buildJoinUrl();
  QRCode.toDataURL(joinUrl, {
    width: 360, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#8a0f10', light: '#fff8e7' },
  }).then((dataUrl) => {
    (target ? io.to(target) : io).emit('qr:ready', { dataUrl, joinUrl });
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
    r.cells.forEach((c) => { if (c && game.drawn.includes(c.value)) c.matched = true; });
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
function doDraw(manualNumber) {
  if (rolling) {
    io.emit('draw:error', { message: 'Đang quay số, vui lòng đợi…' });
    return;
  }
  const cfg = game.config;
  let num;
  if (manualNumber !== undefined && manualNumber !== null && manualNumber !== '') {
    num = Number(manualNumber);
    if (!Number.isInteger(num) || num < cfg.minNumber || num > cfg.maxNumber || game.drawn.includes(num)) {
      io.emit('draw:error', { message: 'Số không hợp lệ hoặc đã được xổ.' });
      return;
    }
  } else {
    const available = [];
    for (let n = cfg.minNumber; n <= cfg.maxNumber; n++) if (!game.drawn.includes(n)) available.push(n);
    if (!available.length) { io.emit('draw:error', { message: 'Đã xổ hết các số!' }); return; }
    num = available[Math.floor(Math.random() * available.length)];
  }

  const duration = Math.max(1000, Math.min(20000, (Number(cfg.rollSeconds) || 6) * 1000));
  const snapshot = game;              // nếu đổi ván trong lúc quay thì bỏ kết quả cũ
  rolling = true;
  io.emit('draw:rolling', { duration, min: cfg.minNumber, max: cfg.maxNumber });

  setTimeout(() => {
    if (game !== snapshot) { rolling = false; return; }
    game.drawn.push(num);

    const newKinh = [];
    const newWaiting = [];

    game.tickets.forEach((ticket) => {
      if (!ticket.owner) return;
      ticket.rows.forEach((row, ri) => {
        rowNumbers(row).forEach((c) => { if (c.value === num) c.matched = true; });
        const unmatched = rowNumbers(row).filter((c) => !c.matched);
        row.complete = unmatched.length === 0;

        if (row.complete && !row.awarded) {
          row.awarded = true;
          ticket.won = true;
          row.kinhPosition = game.winners.length + 1;
          const winner = {
            playerId: ticket.owner, code: ticket.code, name: ticket.name, row: ri + 1,
            position: row.kinhPosition, time: Date.now(), acked: false,
          };
          game.winners.push(winner);
          newKinh.push({ ticket, winner });
        } else if (!row.complete && unmatched.length === 1 && !row.waitingNotified) {
          row.waitingNotified = true;
          newWaiting.push({ ticket, row: ri + 1, missing: unmatched[0].value });
        }
      });
    });

    persistState();
    io.emit('draw:result', { number: num, drawn: game.drawn });

    game.tickets.forEach((ticket) => {
      if (ticket.socketId) {
        io.to(ticket.socketId).emit('ticket:update', { rows: serializeRows(ticket), drawn: game.drawn });
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
          winner, prize: game.config.prize,
          prizePerWinner: prizePerWinner(), totalWinners: game.winners.length,
        });
      }
    });
    if (newKinh.length) {
      io.emit('host:kinh', {
        winners: game.winners, prizePerWinner: prizePerWinner(),
        latest: newKinh.map((w) => w.winner),
      });
    }
    rolling = false;
    emitHostState();
  }, duration);
}

/* ---------------- Socket ---------------- */
io.on('connection', (socket) => {
  socket.on('host:register', () => { emitHostState(); sendQR(socket.id); });

  // Chỉ đổi thời gian quay, không làm mất ván đang chơi
  socket.on('settings:update', (s) => {
    if (!s || !s.rollSeconds) return;
    game.config.rollSeconds = Math.max(2, Math.min(15, Number(s.rollSeconds) || 6));
    persistState();
    emitHostState();
  });

  socket.on('config:update', (cfg) => {
    const maxPlayers = Math.max(1, Math.min(1000, Number(cfg.maxPlayers) || 200));
    const prize = Math.max(0, Number(cfg.prize) || 0);
    const rollSeconds = Math.max(2, Math.min(15, Number(cfg.rollSeconds) || game.config.rollSeconds || 6));
    rolling = false;
    io.emit('draw:cancel');
    game = freshGame({ maxPlayers, prize, rollSeconds });
    persistState();
    io.emit('game:reset', { config: game.config });
    emitHostState();
    sendQR();
  });

  socket.on('game:new', () => {
    rolling = false;
    io.emit('draw:cancel');
    game = freshGame(game.config);
    persistState();
    io.emit('game:reset', { config: game.config });
    emitHostState();
    sendQR();
  });

  socket.on('game:finish', () => {
    appendHistory();
    io.emit('game:finished', { winners: game.winners, drawn: game.drawn });
    emitHostState();
  });

  socket.on('draw:request', (payload) => { doDraw(payload && payload.manual); });

  socket.on('player:join', (payload) => {
    const playerId = payload && payload.playerId;
    if (!playerId) return;
    let ticket = game.tickets.find((t) => t.owner === playerId);
    if (!ticket) {
      // Nếu đã chốt vé nhưng tải lại trang, giữ nguyên vé cũ
      ticket = game.tickets.find((t) => t.locked && t.owner === playerId);
      if (!ticket) {
        ticket = pickFreeTicket();
        if (!ticket) {
          socket.emit('player:rejected', { message: `Đã đủ ${game.config.maxPlayers} vé. Vui lòng chờ ván mới!` });
          return;
        }
        giveTicket(ticket, playerId, payload.name, socket.id);
      }
    }
    ticket.socketId = socket.id;
    if (payload.name) ticket.name = String(payload.name).slice(0, 20);
    persistState();
    socket.emit('ticket:assigned', serializeTicket(ticket));
    emitHostState();
  });

  // Đổi sang một vé random khác (chưa ai giữ)
  socket.on('ticket:change', (payload) => {
    const playerId = payload && payload.playerId;
    const cur = game.tickets.find((t) => t.owner === playerId);
    if (!cur) return;
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
    giveTicket(next, playerId, name, socket.id);
    persistState();
    socket.emit('ticket:assigned', serializeTicket(next));
    socket.emit('ticket:changed', { code: next.code });
    emitHostState();
  });

  // Chốt vé -> xuất hiện trong danh sách người chơi trên màn hình chính
  socket.on('ticket:lock', (payload) => {
    const ticket = game.tickets.find((t) => t.owner === (payload && payload.playerId));
    if (!ticket) return;
    ticket.locked = true;
    persistState();
    socket.emit('ticket:locked', { code: ticket.code, name: ticket.name });
    io.emit('host:players', { players: lockedPlayers() });
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
    const ticket = game.tickets.find((t) => t.owner === (payload && payload.playerId));
    if (!ticket || !payload.name) return;
    ticket.name = String(payload.name).slice(0, 20);
    game.winners.forEach((w) => { if (w.playerId === payload.playerId) w.name = ticket.name; });
    persistState();
    emitHostState();
  });

  socket.on('disconnect', () => {
    game.tickets.forEach((t) => { if (t.socketId === socket.id) t.socketId = null; });
  });
});

/* ---------------- Static ---------------- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/state', (req, res) => {
  res.json({
    serverTime: Date.now(), joinUrl: buildJoinUrl(),
    config: game.config, drawn: game.drawn,
    playerCount: lockedPlayers().length,
    issued: game.tickets.filter((t) => t.owner).length,
    waitingCount: countWaiting(),
    players: lockedPlayers(), winners: game.winners,
    history: readJSON(HISTORY_FILE, []),
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const signatures = game.tickets.map((t) => gridSignature(t.rows));
  const unique = new Set(signatures).size;
  const dup = game.tickets.length - unique;
  console.log('================================================');
  console.log(`  Kiểm tra vé: ${game.tickets.length} vé, ${unique} vé khác nhau, ${dup} vé trùng`);
  console.log('  LÔ TÔ TẾT - Máy chủ đã sẵn sàng');
  console.log(`  Màn hình chính: http://localhost:${PORT}`);
  console.log(`  Người chơi quét QR: ${buildJoinUrl()}`);
  console.log(`  Vé 9x9 · ${game.config.maxPlayers} vé · giải ${game.config.prize.toLocaleString('vi-VN')}d`);
  console.log('================================================');
});
