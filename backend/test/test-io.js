/* Tiện ích ghi log Input/Output có cấu trúc cho Test Dashboard. */
function logTestIO(t, { input, output } = {}) {
  if (!t || typeof t.diagnostic !== 'function') return;
  t.diagnostic('__IO__:' + JSON.stringify({ input, output }));
}
module.exports = { logTestIO };
