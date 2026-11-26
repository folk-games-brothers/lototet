/* State tập trung: Map kho vé V001..V200, Set số đã quay để truy xuất O(1). */
const server = require('./server');

// Map mã vé -> ticket, cho phép tra cứu O(1) thay vì Array.find.
const ticketMap = new Map();
function syncTicketMap() {
  ticketMap.clear();
  const game = server.state.game;
  if (game && Array.isArray(game.tickets)) {
    for (const ticket of game.tickets) ticketMap.set(ticket.code, ticket);
  }
}
function getTicket(code) { return ticketMap.get(code); }
function hasTicket(code) { return ticketMap.has(code); }

// Set số đã quay để kiểm tra has O(1).
function drawnSet() {
  const game = server.state.game;
  return new Set(game && Array.isArray(game.drawn) ? game.drawn : []);
}
function hasDrawn(number) { return drawnSet().has(Number(number)); }

module.exports = {
  state: server.state,
  game: () => server.state.game,
  finances: () => server.state.finances,
  waitingPlayers: () => server.state.waitingPlayers,
  joiningPlayers: () => server.state.joiningPlayers,
  previewTickets: () => server.state.previewTickets,
  ticketMap, syncTicketMap, getTicket, hasTicket,
  drawnSet, hasDrawn,
};
