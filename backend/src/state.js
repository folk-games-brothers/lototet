/* State tập trung: Map kho vé V001..V200, Set số đã quay để truy xuất O(1). */
// Tránh circular dependency: require server.js trễ khi gọi hàm, không require ở top-level.
function server() { return require('./server'); }

// Map mã vé -> ticket, cho phép tra cứu O(1) thay vì Array.find.
const ticketMap = new Map();
function syncTicketMap() {
  ticketMap.clear();
  const game = server().state.game;
  if (game && Array.isArray(game.tickets)) {
    for (const ticket of game.tickets) ticketMap.set(ticket.code, ticket);
  }
}
function getTicket(code) { return ticketMap.get(code); }
function hasTicket(code) { return ticketMap.has(code); }

// Set số đã quay để kiểm tra has O(1).
let drawnCache = { source: null, length: -1, set: new Set() };
function drawnSet() {
  const game = server().state.game;
  const source = game && Array.isArray(game.drawn) ? game.drawn : [];
  // Cache theo mảng + độ dài: mỗi lượt xổ chỉ tạo Set một lần, không tạo lại
  // cho từng ô của 3 vé × 500-1000 người chơi.
  if (drawnCache.source === source && drawnCache.length === source.length) return drawnCache.set;
  drawnCache = { source, length: source.length, set: new Set(source) };
  return drawnCache.set;
}
function hasDrawn(number) { return drawnSet().has(Number(number)); }

function getState() { return server().state; }
module.exports = {
  getState,
  ticketMap, syncTicketMap, getTicket, hasTicket,
  drawnSet, hasDrawn,
};
Object.defineProperty(module.exports, 'state', { get: () => server().state });
Object.defineProperty(module.exports, 'game', { get: () => server().state.game });
Object.defineProperty(module.exports, 'finances', { get: () => server().state.finances });
Object.defineProperty(module.exports, 'waitingPlayers', { get: () => server().state.waitingPlayers });
Object.defineProperty(module.exports, 'joiningPlayers', { get: () => server().state.joiningPlayers });
Object.defineProperty(module.exports, 'previewTickets', { get: () => server().state.previewTickets });
