const assert = require('node:assert/strict');
const { describe, it, before, after } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { io: createClient } = require('socket.io-client');
const { logTestIO } = require('./test-io');
const TEST_ADMIN_PASSWORD = 'test-only-admin-password';
const TEST_ADMIN_SALT = 'integration-test-salt';

function event(socket, name, predicate = () => true, timeout = 5000) {
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
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error('Server exited before startup');
    try {
      const response = await fetch(`${url}/api/state`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('Server did not start');
}

describe('Loto Tet socket integration', () => {
  let child;
  let admin;
  let player;
  let duplicatePlayer;
  let returningPlayer;
  let waitingPlayer;
  let tv;
  let dataDir;
  let baseUrl;

  before(async () => {
    const port = await freePort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loto-tet-test-'));
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname + '/..',
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
  });

  after(() => {
    for (const socket of [admin, player, duplicatePlayer, returningPlayer, waitingPlayer, tv]) socket?.close();
    child?.kill('SIGTERM');
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('authenticates admin, blocks unauthorized control, and enforces game flow', async (t) => {
    for (const page of ['/', '/play.html', '/tv.html', '/favicon.svg', '/js/announcer.js']) {
      const response = await fetch(`${baseUrl}${page}`);
      assert.equal(response.status, 200, `${page} should be served`);
    }

    admin = await connect(baseUrl);
    const denied = event(admin, 'admin:login-failed');
    admin.emit('admin:login', { password: 'wrong' });
    assert.match((await denied).message, /không đúng/i);

    const authenticated = event(admin, 'admin:authenticated');
    admin.emit('admin:login', { password: TEST_ADMIN_PASSWORD });
    await authenticated;
    admin.emit('host:register');

    const unauthorized = await connect(baseUrl);
    const required = event(unauthorized, 'admin:required');
    unauthorized.emit('game:new');
    await required;
    unauthorized.close();

    const livePrice = event(admin, 'host:state', (state) => state.config?.betPerTicket === 50000);
    admin.emit('settings:update', { betPerTicket: 50000 });
    await livePrice;
    assert.equal((await (await fetch(`${baseUrl}/api/state`)).json()).config.betPerTicket, 50000);

    const noPlayers = event(admin, 'draw:error');
    admin.emit('draw:request', {});
    assert.match((await noPlayers).message, /chốt vé/i);

    const configured = event(admin, 'host:state', (state) => state.config?.maxPlayers === 8);
    admin.emit('config:update', {
      maxPlayers: 8, betPerTicket: 10000, rollSeconds: 2,
      autoRollSeconds: 1, maxWinners: 1,
    });
    await configured;
    assert.equal((await (await fetch(`${baseUrl}/api/state`)).json()).config.maxWinners, 1);

    const rules = event(admin, 'host:state', (state) => state.rulesVisible === true);
    admin.emit('tv:rules', { visible: true });
    await rules;

    admin.emit('admin:wallet-deposit', { name: 'Lan', amount: 20000 });
    admin.emit('admin:wallet-deposit', { name: 'Lan (2)', amount: 10000 });
    await delay(200);

    player = await connect(baseUrl);
    const assigned = event(player, 'ticket:assigned');
    player.emit('player:join', { playerId: 'test-player-1', name: 'Lan', ticketCount: 2 });
    const ticketData = await assigned;
    assert.equal(ticketData.tickets.length, 2);
    assert.equal(ticketData.config.betPerTicket, 10000);

    tv = await connect(baseUrl);
    const publicState = event(tv, 'tv:state');
    tv.emit('tv:register');
    const tvSnapshot = await publicState;
    assert.equal(tvSnapshot.participants[0].name, 'Lan');
    assert.equal(tvSnapshot.participants[0].locked, false);
    assert.equal(tvSnapshot.participants[0].ticketCount, 2);

    // Vé mới được chọn (chưa chốt) thì ván chưa bắt đầu: đổi mức cược vẫn được phép.
    // Kiểm tra khóa cứng sau khi đã Chốt vé (xem bên dưới).

    duplicatePlayer = await connect(baseUrl);
    const duplicateAssigned = event(duplicatePlayer, 'ticket:assigned');
    duplicatePlayer.emit('player:join', { playerId: 'test-player-duplicate', name: 'Lan' });
    const duplicateData = await duplicateAssigned;
    assert.equal(duplicateData.name, 'Lan (2)');

    const locked = event(player, 'ticket:locked');
    const adminPlayerState = event(admin, 'host:state', (value) => {
      const lan = (value.players || []).find((entry) => entry.playerId === 'test-player-1');
      return lan && lan.locked && lan.bet === 20000;
    });
    const tvLockedState = event(tv, 'tv:state', (value) =>
      value.participants?.some((participant) => participant.name === 'Lan' && participant.locked));
    player.emit('ticket:lock', { playerId: 'test-player-1' });
    await locked;
    const detailedState = await adminPlayerState;
    const tvLockedSnapshot = await tvLockedState;
    assert.equal(tvLockedSnapshot.participants.find((participant) => participant.name === 'Lan').locked, true);
    // 4 ô tài chính/luật chơi bị khóa ngay sau khi chốt vé.
    const rejectedPriceChange = event(admin, 'settings:error');
    admin.emit('settings:update', { betPerTicket: 50000 });
    const lockError = await rejectedPriceChange;
    assert.match(lockError.message, /khóa trong ván/i);
    logTestIO(t, {
      input: { action: 'settings:update', field: 'betPerTicket', value: 50000, state: 'đã chốt vé' },
      output: { accepted: false, message: lockError.message,
        betUnchanged: (await (await fetch(`${baseUrl}/api/state`)).json()).config.betPerTicket },
    });
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(state.playerCount, 1);
    assert.equal(state.players[0].name, 'Lan');
    const detailedLan = detailedState.players.find((entry) => entry.playerId === 'test-player-1');
    assert.equal(detailedLan.bet, 20000);
    assert.equal('debt' in state.players[0], false);

    const walletDeposit = event(player, 'wallet:summary', (value) => value.deposited === 40000);
    admin.emit('admin:wallet-deposit-quick', { playerId: 'test-player-1' });
    const walletAfterDeposit = await walletDeposit;
    await delay(200);
    const afterDepositRes = await fetch(`${baseUrl}/api/state`);
    const afterDepositJson = await afterDepositRes.json();
    const afterDeposit = { players: [afterDepositJson.players.find((e) => e.name === 'Lan') || {}] };
    assert.equal(walletAfterDeposit.deposited, 40000);
    assert.equal(walletAfterDeposit.winnings, 0);
    assert.equal(walletAfterDeposit.debt, 0);
    assert.equal(afterDeposit.players.find((entry) => entry.name === 'Lan').deposited, 40000);

    const walletLoan = event(player, 'wallet:summary', (value) => value.debt === 5000);
    admin.emit('admin:wallet-loan', { playerId: 'test-player-1', amount: 5000 });
    const walletAfterLoan = await walletLoan;
    await delay(100);
    assert.equal(walletAfterLoan.deposited, 40000);

    const loanCleared = event(admin, 'host:state', (value) => {
      const lan = (value.players || []).find((entry) => entry.playerId === 'test-player-1');
      return lan && lan.debt === 0;
    });
    admin.emit('admin:clear-debt', { playerId: 'test-player-1' });
    await loanCleared;

    admin.emit('admin:set-payment', { playerId: 'test-player-1', status: 'debt' });
    await delay(100);
    admin.emit('admin:clear-debt', { playerId: 'test-player-1' });
    await delay(200);
    const markedPaid = event(admin, 'host:state', (value) => {
      const lan = (value.players || []).find((entry) => entry.playerId === 'test-player-1');
      return lan && lan.paymentStatus === 'paid';
    });
    admin.emit('admin:set-payment', { playerId: 'test-player-1', status: 'paid' });
    await markedPaid;
    const reRecordedDebt = event(admin, 'host:state', (value) => {
      const lan = (value.players || []).find((entry) => entry.playerId === 'test-player-1');
      return lan && lan.debt === 20000;
    });
    admin.emit('admin:set-payment', { playerId: 'test-player-1', status: 'debt' });
    await reRecordedDebt;
    admin.emit('admin:adjust-wallet', {
      playerId: 'test-player-1', amount: 250, reason: 'test', addDebt: false,
    });
    await delay(200);
    admin.emit('admin:zero-balance', { playerId: 'test-player-1' });
    await delay(200);
    const debtSnapshot = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(debtSnapshot.players.find((entry) => entry.name === 'Lan').paymentStatus, undefined);

    assert.equal(tvSnapshot.config.betPerTicket, 10000);
    const tvLan = tvLockedSnapshot.players.find((entry) => entry.name === 'Lan');
    assert.equal('debt' in tvLan, false);
    assert.equal('paymentStatus' in tvLan, false);

    const firstRowNumbers = ticketData.tickets[0].rows[0].cells
      .filter(Boolean).map((cell) => cell.value);
    assert.equal(firstRowNumbers.length, 5);
    const tvNearBingoState = event(tv, 'tv:state', (value) =>
      value.participants?.some((participant) => participant.name === 'Lan' && participant.waitingRows > 0), 10000);
    for (const number of firstRowNumbers) {
      const drawResult = event(admin, 'draw:result', (result) => result.number === number, 5000);
      if (number === firstRowNumbers.at(-1)) {
        var winnerLimit = event(admin, 'game:limit-reached');
      }
      admin.emit('draw:request', { manual: number });
      await drawResult;
    }
    const nearBingoSnapshot = await tvNearBingoState;
    assert.ok(nearBingoSnapshot.participants.find((participant) => participant.name === 'Lan').waitingRows > 0);
    await winnerLimit;
    const capped = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(capped.maxWinnersReached, true);
    logTestIO(t, {
      input: { maxWinners: 1, drawn: capped.drawn.length, winners: capped.winners.length },
      output: { maxWinnersReached: capped.maxWinnersReached, prizePerWinner: capped.prizePerWinner },
    });
    const cappedDraw = event(admin, 'draw:error');
    admin.emit('draw:request', {});
    assert.match((await cappedDraw).message, /tối đa/i);

    returningPlayer = await connect(baseUrl);
    const returning = event(returningPlayer, 'player:returning');
    const restored = event(returningPlayer, 'ticket:assigned');
    returningPlayer.emit('player:join', {
      playerId: 'new-device-id',
      name: 'Lan',
      ticketCount: 1,
    });
    await returning;
    assert.equal((await restored).tickets.length, 2);

    waitingPlayer = await connect(baseUrl);
    const waiting = event(waitingPlayer, 'player:waiting');
    waitingPlayer.emit('player:join', {
      playerId: 'test-player-2', name: 'Mai', ticketCount: 1,
    });
    assert.match((await waiting).message, /hàng chờ/i);
    const persistedQueue = JSON.parse(fs.readFileSync(path.join(dataDir, 'game-state.json'), 'utf8'));
    assert.equal(persistedQueue.waitingPlayers.length, 1);

    const settled = event(admin, 'host:state', (value) => value.leaderboard?.[0]?.winnings === 20000);
    admin.emit('game:finish');
    await settled;
    admin.emit('game:finish');
    await delay(50);
    const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'finance.json'), 'utf8'));
    logTestIO(t, {
      input: { action: 'game:finish', winners: ledger.lan ? 1 : 0, winner: 'Lan' },
      output: { winnings: ledger.lan.winnings, totalWon: ledger.lan.totalWon,
        deposited: ledger.lan.deposited, debt: ledger.lan.debt },
    });
    assert.equal(ledger.lan.winnings, 20000);
    assert.equal(ledger.lan.deposited, 20000);
    assert.equal(ledger.lan.debt, 0);
    assert.ok(ledger.lan.transactions.some((entry) => entry.type === 'debt-offset' && entry.amount === -20000));
    const hiddenLeaderboard = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(hiddenLeaderboard.leaderboard.length, 0);
    const visibleLeaderboard = event(tv, 'tv:state', (value) => value.leaderboardVisible === true);
    admin.emit('tv:leaderboard', { visible: true });
    assert.equal((await visibleLeaderboard).leaderboard[0].winnings, 20000);

    const nextTicket = event(waitingPlayer, 'ticket:assigned');
    admin.emit('game:new');
    const assignedNextRound = await nextTicket;
    assert.equal(assignedNextRound.tickets.length, 1);
    const nextState = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(nextState.waitingPlayers, 0);

    const freshGameJoin = event(returningPlayer, 'ticket:assigned');
    returningPlayer.emit('player:join', {
      playerId: 'new-device-id',
      name: 'Lan',
    });
    assert.equal((await freshGameJoin).tickets.length, 1);

    const kickedState = event(admin, 'host:state', (state) => state.playerCount === 0);
    admin.emit('admin:kick-player', { playerId: 'new-device-id' });
    await kickedState;

    const zeroBetTvState = event(tv, 'tv:state', (value) => value.config?.betPerTicket === 0);
    admin.emit('config:update', {
      maxPlayers: 8, betPerTicket: 0, rollSeconds: 2,
      autoRollSeconds: 1, maxWinners: 1,
    });
    await zeroBetTvState;
  });
});
