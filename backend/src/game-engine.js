/* Logic nghiệp vụ: sinh lưới vé, Kinh, tài chính, chia giải, cấn nợ, khóa cài đặt. */
const ROWS = 9;
const COLS = 9;
const PER_ROW = 5;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function server() { return require('./server'); }
function state() { return server().state; }
function game() { return state().game; }
function finances() { return state().finances; }

function buildGrid(drawn) {
  const used = new Set(drawn || []);
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const offsets = shuffle([...Array(COLS).keys()]);

  for (let c = 0; c < COLS; c++) {
    const lo = c === 0 ? 1 : c * 10;
    const hi = c === COLS - 1 ? 90 : c * 10 + 9;
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    shuffle(pool);
    const nums = pool.slice(0, PER_ROW).sort((a, b) => a - b);
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
      awarded: unmatched === 0,
      waitingNotified: false,
      kinhPosition: null,
    };
  });
}

function gridSignature(rows) {
  return rows.map((r) => r.cells.map((c) => (c ? c.value : '_')).join(',')).join('|');
}

function rowNumbers(row) { return row.cells.filter(Boolean); }

function financeKey(name) { return server().financeKey(name); }
function accountFor(name) {
  const financesObj = finances();
  const key = financeKey(name);
  if (!financesObj[key]) financesObj[key] = { name: String(name || ''), deposited: 0, winnings: 0, totalWon: 0, debt: 0, balance: 0, transactions: [] };
  const account = financesObj[key];
  if (!Number.isFinite(Number(account.deposited))) account.deposited = Number(account.balance) || 0;
  if (!Number.isFinite(Number(account.balance))) account.balance = Number(account.deposited) || 0;
  if (!Number.isFinite(Number(account.totalWon))) account.totalWon = 0;
  if (!Array.isArray(account.transactions)) account.transactions = [];
  return account;
}

function leaderboard() {
  return Object.values(finances())
    .map((account) => ({
      name: account.name,
      totalWon: Number(account.totalWon) || 0,
      winnings: Number(account.winnings) || 0,
    }))
    .filter((entry) => entry.totalWon > 0)
    .sort((a, b) => b.totalWon - a.totalWon || a.name.localeCompare(b.name, 'vi'));
}

function prizePool() {
  const g = game();
  const sold = g.tickets.filter((t) => t.owner && t.locked).length;
  return sold * (Number(g.config.betPerTicket) || 0);
}

function prizePerWinner() {
  const pool = prizePool();
  const g = game();
  if (!g.winners.length) return pool;
  return Math.max(0, Math.floor(pool / g.winners.length / 1000) * 1000);
}

function isRoundComplete() {
  const g = game();
  const limit = Number(g.config.maxWinners) || 0;
  return limit > 0 ? g.winners.length >= limit : g.winners.length > 0;
}

function payRewardFromWinnings(account) {
  const reward = Number(account.winnings) || 0;
  if (reward <= 0) return 0;
  account.balance += reward;
  account.winnings = 0;
  return reward;
}

function offsetDebtWithReward(account) {
  const used = Math.min(Number(account.winnings) || 0, Number(account.debt) || 0);
  if (used <= 0) return 0;
  account.winnings -= used;
  account.debt -= used;
  return used;
}

function lockedSettingFields() {
  return ['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'];
}

function isRoundStarted(game, rolling) {
  return game.drawn.length > 0 || !!rolling || game.tickets.some((t) => t.locked);
}

function settleGame() {
  const s = server();
  const g = state().game;
  const financesObj = state().finances;
  if (g.settled) return false;
  const paidPlayers = new Set();
  (g.winners || []).forEach((w) => {
    if (!g.topWinners.find((t) => t.playerId === w.playerId)) {
      g.topWinners.push({ playerId: w.playerId, name: w.name, wins: 1 });
    } else {
      const t = g.topWinners.find((x) => x.playerId === w.playerId);
      t.wins = (t.wins || 0) + 1;
      t.name = w.name;
    }
    const account = accountFor(w.name);
    const amount = prizePerWinner();
    const debtOffset = Math.min(Number(account.debt) || 0, amount);
    account.winnings += amount;
    account.totalWon += amount;
    account.balance += amount - debtOffset;
    s.appendFinanceTransaction(account, 'prize', amount, { gameId: g.id });
    if (debtOffset > 0) {
      account.debt -= debtOffset;
      s.appendFinanceTransaction(account, 'debt-offset', -debtOffset, {
        reason: 'Trừ nợ từ tiền thưởng', gameId: g.id,
      });
    }
    if (g.payments[w.playerId]) g.payments[w.playerId].debt = account.debt;
    paidPlayers.add(w.playerId);
  });
  g.settled = true;
  s.saveFinances();
  s.persistState();
  s.appendHistory();
  paidPlayers.forEach((playerId) => s.emitWalletSummary(playerId));
  return true;
}

module.exports = {
  ROWS, COLS, PER_ROW,
  buildGrid, gridSignature, rowNumbers, financeKey, accountFor, leaderboard,
  prizePool, prizePerWinner, isRoundComplete, payRewardFromWinnings,
  offsetDebtWithReward, lockedSettingFields, isRoundStarted, settleGame,
  shuffle,
};
