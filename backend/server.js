// Entry point mỏng: chỉ khởi tạo HTTP/Realtime server từ backend/src/server.js.
process.env.LOTO_SERVER_AUTOSTART = '1';
const server = require('./src/server');
module.exports = server;
if (require.main === module && typeof server.start === 'function') server.start();