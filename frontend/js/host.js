/* ============================================================
   LÔ TÔ TẾT - Logic màn hình chính (Host)
   ============================================================ */
const socket = io();

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
// Cập nhật chữ nút mà KHÔNG xóa icon SVG bên trong.
function setBtnLabel(id, text) {
  const btn = $(id);
  if (!btn) return;
  const label = btn.querySelector('.btn-label');
  if (label) label.textContent = text;
  else btn.textContent = text;
}

let state = { drawn: [], winners: [], playerCount: 0, config: {}, history: [] };
let botEnabled = false;
let sfxEnabled = true;
const announcerStyles = window.LotoAnnouncer.styles;
let announcerStyleIndex = 0;
let rolling = false;
let configAutoCollapsed = false;

/* ---------------------- Thu gọn cài đặt ---------------------- */
function setConfigCollapsed(collapsed) {
  const panel = $('configPanel');
  const btn = $('btnToggleConfig');
  if (panel) panel.classList.toggle('collapsed', !!collapsed);
  if (btn) {
    const label = btn.querySelector('span');
    if (label) label.textContent = collapsed ? 'Mở rộng' : 'Thu gọn';
    btn.setAttribute('aria-expanded', String(!collapsed));
  }
}
function autoCollapseConfig() {
  if (configAutoCollapsed) return;
  const started = (state.playerCount || 0) > 0 || (state.drawn || []).length > 0;
  if (!started) return;
  configAutoCollapsed = true;
  setConfigCollapsed(true);
}

/* ---------------------- Cài đặt: auto-save + khóa trong ván ---------------------- */
const LOCKED_CONFIG_FIELDS = ['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'];
const CONFIG_INPUTS = {
  maxPlayers: 'cfgMaxPlayers',
  maxTicketsPerPlayer: 'cfgMaxPerPlayer',
  betPerTicket: 'cfgBet',
  maxWinners: 'cfgMaxWinners',
  rollSeconds: 'cfgRoll',
  autoRollSeconds: 'cfgAutoRoll',
};

// Ván bắt đầu khi đã xổ ít nhất 1 số hoặc đã có người chốt vé.
function isRoundStarted() {
  return (state.drawn || []).length > 0
    || !!(state.players || []).some((p) => p.locked)
    || !!state.maxWinnersReached;
}
function applyConfigLock() {
  const started = isRoundStarted();
  document.querySelectorAll('.field.lockable').forEach((field) => {
    const input = field.querySelector('input');
    const note = field.querySelector('.lock-note');
    const lock = field.querySelector('.field-lock');
    field.classList.toggle('is-locked', started && LOCKED_CONFIG_FIELDS.includes(field.dataset.field));
    if (input) input.disabled = started && LOCKED_CONFIG_FIELDS.includes(field.dataset.field);
    if (note) note.classList.toggle('hidden', !started);
    if (lock) lock.classList.toggle('hidden', !started);
  });
}
let savedTimer;
function flashSaved() {
  const el = $('configSaved');
  if (!el) return;
  el.textContent = '✓ Đã lưu';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { if (!el.classList.contains('show')) el.textContent = ''; }, 400);
  }, 2000);
}
function saveConfigField(key) {
  const input = $(CONFIG_INPUTS[key]);
  if (!input || input.disabled) return;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    toast('Giá trị không hợp lệ.');
    return;
  }
  // Ràng buộc nhịp quay: autoRoll >= roll + 1.
  if (key === 'rollSeconds') {
    const auto = Number($('cfgAutoRoll').value);
    if (Number.isFinite(auto) && auto < value + 3.5) {
      $('cfgAutoRoll').value = String(value + 3.5);
      toast('Quay tự động tự động chỉnh thành ' + (value + 3.5) + 's (lớn hơn thời gian quay 3.5s).');
    }
  } else if (key === 'autoRollSeconds') {
    const roll = Number($('cfgRoll').value);
    if (Number.isFinite(roll) && value < roll + 3.5) {
      input.value = String(roll + 3.5);
      toast('Quay tự động phải lớn hơn thời gian quay ít nhất 3.5 giây.');
      return;
    }
  }
  socket.emit('settings:update', { [key]: input.value });
  flashSaved();
}
Object.entries(CONFIG_INPUTS).forEach(([key, id]) => {
  const input = $(id);
  if (!input) return;
  input.addEventListener('blur', () => saveConfigField(key));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
  });
});

/* ---------------------- Toast ---------------------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------------------- Âm thanh (Web Audio, không cần file) ---------------------- */
let audioCtx;
function beep(type) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    if (type === 'tick') {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'triangle';
      o.frequency.value = 1100;
      g.gain.setValueAtTime(0.025, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      o.start(now); o.stop(now + 0.04);
    } else if (type === 'kinh') {
      [0, 0.14, 0.28].forEach((d, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = 'square';
        o.frequency.value = [523, 659, 784][i];
        g.gain.setValueAtTime(0.12, now + d);
        g.gain.exponentialRampToValueAtTime(0.001, now + d + 0.12);
        o.start(now + d); o.stop(now + d + 0.13);
      });
    } else {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(880, now);
      o.frequency.exponentialRampToValueAtTime(440, now + 0.15);
      g.gain.setValueAtTime(0.09, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      o.start(now); o.stop(now + 0.23);
    }
  } catch (e) { /* trình duyệt có thể chặn audio */ }
}

/* ---------------------- Render ---------------------- */
/* ---------------- Trạng thái quay (hình ảnh do TV preview render) ---------------- */
function startRoll() {
  stopRoll();
  rolling = true;
  $('btnDraw').disabled = true;
  setBtnLabel('btnDraw', 'ĐANG QUAY…');
}

function stopRoll() {
  rolling = false;
  $('btnDraw').disabled = false;
  setBtnLabel('btnDraw', 'XỔ SỐ NGAY');
}

function renderStats() {
  $('statPlayers').textContent = state.playerCount || 0;
  $('statMaxPlayers').textContent = state.maxPlayers || 200;
  $('statDrawn').textContent = (state.drawn || []).length;
  $('statWaiting').textContent = state.waitingCount || 0;
  $('statWinners').textContent = (state.winners || []).length;
  $('statPrize').textContent = fmt(state.prize);
  const canDraw = (state.playerCount || 0) > 0 && !state.maxWinnersReached;
  $('btnDraw').disabled = !canDraw || autoRunning;
  $('btnAuto').disabled = !canDraw && !autoRunning;
}

function renderWinners() {
  const box = $('winnerList');
  const note = $('moneyNote');
  const per = getPerWinner();
  note.textContent = state.winners && state.winners.length
    ? `(mỗi người ${fmt(per)})`
    : '';
  if (!state.winners || state.winners.length === 0) {
    box.innerHTML = '<div class="empty">Chưa có ai kinh. Xổ số để tìm người may mắn!</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const shown = state.winners.slice(-40).reverse();
  box.innerHTML = `
    <div class="history-item" style="color:#ffd9a0"><b>Tổng: ${state.winners.length} hàng kinh</b></div>` +
    shown.map((w) => {
      const medal = medals[w.position - 1] || '🎖️';
      const ack = w.acked ? '<span class="ack-dot">Đã phản hồi ✓</span>' : '<span style="color:#e8b98a;font-size:12px">Chờ phản hồi…</span>';
      return `<div class="winner-row">
        <div class="medal">${medal}</div>
        <div class="winner-info">
          <b>${escapeHtml(w.name)}</b> — Kinh hàng ${w.row} (thứ ${w.position})
          <small>${ack} · ${new Date(w.time).toLocaleTimeString('vi-VN')}</small>
        </div>
        <div class="winner-money">${fmt(per)}</div>
      </div>`;
    }).join('');
}

function getPerWinner() {
  const prize = Number(state.prize || 0);
  const n = (state.winners || []).length;
  return n ? Math.floor(prize / n) : prize;
}

function renderHistory() {
  const box = $('tabHistory');
  const h = state.history || [];
  if (!h.length) {
    box.innerHTML = '<div class="empty">Chưa có ván nào được lưu.</div>';
    return;
  }
  box.innerHTML = h.map((g) => `
    <div class="history-item">
      <div><b>Ván ${escapeHtml(g.id)}</b> · ${g.players || 0} người<br/>
        <small>${g.drawn ? g.drawn.length : 0} số · ${g.winners ? g.winners.length : 0} người kinh</small></div>
      <small>${new Date(g.endedAt || g.startedAt).toLocaleString('vi-VN')}</small>
    </div>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------------- Bot đọc số ---------------- */
function speakText(text, { rate = 0.95, pitch = 1.05 } = {}) {
  if (!botEnabled) return;
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    u.rate = rate;
    u.pitch = pitch;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}
function setBot(enabled) {
  botEnabled = enabled;
  const btn = $('btnBot');
  if (btn) setBtnLabel('btnBot', enabled ? 'Bot đọc số: Bật' : 'Bot đọc số: Tắt');
  // Server giữ nhịp tự xổ >= 2.5s để giọng đọc kịp phát.
  socket.emit('bot:state', { enabled: botEnabled });
}

function ticketCodesFor(player) {
  if (Array.isArray(player.codes) && player.codes.length) return player.codes;
  return player.code ? String(player.code).split(', ').filter(Boolean) : [];
}
const expandedPlayers = new Set();
let playerFilter = 'all';
let playerQuery = '';

function renderPlayers() {
  const box = $('playerList');
  const list = state.players || [];
  $('playerNote').textContent = `(${list.length} người)`;
  if (!box) return;

  const q = playerQuery.trim().toLocaleLowerCase('vi');
  const filtered = list.filter((p) => {
    const codes = ticketCodesFor(p);
    if (playerFilter === 'unlocked' && p.locked) return false;
    if (playerFilter === 'debt' && !(Number(p.debt) > 0)) return false;
    if (!q) return true;
    return String(p.name || '').toLocaleLowerCase('vi').includes(q)
      || codes.some((c) => String(c).toLocaleLowerCase('vi').includes(q));
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="empty">${list.length ? 'Không có người chơi phù hợp.' : 'Chưa có người chơi tham gia.'}</div>`;
    return;
  }

  box.innerHTML = filtered.map((p) => {
    const codes = ticketCodesFor(p);
    const pid = escapeHtml(p.playerId);
    const expanded = expandedPlayers.has(p.playerId);
    const locked = !!p.locked;
    const debt = Number(p.debt) || 0;
    const count = p.ticketCount || codes.length || 0;
    return `
    <div class="player-accordion ${expanded ? 'is-open' : ''}" data-player-id="${pid}">
      <div class="player-row" role="button" tabindex="0" aria-expanded="${expanded}">
        <svg class="icon player-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-badge ${locked ? 'badge-locked' : 'badge-unlocked'}">${locked ? 'Đã chốt' : 'Chưa chốt'}</span>
        <span class="player-tickets">${count} vé</span>
        ${debt > 0 ? `<span class="player-badge badge-debt">Nợ: ${fmt(debt)}</span>` : ''}
        <button class="mini-btn danger player-kick" data-action="kick" data-player-id="${pid}" type="button">Kick</button>
      </div>
      <div class="player-detail">
        <div class="admin-ticket-codes">
          ${codes.length
            ? codes.map((code) => `<span class="admin-ticket-code">${escapeHtml(code)}</span>`).join('')
            : `<span class="admin-ticket-code muted">${p.awaitingTicket ? 'Chưa nhận vé' : p.waitingNextRound ? 'Chờ ván sau' : 'Chưa có mã vé'}</span>`}
        </div>
        <div class="admin-player-finance">
          <div><span>Đã nạp</span><b class="editable-finance" data-player-id="${pid}" data-field="deposited" data-value="${Number(p.deposited) || 0}">${fmt(p.deposited || 0)}</b></div>
          <div><span>Tiền thưởng</span><b class="editable-finance" data-player-id="${pid}" data-field="winnings" data-value="${Number(p.winnings) || 0}">${fmt(p.winnings || 0)}</b></div>
          <div><span>Đang nợ</span><b class="editable-finance" data-player-id="${pid}" data-field="debt" data-value="${debt}">${fmt(debt)}</b></div>
        </div>
        <div class="player-detail-actions">
          <span class="player-total-won">Thành tích: <b>${fmt(Number(p.totalWon) || 0)}</b></span>
          <button class="mini-btn" data-action="pay-reward" data-player-id="${pid}" type="button">Trả thưởng</button>
          <button class="mini-btn" data-action="offset-debt" data-player-id="${pid}" type="button">Cấn nợ</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

let walletModalPlayerId = '';
let walletModalKind = '';
function openWalletModal(playerId, kind) {
  const player = (state.players || []).find((entry) => entry.playerId === playerId);
  if (!player) return;
  walletModalPlayerId = playerId;
  walletModalKind = kind;
  $('walletModalTitle').textContent = kind === 'loan' ? 'Cho vay' : 'Nạp tiền';
  $('walletModalPlayer').textContent = player.name;
  $('walletAmount').value = '';
  $('walletModalSubmit').textContent = kind === 'loan' ? 'Ghi nhận khoản vay' : 'Xác nhận nạp';
  $('walletModal').classList.add('show');
  $('walletAmount').focus();
}
function closeWalletModal() {
  $('walletModal').classList.remove('show');
  walletModalPlayerId = '';
  walletModalKind = '';
}

let editingFinance = null;
function startFinanceEdit(el) {
  if (editingFinance) return;
  editingFinance = el;
  const playerId = el.dataset.playerId;
  const field = el.dataset.field;
  const current = Number(el.dataset.value) || 0;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1000';
  input.value = String(current);
  input.className = 'finance-edit-input';
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  function finish(save) {
    if (done) return;
    done = true;
    editingFinance = null;
    if (save) {
      const amount = Math.floor(Number(input.value));
      if (Number.isFinite(amount) && amount >= 0) {
        socket.emit('admin:wallet-set', { playerId, field, amount });
      }
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); input.blur(); }
  });
  input.addEventListener('blur', () => finish(true));
}

$('playerList').addEventListener('click', (event) => {
  const editable = event.target.closest('.editable-finance');
  if (editable) { startFinanceEdit(editable); return; }
  const button = event.target.closest('button[data-action]');
  if (button) {
    const pid = button.dataset.playerId;
    if (button.dataset.action === 'kick' && confirm('Kick người chơi này khỏi ván hiện tại và xoá dữ liệu vé của họ?')) {
      socket.emit('admin:kick-player', { playerId: pid });
    } else if (button.dataset.action === 'pay-reward' && confirm('Trả toàn bộ tiền thưởng chưa trả cho người chơi này? (Thành tích giữ nguyên)')) {
      socket.emit('admin:pay-reward', { playerId: pid });
    } else if (button.dataset.action === 'offset-debt' && confirm('Dùng tiền thưởng chưa trả để cấn nợ? (Thành tích giữ nguyên)')) {
      socket.emit('admin:offset-debt', { playerId: pid });
    }
    return;
  }
  const row = event.target.closest('.player-row');
  if (!row) return;
  const item = row.closest('.player-accordion');
  const id = item && item.dataset.playerId;
  if (!id) return;
  if (expandedPlayers.has(id)) expandedPlayers.delete(id); else expandedPlayers.add(id);
  renderPlayers();
});

$('playerList').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.player-row');
  if (!row) return;
  event.preventDefault();
  row.click();
});

$('playerSearch')?.addEventListener('input', (event) => {
  playerQuery = event.target.value || '';
  renderPlayers();
});

document.querySelectorAll('.filter-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    playerFilter = tab.dataset.filter || 'all';
    document.querySelectorAll('.filter-tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderPlayers();
  });
});

$('walletModalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = Math.floor(Number($('walletAmount').value) || 0);
  if (!walletModalPlayerId || amount <= 0) return;
  socket.emit(walletModalKind === 'loan' ? 'admin:wallet-loan' : 'admin:wallet-deposit', {
    playerId: walletModalPlayerId, amount,
  });
  closeWalletModal();
});
$('btnCloseWalletModal').addEventListener('click', closeWalletModal);
$('walletModal').addEventListener('click', (event) => {
  if (event.target === $('walletModal')) closeWalletModal();
});

function renderAdminLeaderboard() {
  const box = $('adminLeaderboard');
  if (!box) return;
  // Server đã lọc totalWon > 0 và sắp giảm dần; vẫn lọc lại ở client cho chắc.
  const entries = (state.leaderboard || []).filter((e) => Number(e.totalWon ?? e.winnings) > 0);
  if (!entries.length) {
    box.innerHTML = '<div class="empty">Chưa có ai ghi nhận thành tích.</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  box.innerHTML = entries.map((e, i) => `
    <div class="admin-leader-row">
      <span>${medals[i] || '🏅'} ${escapeHtml(e.name)}</span>
      <b>${fmt(Number(e.totalWon ?? e.winnings))}</b>
    </div>`).join('');
}

function renderAll() {
  renderStats(); renderWinners(); renderHistory(); renderPlayers(); renderAdminLeaderboard();
}

/* ---------------------- Socket events ---------------------- */
$('btnResetAchievements')?.addEventListener('click', () => {
  if (!confirm('Reset toàn bộ THÀNH TÍCH (totalWon) về 0?\nTiền đã nạp, tiền thưởng chưa trả và tiền nợ vẫn giữ nguyên.')) return;
  socket.emit('admin:reset-achievements');
});

$('btnWipeAllData')?.addEventListener('click', () => {
  if (!confirm('⚠️ XÓA VĨNH VIỄN TOÀN BỘ DỮ LIỆU NGƯỜI CHƠI?\n\nSẽ xóa: ví tiền, danh sách người chơi, tất cả vé, lịch sử nạp/thưởng/nợ và thành tích.\nHành động này KHÔNG THỂ hoàn tác.')) return;
  socket.emit('admin:wipe-all-data');
});

socket.on('admin:achievements-reset', () => toast('Đã reset thành tích (giữ nguyên ví & nợ).'));
socket.on('admin:data-wiped', () => {
  toast('Đã xóa toàn bộ dữ liệu người chơi.');
  state = { drawn: [], winners: [], playerCount: 0, config: state.config || {}, history: [], leaderboard: [] };
  expandedPlayers.clear();
  renderAll();
});

const btnKickAll = $('btnKickAll');
if (btnKickAll) btnKickAll.addEventListener('click', () => {
  if (!confirm('Kick TẤT CẢ người chơi và xoá dữ liệu vé của họ?')) return;
  socket.emit('admin:kick-all');
});
if (btnBot) btnBot.addEventListener('click', () => setBot(!botEnabled));
const btnSfx = $('btnSfx');
if (btnSfx) btnSfx.addEventListener('click', () => {
  sfxEnabled = !sfxEnabled;
  setBtnLabel('btnSfx', sfxEnabled ? 'Âm thanh lồng cầu: Bật' : 'Âm thanh lồng cầu: Tắt');
  socket.emit('sfx:state', { enabled: sfxEnabled });
});
$('btnBotStyle').addEventListener('click', () => {
  announcerStyleIndex = (announcerStyleIndex + 1) % announcerStyles.length;
  setBtnLabel('btnBotStyle', `Kiểu đọc: ${announcerStyles[announcerStyleIndex].label}`);
  socket.emit('announcer:style', { index: announcerStyleIndex });
});

socket.on('player:waiting', ({ message }) => {
  toast(message || 'Bạn đang ở hàng chờ.');
});
socket.on('wallet:adjust', ({ amount, reason }) => {
  // host không dùng ví, bỏ qua
});
socket.on('near:kinh', ({ players }) => {
  const candidates = (players || []).filter((p) => p.name);
  if (candidates.length) {
    toast('Gần KINH: ' + candidates.map((p) => `${p.name} · hàng ${p.row}`).join(', '));
    speakText('Sắp KINH: ' + candidates.map((p) => `${p.name}, hàng ${p.row}`).join('. '));
  }
});

socket.on('connect', () => {
  $('adminLoginError').textContent = '';
});
socket.on('admin:authenticated', () => {
  $('adminLogin').classList.add('hidden');
  document.querySelector('.app').classList.remove('hidden');
  $('adminPassword').value = '';
  socket.emit('host:register');
  socket.emit('bot:state', { enabled: botEnabled });
  socket.emit('sfx:state', { enabled: sfxEnabled });
});
socket.on('admin:login-failed', ({ message }) => {
  $('adminLoginError').textContent = message || 'Đăng nhập thất bại.';
});
socket.on('admin:required', () => {
  $('adminLogin').classList.remove('hidden');
  document.querySelector('.app').classList.add('hidden');
});
$('adminLoginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('admin:login', { password: $('adminPassword').value });
});
socket.on('disconnect', () => {
  $('adminLogin').classList.remove('hidden');
  document.querySelector('.app').classList.add('hidden');
});
socket.on('host:state', (s) => {
  state = s;
  if (state.config) {
    $('cfgMaxPlayers').value = state.config.maxPlayers;
    $('cfgMaxPerPlayer').value = state.config.maxTicketsPerPlayer || 3;
    $('cfgRoll').value = state.config.rollSeconds || 4.5;
    $('cfgAutoRoll').value = state.config.autoRollSeconds || 9;
    $('cfgBet').value = state.config.betPerTicket;
    $('cfgMaxWinners').value = state.config.maxWinners || 0;
  }
  applyConfigLock();
  $('cfgPrize').textContent = fmt(state.prize);
  setBtnLabel('btnRules', state.rulesVisible ? 'Tắt luật chơi TV' : 'Bật luật chơi TV');
  setBtnLabel('btnLeaderboard', state.leaderboardVisible
    ? 'Ẩn bảng xếp hạng TV'
    : 'Hiện bảng xếp hạng TV');
  if (typeof state.sfxEnabled === 'boolean') sfxEnabled = state.sfxEnabled;
  setBtnLabel('btnSfx', sfxEnabled ? 'Âm thanh lồng cầu: Bật' : 'Âm thanh lồng cầu: Tắt');
  autoCollapseConfig(); // ván đã bắt đầu -> thu gọn ô cài đặt cho thoáng
  renderAll();
});

socket.on('draw:rolling', ({ duration, min, max }) => {
  startRoll(duration, min, max);
});

socket.on('draw:cancel', () => {
  stopRoll();
});

socket.on('draw:result', ({ number }) => {
  const announcement = window.LotoAnnouncer.announcement(number, announcerStyleIndex);
  // TV vừa tắt hẳn tiếng gió/va đập tại khoảnh khắc bi được hút lên ống;
  // chờ fade-out đó xong rồi mới để Bot đọc số để giọng luôn rõ.
  setTimeout(() => speakText(announcement.text, announcement), 180);
  stopRoll();
  beep('draw');
});

socket.on('draw:error', ({ message }) => {
  toast(message);
});
socket.on('settings:error', ({ message }) => toast(message));

socket.on('host:kinh', ({ winners, latest }) => {
  state.winners = winners;
  renderWinners(); renderStats();
  latest.forEach((w) => {
    toast(`🎉 ${w.name} KINH hàng ${w.row} (thứ ${w.position})!`);
  });
  beep('kinh');
});

socket.on('host:players', ({ players }) => {
  state.players = players;
  renderPlayers();
  renderStats();
});

let kinhBannerTimer;
function showKinhBanner(message) {
  const box = $('kinhBanner');
  if (!box) { toast(message); return; }
  box.textContent = message;
  box.classList.remove('hidden');
  box.classList.add('show');
  clearTimeout(kinhBannerTimer);
  kinhBannerTimer = setTimeout(() => hideKinhBanner(), 6000);
}
function hideKinhBanner() {
  const box = $('kinhBanner');
  if (!box) return;
  box.classList.remove('show');
  box.classList.add('hidden');
}

// Chưa đủ người Kinh: banner phụ, tự xổ VẪN chạy tiếp.
socket.on('kinh:progress', ({ message }) => {
  if (message) showKinhBanner(message);
});
socket.on('kinh:clear', () => {
  hideKinhBanner();
  closeResult();
});

socket.on('host:ack', ({ name }) => {
  toast(`📱 ${name} đã phản hồi từ điện thoại!`);
});

socket.on('game:reset', (payload) => {
  hideKinhBanner();
  configAutoCollapsed = false;
  applyConfigLock();
  toast(payload && payload.saved
    ? '🔄 Đã lưu ván trước đó và bắt đầu ván mới!'
    : '🔄 Đã bắt đầu ván mới!');
});

socket.on('game:finished', () => {
  toast('🏁 Đã kết thúc và lưu ván vào lịch sử!');
});
socket.on('game:limit-reached', ({ maxWinners, winnerCount }) => {
  toast(`🏆 Đã đủ ${winnerCount || maxWinners}/${maxWinners} người KINH — tiền thưởng đã chia đều.`);
});
socket.on('admin:next-round-done', ({ saved }) => {
  if (!saved) toast('⚠️ Ván chưa đủ KINH đã được hủy để bắt đầu ván mới.');
});

/* ---------------------- Điều khiển ---------------------- */
$('btnDraw').addEventListener('click', () => {
  socket.emit('draw:request', {});
});

// Một nút duy nhất thay cho "Ván mới" / "Lưu & Bắt đầu" / "Kết thúc & Lưu".
function nextRound() {
  closeResult();
  const limit = Number(state.config && state.config.maxWinners) || 0;
  const wins = (state.winners || []).length;
  const complete = !!state.maxWinnersReached || (limit > 0 ? wins >= limit : wins > 0);
  if (!complete && !confirm('Ván hiện tại chưa đủ người Kinh. Bạn có chắc muốn hủy ván này và bắt đầu ván mới?')) return;
  socket.emit('admin:next-round');
}
$('btnNextRoundMain')?.addEventListener('click', nextRound);
$('btnNextRound')?.addEventListener('click', nextRound);

$('btnToggleConfig')?.addEventListener('click', () => {
  const collapsed = !$('configPanel').classList.contains('collapsed');
  setConfigCollapsed(collapsed);
});
$('btnRules').addEventListener('click', () => socket.emit('tv:rules', { visible: !state.rulesVisible }));
$('btnLeaderboard').addEventListener('click', () =>
  socket.emit('tv:leaderboard', { visible: !state.leaderboardVisible }));

/* ---------------------- Tự xổ đến khi có KINH ---------------------- */
let autoRunning = false;
function setAutoUI(running) {
  autoRunning = !!running;
  setBtnLabel('btnAuto', running ? 'DỪNG TỰ XỔ' : 'TỰ XỔ ĐẾN KHI CÓ KINH');
  $('btnAuto').classList.toggle('btn-danger', !!running);
  $('btnDraw').disabled = !!running || !(state.playerCount || 0) || !!state.maxWinnersReached;
  $('btnAuto').disabled = !(state.playerCount || 0) && !running || !!state.maxWinnersReached;
}
$('btnAuto').addEventListener('click', () => {
  socket.emit(autoRunning ? 'auto:stop' : 'auto:start');
});

function closeResult() { $('resultModal').classList.remove('show'); }
$('btnCloseResult').addEventListener('click', closeResult);
$('resultModal').addEventListener('click', (e) => {
  if (e.target === $('resultModal')) closeResult();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeResult(); closePreview(); }
});
socket.on('auto:state', ({ running }) => {
  setAutoUI(running);
});

socket.on('auto:stopped', (data) => {
  setAutoUI(false);
  const { pool, per, winnerCount, winners, players, cancelled, exhausted } = data;
  $('resultTitle').textContent = cancelled ? '⏹ ĐÃ DỪNG TỰ XỔ' : '🎉 CÓ NGƯỜI KINH!';
  $('resultMeta').innerHTML = `Tổng giải: <b>${fmt(pool)}</b> · ${winnerCount} hàng kinh · mỗi kinh <b>${fmt(per)}</b>` +
    (exhausted ? ' · Đã hết số!' : '');
  const medal = ['🥇','🥈','🥉'];
  if (!players.length) {
    $('resultList').innerHTML = '<div class="empty">Chưa có người chơi nào.</div>';
  } else {
    $('resultList').innerHTML = players.map((p) => {
      const won = p.net > 0;
      const pos = winners.find((w) => w.playerId === p.playerId);
      const tag = pos ? `${medal[(pos.position || 1) - 1] || '🎖️'} Kinh hàng ${pos.row}` : 'Không kinh';
      const netText = (won ? '+' : '') + fmt(p.net);
      return `<div class="result-row ${won ? 'win' : ''}">
        <div class="r-name"><b>${escapeHtml(p.name)}</b> · ${p.tickets} vé · cược ${fmt(p.bet)}
          <small>${tag} · thưởng ${fmt(p.win)}</small></div>
        <div class="r-net ${won ? 'plus' : 'minus'}">${netText}</div>
      </div>`;
    }).join('');
  }
  $('resultModal').classList.add('show');
  if (!cancelled) {
    toast(`🎉 ${winnerCount} hàng kinh! Tổng giải ${fmt(pool)}`);
    beep('kinh');
  }
});

/* ---------------------- Xem trước điện thoại ---------------------- */
function closePreview() {
  $('previewModal').classList.remove('show');
  $('previewFrame').src = 'about:blank';   // ngắt socket của vé xem trước
}
$('btnPreview').addEventListener('click', () => {
  $('previewFrame').src = '/play.html?preview=1';
  $('previewModal').classList.add('show');
});
$('btnClosePreview').addEventListener('click', closePreview);
$('previewModal').addEventListener('click', (e) => {
  if (e.target === $('previewModal')) closePreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePreview();
});
