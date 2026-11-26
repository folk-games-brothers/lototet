/* Logic nghiệp vụ: sinh lưới vé, Kinh, chia giải, trạng thái ván. */
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

function game() {
  return require('./server').state.game;
}

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

module.exports = {
  buildGrid, gridSignature, rowNumbers, prizePool, prizePerWinner, isRoundComplete,
  ROWS, COLS, PER_ROW,
};
