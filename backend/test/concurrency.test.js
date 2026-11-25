const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { io: createClient } = require('socket.io-client');

const TEST_ADMIN_PASSWORD = 'test-only-admin-password';
const TEST_ADMIN_SALT = 'integration-test-salt';

function event(socket, name, predicate = () => true, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, onEvent);
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeout);
    function onEvent(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(name, onEvent);
      resolve(payload);
    }
    socket.on(name, onEvent);
  });
}

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function connect(url) {
  const socket = createClient(url, { reconnection: false, timeout: 3000 });
  await event(socket, 'connect');
  return socket;
}

async function waitForServer(url, child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Server exited before startup');
    try {
      const response = await fetch(`${url}/api/state`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('Server did not start');
}

// Mỗi test chạy trên server + data dir riêng để không dính state của test trước.
describe('Loto Tet concurrency', () => {
  let child;
  let baseUrl;
  let dataDir;
  let admin;
  const sockets = [];

  beforeEach(async () => {
    const port = await freePort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loto-tet-concurrency-'));
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        ADMIN_PASSWORD_SALT: TEST_ADMIN_SALT,
        ADMIN_PASSWORD_HASH: crypto.scryptSync(TEST_ADMIN_PASSWORD, TEST_ADMIN_SALT, 32).toString('hex'),
      },
      stdio: 'ignore',
    });
    await waitForServer(baseUrl, child);
    admin = await connect(baseUrl);
    sockets.push(admin);
    const authenticated = event(admin, 'admin:authenticated');
    admin.emit('admin:login', { password: TEST_ADMIN_PASSWORD });
    await authenticated;
    admin.emit('host:register');
  });

  afterEach(() => {
    while (sockets.length) sockets.pop()?.close();
    child?.kill('SIGTERM');
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function config(overrides = {}) {
    const cfg = Object.assign({
      maxPlayers: 30, maxTicketsPerPlayer: 1, betPerTicket: 1000,
      maxWinners: 1, rollSeconds: 1, autoRollSeconds: 6,
    }, overrides);
    const key = Object.keys(overrides)[0] || 'maxPlayers';
    const done = event(admin, 'host:state', (s) => s.config && s.config[key] === cfg[key]);
    admin.emit('config:update', cfg);
    await done;
    return cfg;
  }

  async function joinPlayers(count, prefix, ticketCount = 1) {
    const clients = [];
    for (let i = 1; i <= count; i++) {
      admin.emit('admin:wallet-deposit', { name: `${prefix}${i}`, amount: 10000 });
    }
    await delay(150);
    for (let i = 1; i <= count; i++) {
      const client = await connect(baseUrl);
      sockets.push(client);
      clients.push(client);
    }
    const results = clients.map((socket) => new Promise((resolve) => {
      socket.once('ticket:assigned', (data) => resolve({ type: 'assigned', data }));
      socket.once('player:rejected', (data) => resolve({ type: 'rejected', data }));
    }));
    clients.forEach((socket, i) => socket.emit('player:join', {
      playerId: `${prefix.toLowerCase()}-${i + 1}`,
      name: `${prefix}${i + 1}`,
      ticketCount,
    }));
    return { clients, results: await Promise.all(results) };
  }

  function firstRowNumbers(assigned) {
    const ticket = assigned.tickets[0];
    return ticket.rows[0].cells.filter(Boolean).map((c) => c.value);
  }

  async function manualDraw(number) {
    const result = event(admin, 'draw:result', (r) => r.number === number, 8000);
    admin.emit('draw:request', { manual: number });
    await result;
  }

  async function apiState() {
    return (await fetch(`${baseUrl}/api/state`)).json();
  }
  function finances() {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'finance.json'), 'utf8'));
  }
  function gameState() {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'game-state.json'), 'utf8'));
  }

  it('chỉ 1 trong 10 người giữ V001 khi chọn/chốt đồng thời, 9 người bị từ chối và không trừ tiền', async () => {
    await config({ maxPlayers: 1, betPerTicket: 1000, maxTicketsPerPlayer: 1 });
    const { clients, results } = await joinPlayers(10, 'C');
    const assigned = results.filter((r) => r.type === 'assigned');
    const rejected = results.filter((r) => r.type === 'rejected');
    assert.equal(assigned.length, 1, 'chỉ một người được nhận vé');
    assert.equal(rejected.length, 9, '9 người còn lại bị từ chối');
    assert.equal(assigned[0].data.tickets[0].code, 'V001');

    // Tất cả cùng gửi lệnh chốt; người không có vé phải bị bỏ qua.
    clients.forEach((socket) => socket.emit('ticket:lock', {
      playerId: clients.indexOf(socket) >= 0 ? `c-${clients.indexOf(socket) + 1}` : '',
    }));
    await delay(300);

    const state = await apiState();
    assert.equal(state.issued, 1);
    assert.equal(state.playerCount, 1, 'chỉ một vé ở trạng thái chốt');
    assert.equal(gameState().tickets.filter((t) => t.owner).length, 1);
    const fin = finances();
    for (let i = 1; i <= 10; i++) {
      assert.equal(fin['c' + i].deposited, 10000, 'không trừ tiền oan lúc chọn/chốt');
    }
  });

  it('chốt đúp và trả thưởng 3 lần liên tiếp chỉ xử lý đúng 1 lần, totalWon không đổi', async () => {
    await config({ maxPlayers: 5, betPerTicket: 1000, maxWinners: 1 });
    admin.emit('admin:wallet-deposit', { name: 'Duy', amount: 10000 });
    await delay(150);
    const client = await connect(baseUrl);
    sockets.push(client);
    const assigned = event(client, 'ticket:assigned');
    client.emit('player:join', { playerId: 'duy-1', name: 'Duy', ticketCount: 1 });
    const ticketData = await assigned;

    // 5 lệnh chốt giống hệt nhau trong cùng một tick.
    await Promise.all(Array.from({ length: 5 }, () => new Promise((resolve) => {
      client.once('ticket:locked', resolve);
      client.emit('ticket:lock', { playerId: 'duy-1' });
    })));
    const afterLock = await apiState();
    assert.equal(afterLock.playerCount, 1);
    assert.equal(gameState().tickets.filter((t) => t.owner === 'duy-1').length, 1, 'không tạo vé trùng');

    // Xổ đúng 5 số của một hàng để có Kinh -> tự chốt và cộng thưởng 1 lần.
    const finished = event(admin, 'game:finished', () => true, 8000);
    for (const number of firstRowNumbers(ticketData)) await manualDraw(number);
    await finished;
    const won = finances().duy;
    assert.equal(won.deposited, 9000, 'cược chỉ bị trừ đúng 1 lần');
    assert.equal(won.winnings, 1000);
    assert.equal(won.totalWon, 1000);

    // Admin bấm Trả thưởng 3 lần cực nhanh.
    await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve) => {
      admin.emit('admin:pay-reward', { playerId: 'duy-1' });
      setTimeout(resolve, 60);
    })));
    await delay(150);
    const afterPay = finances().duy;
    assert.equal(afterPay.winnings, 0, 'reward chỉ được xử lý 1 lần');
    assert.equal(afterPay.balance, 11000, 'số dư chỉ cộng đúng 1 lần');
    assert.equal(afterPay.totalWon, 1000, 'totalWon giữ nguyên');
  });

  it('chốt vé muộn bị từ chối khi ván đã xổ và Qua ván mới dọn sạch số đã xổ', async () => {
    await config({ maxPlayers: 5, betPerTicket: 1000, maxWinners: 2, rollSeconds: 1 });
    for (const name of ['An', 'Bê']) admin.emit('admin:wallet-deposit', { name, amount: 10000 });
    await delay(150);
    const a = await connect(baseUrl);
    const b = await connect(baseUrl);
    sockets.push(a, b);
    const aAssigned = event(a, 'ticket:assigned');
    a.emit('player:join', { playerId: 'a-1', name: 'An', ticketCount: 1 });
    const aData = await aAssigned;
    const bAssigned = event(b, 'ticket:assigned');
    b.emit('player:join', { playerId: 'b-1', name: 'Bê', ticketCount: 1 });
    await bAssigned;

    // A chốt trước, B còn đang chần chừ.
    const aLocked = event(a, 'ticket:locked');
    a.emit('ticket:lock', { playerId: 'a-1' });
    await aLocked;

    // Race: Admin xổ số ngay cùng lúc B bấm chốt vé.
    const lateLock = event(b, 'ticket:error', (x) => /chốt vé muộn/i.test(x.message), 8000);
    const started = event(admin, 'draw:result', (r) => r.number === 50, 8000);
    await Promise.all([
      (async () => { admin.emit('draw:request', { manual: 50 }); await started; })(),
      (async () => { b.emit('ticket:lock', { playerId: 'b-1' }); await lateLock; })(),
    ]);

    const mid = await apiState();
    assert.equal(mid.drawn.length, 1);
    assert.equal(mid.issued, 2);
    assert.equal(mid.playerCount, 1, 'vé chốt muộn không được tính vào ván');
    assert.equal(mid.prize, 1000, 'tổng giải chỉ tính 1 vé đã chốt');
    assert.equal(finances().an.deposited, 9000);
    assert.equal(finances()['bê'].deposited, 10000, 'người chốt muộn không bị trừ cược');

    // Race tiếp theo: đang quay thì Admin bấm Qua ván mới.
    const oldGameId = gameState().id;
    const drawStarted = event(admin, 'draw:rolling', () => true, 8000);
    admin.emit('draw:request', { manual: 51 });
    await drawStarted;
    const reset = event(admin, 'game:reset', () => true, 8000);
    admin.emit('admin:next-round');
    const payload = await reset;
    await delay(1300); // đợi setTimeout của lượt quay cũ kết thúc
    const fresh = await apiState();
    assert.deepEqual(fresh.drawn, [], 'ván mới không dính số của ván trước');
    assert.notEqual(gameState().id, oldGameId, 'đổi gameId');
    assert.equal(payload.saved, false, 'ván chưa đủ Kinh nên không ghi lịch sử');
  });

  it('20 người vào phòng đồng thời: tiền thu vào bằng tổng tiền giải, state nhất quán', async () => {
    const cfg = await config({ maxPlayers: 30, betPerTicket: 1000, maxWinners: 1, maxTicketsPerPlayer: 1 });
    const { clients, results } = await joinPlayers(20, 'N');
    assert.equal(results.filter((r) => r.type === 'assigned').length, 20);
    const winningNumbers = firstRowNumbers(results[0].data);

    await Promise.all(clients.map((client) => new Promise((resolve) => {
      client.once('ticket:locked', resolve);
      client.emit('ticket:lock', { playerId: `n-${clients.indexOf(client) + 1}` });
    })));
    const locked = await apiState();
    assert.equal(locked.playerCount, 20);
    assert.equal(locked.issued, 20);
    assert.equal(locked.prize, 20 * cfg.betPerTicket);

    const finished = event(admin, 'game:finished', () => true, 8000);
    for (const number of winningNumbers) await manualDraw(number);
    await finished;

    const fin = finances();
    const totalDeposited = Object.values(fin).reduce((sum, a) => sum + a.deposited, 0);
    const totalWinnings = Object.values(fin).reduce((sum, a) => sum + a.winnings, 0);
    const totalWithdrawn = 20 * cfg.betPerTicket;
    assert.equal(totalDeposited, 20 * 10000 - totalWithdrawn, 'tổng cược thu vào đúng 20 vé');
    assert.equal(locked.prize, totalWithdrawn, 'tổng giải = tổng tiền thu');
    assert.ok(totalWinnings <= locked.prize, 'tiền thưởng không vượt tổng giải');
    assert.ok(totalWinnings % 1000 === 0, 'tiền thưởng làm tròn bội số 1.000đ');
    const finalState = await apiState();
    assert.equal(finalState.maxWinnersReached, true);
    assert.ok(finalState.winners.length >= 1);
  });
});
