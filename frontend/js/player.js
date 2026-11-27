/* ============================================================
   LÔ TÔ TẾT - Logic trang người chơi
   - Mua 1..4 vé, chuyển đổi giữa các vé bằng tab
   - Vé truyền thống 9x9: đủ một hàng ngang -> KINH
   - Hàng còn đúng 1 số -> banner "đợi số XX"
   - Số vừa xổ hiển thị ở đầu trang
   ============================================================ */
const socket = io();
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const pad = (n) => String(n).padStart(2, '0');
function showTicketPrice(value) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return;
  $('playerTicketPrice').textContent = fmt(value);
}

let playerId = sessionStorage.getItem('loto_player_id');
if (!playerId) {
  playerId = 'P' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  sessionStorage.setItem('loto_player_id', playerId);
}
let playerName = localStorage.getItem('loto_player_name') || '';
let hasJoined = false;

const isPreview = new URLSearchParams(location.search).has('preview');
if (!playerName && !isPreview) {
  $('joinNameModal').classList.remove('hidden');
  document.querySelector('.player-app').classList.add('hidden');
}
if (isPreview) {
  $('previewBadge').classList.remove('hidden');
  $('ticketSelection').classList.remove('hidden');
}

/* ---------------- Ví tiền trên client ---------------- */
let wallet;
try { wallet = JSON.parse(localStorage.getItem('loto_wallet')) || {}; } catch (e) { wallet = {}; }
wallet = {
  deposited: Number(wallet.deposited) || 0,
  won: Number(wallet.won) || 0,
  debt: Number(wallet.debt) || 0,
};
function saveWallet() { localStorage.setItem('loto_wallet', JSON.stringify(wallet)); }
function renderWallet() {
  $('walletDeposited').textContent = fmt(wallet.deposited);
  $('walletWon').textContent = fmt(wallet.won);
  $('walletDebt').textContent = fmt(wallet.debt);
}
function applyWalletSummary(summary) {
  if (!summary) return;
  wallet.deposited = Number(summary.deposited) || 0;
  wallet.won = Number(summary.winnings) || 0;
  wallet.debt = Number(summary.debt) || 0;
  saveWallet();
  renderWallet();
}
renderWallet();

function joinGame() {
  if (!isPreview && !playerName) return;
  const want = Math.max(1, Math.min(4, Number($('ticketCount').value || 1)));
  if (hasJoined && want <= myTickets.length) return;
  hasJoined = true;
  socket.emit('player:join', {
    playerId,
    name: isPreview ? 'XEM TRƯỚC' : playerName,
    preview: isPreview,
    ticketCount: want,
  });
}

let myTickets = [];
let activeCode = '';
let myWinInfo = null;
let acked = false;
let wasWaiting = false;
let welcomedBack = false;
let pendingAnimatedNumber = null;

function activeTicket() {
  return myTickets.find((t) => t.code === activeCode) || myTickets[0] || null;
}
function currentRows() {
  const t = activeTicket();
  return (t && t.rows) || [];
}

/* ---------------- Popup thông báo ---------------- */
let toastTimer = null;
function showToast(message, kind = 'info') {
  if (!message) return;
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast toast-' + kind;
  void el.offsetWidth; // reset animation
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------------- Kết nối ---------------- */
function setStatus(text, online) {
  $('statusText').textContent = text;
  $('dot').className = 'dot ' + (online ? 'online' : 'offline');
}
socket.on('connect', () => {
  hasJoined = false;
  setStatus('Đã kết nối', true);
  if (isPreview || playerName) {
    // Sau khi refresh, nếu chưa có vé thì vẫn phải hiện lại nút "Nhận vé"
    if (!isPreview && playerName && !myTickets.length) {
      $('ticketSelection').classList.remove('hidden');
    }
    joinGame();
  } else setStatus('Nhập tên và số vé trước khi tham gia.', true);
});
socket.on('disconnect', () => setStatus('Mất kết nối – đang thử lại…', false));
socket.on('connect_error', () => setStatus('Không kết nối được máy chủ', false));
socket.on('player:waiting', ({ message, config } = {}) => {
  wasWaiting = true;
  showTicketPrice(config?.betPerTicket);
  $('ticketSelection').classList.add('hidden');
  setStatus(message || 'Đang chờ lượt tiếp theo…', true);
  showToast(message || 'Bạn đang ở hàng chờ. Vui lòng đợi ván tiếp theo.', 'info');
  $('rowsGrid').innerHTML = `<div class="empty" style="color:#8a5a2b">${message || 'Bạn đang ở hàng chờ. Vui lòng đợi ván tiếp theo.'}</div>`;
});
socket.on('player:returning', () => { welcomedBack = true; });
socket.on('player:kicked', ({ message }) => {
  myTickets = [];
  activeCode = '';
  $('ticketTabs').classList.add('hidden');
  $('rowsGrid').innerHTML = '';
  setStatus(message || 'Bạn đã được quản trò mời rời khỏi ván.', false);
  showToast(message || 'Bạn đã được quản trò mời rời khỏi ván.', 'error');
});

socket.on('player:rejected', ({ message, config } = {}) => {
  hasJoined = false;
  showTicketPrice(config?.betPerTicket);
  setStatus('Chưa có vé. Nạp tiền rồi bấm “Nhận vé”.', true);
  showToast(message, 'error');
  $('ticketName').textContent = '👤 ' + (playerName || 'Người chơi');
  $('rowsGrid').innerHTML = '<div class="empty" style="color:#8a5a2b">Chưa có vé.</div>';
  // Bị từ chối (thiếu tiền / hết vé) nhưng chưa có vé: giữ nút "Nhận vé" để thử lại
  if (!isPreview && !wasWaiting && myTickets.length < 4) {
    $('ticketSelection').classList.remove('hidden');
  }
});
socket.on('draw:result', ({ number }) => {
  pendingAnimatedNumber = Number(number);
});
socket.on('tv:state', (state) => showTicketPrice(state.config?.betPerTicket));
socket.on('draw:error', ({ message }) => {
  setStatus(message || 'Không thể xổ số.', false);
  showToast(message || 'Không thể xổ số.', 'error');
});
socket.on('game:reset', ({ config } = {}) => showTicketPrice(config?.betPerTicket));

/* ---------------- Nhận vé ---------------- */
function applyTicketData(data) {
  showTicketPrice(data.config?.betPerTicket);
  applyWalletSummary(data.wallet);
  if (Array.isArray(data.tickets) && data.tickets.length) {
    myTickets = data.tickets;
  } else {
    // tương thích dữ liệu 1 vé
    myTickets = [{
      code: data.code || '', name: data.name || '', locked: !!data.locked,
      won: false, rows: data.rows || [],
    }];
  }
  if (data.activeCode && myTickets.some((t) => t.code === data.activeCode)) {
    activeCode = data.activeCode;
  } else if (!myTickets.some((t) => t.code === activeCode)) {
    activeCode = myTickets[0] ? myTickets[0].code : '';
  }
  if (data.name && !isPreview) playerName = data.name;
  $('ticketSelection').classList.add('hidden');
  renderTicketTabs();
  applyLockState();
  renderRows();
  syncWaitingFromRows();
  if (data.drawn && data.drawn.length) $('lastNumber').textContent = pad(data.drawn[data.drawn.length - 1]);
}

socket.on('ticket:assigned', (data) => {
  const returning = wasWaiting || welcomedBack;
  wasWaiting = false;
  myWinInfo = null;
  acked = false;
  applyTicketData(data);
  renderWallet();
  $('ticketCount').disabled = !isPreview && myTickets.length >= 4;
  const n = myTickets.length;
  setStatus(returning
    ? 'Chào mừng bạn quay lại! Vé cũ đã được khôi phục, tiếp tục dò số.'
    : `Đã có ${n} vé (${currentRows().length} hàng/vé). Chờ xổ số!`, true);
  if (!returning && !isPreview) showToast(`Đã nhận ${n} vé. Chờ xổ số!`, 'success');
  if (!isPreview && myTickets.length < 4) {
    $('ticketSelection').classList.remove('hidden');
  }
  welcomedBack = false;
});

socket.on('ticket:update', (data) => {
  const prevRows = currentRows();
  if (Array.isArray(data.tickets)) {
    const keep = activeCode;
    myTickets = data.tickets;
    activeCode = myTickets.some((t) => t.code === keep) ? keep : (myTickets[0] ? myTickets[0].code : '');
    renderTicketTabs();
    applyLockState();
  }
  if (data.drawn && data.drawn.length) $('lastNumber').textContent = pad(data.drawn[data.drawn.length - 1]);
  renderRows();
  syncWaitingFromRows();
  if (matchedCount(currentRows()) > matchedCount(prevRows) && !myWinInfo) {
    navigator.vibrate && navigator.vibrate(50);
  }
});

socket.on('wallet:adjust', ({ amount, reason, addDebt }) => {
  const delta = Number(amount) || 0;
  wallet.deposited += delta;
  if (addDebt && delta > 0) wallet.debt += delta;
  saveWallet(); renderWallet();
  setStatus(`Admin điều chỉnh ví: ${fmt(delta)} (${reason || 'điều chỉnh'})`, true);
});
socket.on('wallet:summary', applyWalletSummary);
socket.on('wallet:debt', ({ debt }) => {
  wallet.debt = Math.max(0, Number(debt) || 0);
  saveWallet();
  renderWallet();
});
socket.on('wallet:balance', ({ balance }) => {
  wallet.deposited = Number(balance) || 0;
  saveWallet();
  renderWallet();
});

socket.on('game:reset', () => {
  hasJoined = false;
  localStorage.removeItem('loto_ticket_codes');
  localStorage.removeItem('loto_ticket_game_id');
  myTickets = []; activeCode = ''; myWinInfo = null; acked = false;
  $('winOverlay').classList.remove('show');
  hideWaitingBanner();
  $('lastNumber').textContent = '--';
  $('rowsGrid').innerHTML = '<div class="empty" style="color:#8a5a2b">Ván mới. Đang nhận vé…</div>';
  $('ticketTabs').classList.add('hidden');
  $('ticketTabs').innerHTML = '';
  $('progressText').textContent = '0 / 0 số đã trúng';
  $('progressBar').style.width = '0%';
  $('ticketCount').disabled = false;
  $('ticketSelection').classList.remove('hidden');
  applyLockState();
  setStatus('Ván mới – đang nhận vé…', true);
  joinGame();
});

/* ---------------- Tab các vé ---------------- */
function renderTicketTabs() {
  const box = $('ticketTabs');
  if (myTickets.length <= 1) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = myTickets.map((t, i) => {
    const kinh = t.won ? ' 🏆' : '';
    return `<button class="ticket-tab ${t.code === activeCode ? 'active' : ''}" data-code="${t.code}">
      Vé ${i + 1} · ${t.code}${kinh}
    </button>`;
  }).join('');
  box.querySelectorAll('.ticket-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCode = btn.dataset.code;
      renderTicketTabs();
      renderRows();
      syncWaitingFromRows();
    });
  });
}

/* ---------------- Đổi / Chốt vé ---------------- */
function applyLockState() {
  const t = activeTicket();
  const locked = !!(t && t.locked);
  $('btnChange').disabled = locked;
  $('btnLock').disabled = locked;
  $('btnChange').textContent = locked ? '🔒 Đã chốt' : '🔄 ĐỔI VÉ';
  $('btnLock').textContent = locked ? '✅ ĐÃ CHỐT' : '🔒 CHỐT VÉ';
  $('lockStatus').classList.toggle('hidden', !locked);
  if (locked && t) {
    $('lockedCode').textContent = myTickets.length > 1
      ? `${myTickets.length} vé đã chốt` : t.code;
  }
}
socket.on('ticket:changed', ({ code }) => {
  setStatus('Đã đổi vé mới. Hãy chốt vé nếu ưng ý!', true);
  showToast('Đã đổi vé mới. Hãy chốt vé nếu ưng ý!', 'info');
});
socket.on('ticket:locked', ({ codes }) => {
  myTickets.forEach((t) => { t.locked = true; });
  applyLockState();
  renderTicketTabs();
  setStatus('Đã chốt vé! Tên bạn hiện trên màn hình chính.', true);
  showToast('Đã chốt vé! Tên bạn hiện trên màn hình chính.', 'success');
});
socket.on('ticket:error', ({ message }) => {
  setStatus(message, false);
  showToast(message, 'error');
});

$('btnChange').addEventListener('click', () => {
  const t = activeTicket();
  if (!t) {
    showToast('Bạn chưa có vé để đổi!', 'error');
    return;
  }
  socket.emit('ticket:change', { playerId, code: t.code });
});
$('btnLock').addEventListener('click', () => {
  if (!myTickets.length) {
    showToast('Bạn chưa có vé để chốt!', 'error');
    return;
  }
  socket.emit('ticket:lock', { playerId });
});

/* ---------------- Báo "đợi 1 số" ---------------- */
socket.on('row:waiting', ({ row, missing }) => {
  showWaitingBanner(row, missing);
  navigator.vibrate && navigator.vibrate(80);
});
function syncWaitingFromRows() {
  const waits = currentRows().filter((r) => r.waiting);
  if (waits.length) showWaitingBanner(waits[waits.length - 1].index, waits[waits.length - 1].missing);
  else hideWaitingBanner();
}
function showWaitingBanner(row, missing) {
  $('waitRow').textContent = row;
  $('waitNum').textContent = pad(missing);
  $('waitingBanner').classList.remove('hidden');
}
function hideWaitingBanner() { $('waitingBanner').classList.add('hidden'); }

/* ---------------- Báo KINH ---------------- */
socket.on('kinh:notify', (info) => {
  myWinInfo = info; acked = false;
  if (info.winner && info.winner.code && myTickets.some((t) => t.code === info.winner.code)) {
    activeCode = info.winner.code;
    renderTicketTabs();
    renderRows();
  }
  const t = myTickets.find((x) => x.code === info.winner.code);
  if (t) t.won = true;
  showWin(info, true);
});

function showWin(info, celebrate) {
  const w = info.winner || {};
  const medal = ['🥇','🥈','🥉'][(w.position || 1) - 1] || '🎖️';
  $('winPos').textContent = `${medal} KINH HÀNG ${w.row} · kinh thứ ${w.position}`;
  if (info.totalWinners > 1) {
    $('winMoney').innerHTML = `Tiền thưởng (chia đều): <b>${fmt(info.prizePerWinner)}</b>`;
    $('winNote').textContent = `Tổng giải ${fmt(info.prize)} chia cho ${info.totalWinners} hàng kinh.`;
  } else {
    $('winMoney').innerHTML = `Tiền thưởng: <b>${fmt(info.prizePerWinner || info.prize)}</b>`;
    $('winNote').textContent = 'Bạn là người kinh đầu tiên! Chúc mừng! 🎉';
  }
  $('btnAck').disabled = false;
  $('btnAck').textContent = '📱 GỬI PHẢN HỒI VỀ MÀN HÌNH CHÍNH';
  $('winOverlay').classList.add('show');
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 1600);
  if (celebrate) navigator.vibrate && navigator.vibrate([200, 100, 200, 100, 400]);
}

$('btnAck').addEventListener('click', () => {
  if (acked) return;
  acked = true;
  socket.emit('player:ack', { playerId });
  $('btnAck').disabled = true;
  $('btnAck').textContent = '✅ Đã gửi phản hồi!';
  setTimeout(() => $('winOverlay').classList.remove('show'), 1200);
});

/* ---------------- Render vé ---------------- */
function matchedCount(rows) {
  let n = 0;
  rows.forEach((r) => (r.cells || []).forEach((c) => { if (c && c.matched) n++; }));
  return n;
}
function totalCount(rows) {
  let n = 0;
  rows.forEach((r) => (r.cells || []).forEach((c) => { if (c) n++; }));
  return n;
}
function renderRows() {
  const box = $('rowsGrid');
  const rows = currentRows();
  const t = activeTicket();
  $('ticketName').textContent = '👤 ' + (playerName || 'Người chơi');
  $('lotoSerial').textContent = t ? t.code : '';
  if (!rows.length) {
    box.innerHTML = '<div class="empty" style="color:#8a5a2b">Chưa có vé.</div>';
    return;
  }
  box.innerHTML = rows.map((r) => {
    let badge = '';
    if (r.complete) badge = `<span class="row-badge kinh">KINH ${r.kinhPosition ? '# ' + r.kinhPosition : ''} 🥇</span>`;
    else if (r.waiting) badge = `<span class="row-badge doi">ĐỢI SỐ ${pad(r.missing)} ⏳</span>`;
    const cells = (r.cells || []).map((c) => c
      ? `<div class="loto-cell ${c.matched ? 'matched' : ''} ${c.matched && c.value === pendingAnimatedNumber ? 'drop-in' : ''}">${pad(c.value)}</div>`
      : '<div class="loto-cell blank"></div>').join('');
    return `<div class="loto-row ${r.complete ? 'row-kinh' : ''}">
      <div class="row-label">Hàng ${r.index}</div>
      <div class="row-cells">${cells}</div>
      ${badge}
    </div>`;
  }).join('');
  const matched = matchedCount(rows);
  const total = totalCount(rows) || 1;
  $('progressText').textContent = `${matched} / ${total} số đã trúng`;
  $('progressBar').style.width = (matched / total * 100) + '%';
  pendingAnimatedNumber = null;
}

/* ---------------- Nhập tên lần đầu ---------------- */
function saveName() {
  const name = $('firstNameInput').value.trim();
  if (!name) {
    setStatus('Vui lòng nhập tên trước khi tham gia.', false);
    $('firstNameInput').focus();
    return;
  }
  playerName = name;
  $('joinNameModal').classList.add('hidden');
  document.querySelector('.player-app').classList.remove('hidden');
  localStorage.setItem('loto_player_name', name);
  socket.emit('player:rename', { playerId, name });
  $('ticketName').textContent = '👤 ' + name;
  if (!myTickets.length && !isPreview) {
    $('ticketSelection').classList.remove('hidden');
    setStatus('Tên đã lưu. Chọn số vé rồi bấm “Nhận vé”.', true);
  }
}
$('btnJoin').addEventListener('click', () => joinGame());
$('joinNameForm').addEventListener('submit', (event) => {
  event.preventDefault();
  saveName();
});

// Trong khung xem trước: đổi số vé muốn mua -> tạo lại bộ vé xem trước
$('ticketCount').addEventListener('change', () => {
  if (!isPreview) return;
  myWinInfo = null;
  acked = false;
  $('winOverlay').classList.remove('show');
  joinGame();
  setStatus(`Đã đổi thành ${$('ticketCount').value} vé xem trước.`, true);
});
