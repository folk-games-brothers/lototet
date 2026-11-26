/* Logic nghiệp vụ thuần túy: quay số, Kinh, chia giải, cấn nợ, khóa cài đặt. */
const server = require('./server');
const state = require('./state');

function randomDrawn() {
  const game = server.state.game;
  const available = [];
  for (let n = game.config.minNumber; n <= game.config.maxNumber; n++) {
    if (!server.state.drawnSet().has(n)) available.push(n);
  }
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function isLockedSettings(roundStarted) {
  const locked = ['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'];
  return locked;
}

function prizeSplit(pool, winners) {
  if (!winners || !winners.length) return pool;
  return Math.max(0, Math.floor(pool / winners.length / 1000) * 1000);
}

function canStartRound() {
  const game = server.state.game;
  return !(game.maxWinnersReached);
}

module.exports = {
  randomDrawn,
  isLockedSettings,
  prizeSplit,
  canStartRound,
  buildGrid: server.buildGrid,
  gridSignature: server.gridSignature,
  rowNumbers: server.rowNumbers,
  isRoundComplete: server.isRoundComplete,
  settleGame: server.settleGame,
  prizePool: server.prizePool,
  prizePerWinner: server.prizePerWinner,
  accountFor: server.accountFor,
  leaderboard: server.leaderboard,
  positiveMoney: server.positiveMoney,
  maxTicketsPerPlayer: server.maxTicketsPerPlayer,
};
