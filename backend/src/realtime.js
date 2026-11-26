/* Quản lý client realtime: sync:full khi mới kết nối + gộp broadcast 50ms. */
const server = require('./server');

const clients = new Set();
const pending = new Map();
let flushTimer = null;

function addClient(socket) {
  clients.add(socket);
  if (typeof socket.emit === 'function') {
    socket.emit('sync:full', server.emitHostState && server.state ? server.state.game : null);
  }
  socket.on('disconnect', () => clients.delete(socket));
}

function removeClient(socket) { clients.delete(socket); }

function broadcast(event, payload, debounceMs = 50) {
  if (debounceMs <= 0) {
    for (const socket of clients) socket.emit(event, payload);
    return;
  }
  pending.set(event, payload);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const [eventName, data] of pending.entries()) {
      for (const socket of clients) socket.emit(eventName, data);
    }
    pending.clear();
  }, debounceMs);
}

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  for (const [eventName, data] of pending.entries()) {
    for (const socket of clients) socket.emit(eventName, data);
  }
  pending.clear();
}

module.exports = { addClient, removeClient, broadcast, flush, clients };
