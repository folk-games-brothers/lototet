/* ============================================================
   LÔ TÔ TẾT - Bot Con Dê Lửa "Đinh Mùi 2027"
   Nhân vật MC linh vật trên màn hình TV: biết cử động, hát hò vè và
   đọc thoại tiếng Việt (Web Speech API vi-VN).
   ============================================================ */
(function exposeMascot(root) {
  'use strict';

  const EMPTY_LINES = [
    'Buồn quá đi, chưa có người tham gia hết trơn...',
    'Dê lửa chờ nãy giờ mà chưa thấy ai vô chơi lô tô hết...',
    'Phòng còn trống trơn, ai vô chơi cùng dê lửa với!',
  ];
  const FEW_LINES = [
    'Ít người chơi quá, chán quá đi...',
    'Có mấy người à, rủ thêm bạn vô cho xôm tụ nào!',
    'Dê lửa hát mà phòng vắng hoe, buồn muốn khóc luôn.',
  ];
  const SING_LINES = [
    'Lô tô quay đều, con gì ra đây...',
    'Lắc đều lắc đều, chuẩn bị dò vé nào...',
    'Đinh Mùi rực lửa, con số may mắn sắp ra...',
    'Bà con ơi dò kỹ vé, Kinh lớn đang chờ...',
  ];
  const WELCOME = (name) => `Chào mừng ${name} vừa tham gia phòng nha!`;
  const NEAR = (name) => `Hồi hộp quá, ${name} đang đợi gần Kinh rồi kìa!`;
  const KINH = (name, code) => `Chúc mừng ${name} đã Kinh vé ${code}! Năm mới phát tài quá xuất sắc!`;
  const NUMBER = (n, styleVè) => styleVè
    ? `Chốt số ${n}! Lộc xuân phát tài, số đẹp quá chừng!`
    : `Chốt số ${n}!`;

  const PRIORITY = { HIGH: 1, MID: 2, LOW: 3 };

  const mascot = {
    root: null,
    bubble: null,
    textEl: null,
    state: 'normal',
    queue: [],
    current: null,
    isSpeaking: false,
    botEnabled: false,
    announcerStyle: 0,
    playerCount: 0,
    knownPlayers: new Set(),
    nearNotified: new Set(),
    kinhNotified: new Set(),
    emptyTimer: null,
    fewTimer: null,
    fallbackTimers: [],
  };

  function $(id) { return (root.document || document).getElementById(id); }

  function setState(state) {
    mascot.state = state;
    const rootEl = mascot.root;
    if (!rootEl) return;
    rootEl.classList.remove('state-sad', 'state-normal', 'state-singing', 'state-excited');
    rootEl.classList.add('state-' + state);
  }

  function setBubble(text) {
    if (mascot.textEl) mascot.textEl.textContent = text;
    if (mascot.bubble) mascot.bubble.classList.add('show');
  }

  function clearBubble() {
    if (mascot.bubble) mascot.bubble.classList.remove('show');
  }

  function lipSync(on) {
    if (mascot.root) mascot.root.classList.toggle('is-speaking', !!on);
  }

  function speakNow(text, priority, onEnd) {
    mascot.isSpeaking = true;
    setBubble(text);
    lipSync(true);
    const finish = () => {
      lipSync(false);
      mascot.isSpeaking = false;
      mascot.current = null;
      if (typeof onEnd === 'function') onEnd();
      processQueue();
    };
    if (mascot.botEnabled && 'speechSynthesis' in root) {
      try { root.speechSynthesis.cancel(); } catch (e) {}
      const u = new root.SpeechSynthesisUtterance(text);
      u.lang = 'vi-VN';
      u.rate = 0.95;
      u.pitch = 1.05;
      u.onend = finish;
      u.onerror = finish;
      mascot.current = u;
      root.speechSynthesis.speak(u);
    } else {
      // Bot tắt: vẫn hiện chữ, thời lượng theo số ký tự.
      clearFallbacks();
      const ms = Math.max(900, text.length * 58);
      mascot.fallbackTimers.push(setTimeout(finish, ms));
    }
  }

  function processQueue() {
    if (mascot.isSpeaking || !mascot.queue.length) return;
    const item = mascot.queue.shift();
    speakNow(item.text, item.priority, item.onEnd);
  }

  function enqueue(text, priority, onEnd) {
    if (priority === PRIORITY.HIGH) {
      // Mức 1: ngắt ngay câu đang nói dở.
      if (mascot.current && 'speechSynthesis' in root) {
        try { root.speechSynthesis.cancel(); } catch (e) {}
      }
      mascot.queue = mascot.queue.filter((q) => q.priority !== PRIORITY.HIGH);
      speakNow(text, priority, onEnd);
      return;
    }
    mascot.queue.push({ text, priority, onEnd });
    mascot.queue.sort((a, b) => a.priority - b.priority);
    processQueue();
  }

  function idleSadLoop() {
    if (mascot.emptyTimer) clearInterval(mascot.emptyTimer);
    if (mascot.fewTimer) clearInterval(mascot.fewTimer);
    const lines = mascot.playerCount === 0 ? EMPTY_LINES : FEW_LINES;
    const isSadRange = mascot.playerCount === 0 || (mascot.playerCount >= 1 && mascot.playerCount <= 3);
    if (!isSadRange) return;
    setState('sad');
    const timer = setInterval(() => {
      if (mascot.isSpeaking || mascot.queue.length) return;
      if (mascot.playerCount === 0 || (mascot.playerCount >= 1 && mascot.playerCount <= 3)) {
        enqueue(lines[Math.floor(Math.random() * lines.length)], PRIORITY.LOW, null);
      }
    }, 25000);
    if (mascot.playerCount === 0) mascot.emptyTimer = timer;
    else mascot.fewTimer = timer;
  }

  function updatePlayerCount(count) {
    const prev = mascot.playerCount;
    mascot.playerCount = count;
    if (count === 0 || (count >= 1 && count <= 3)) {
      setState('sad');
      idleSadLoop();
    } else {
      if (mascot.emptyTimer) { clearInterval(mascot.emptyTimer); mascot.emptyTimer = null; }
      if (mascot.fewTimer) { clearInterval(mascot.fewTimer); mascot.fewTimer = null; }
      if (mascot.state === 'sad') setState('normal');
    }
  }

  function detectNewPlayers(participants) {
    const names = (participants || []).map((p) => p.name).filter(Boolean);
    const newNames = names.filter((n) => !mascot.knownPlayers.has(n));
    newNames.forEach((n) => mascot.knownPlayers.add(n));
    if (newNames.length) {
      setState('normal');
      const joined = newNames.slice(0, 3).join(', ');
      const suffix = newNames.length > 3 ? ` và ${newNames.length - 3} bạn khác` : '';
      enqueue(WELCOME(joined + suffix), PRIORITY.MID, null);
    }
  }

  function onDrawStart(durationMs, openGate) {
    clearFallbacks();
    setState('singing');
    if (root.LotoAudio && typeof root.LotoAudio.setDuck === 'function') root.LotoAudio.setDuck(true);
    const vè = SING_LINES[Math.floor(Math.random() * SING_LINES.length)];
    setBubble(vè);
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      if (root.LotoAudio && typeof root.LotoAudio.setDuck === 'function') root.LotoAudio.setDuck(false);
      if (typeof openGate === 'function') openGate();
    };
    const ms = Math.max(600, (durationMs || 3000) + 1500);
    const fallback = setTimeout(() => {
      if (!mascot.isSpeaking) return;
      try { if ('speechSynthesis' in root) root.speechSynthesis.cancel(); } catch (e) {}
      open();
    }, ms);
    mascot.fallbackTimers.push(fallback);
    enqueue(vè, PRIORITY.HIGH, () => { clearTimeout(fallback); open(); });
  }

  function onNumberRevealed(number) {
    setState('excited');
    const text = NUMBER(number, mascot.announcerStyle > 0);
    enqueue(text, PRIORITY.HIGH, () => { setState('normal'); });
  }

  function onNearKinh(players) {
    (players || []).forEach((p) => {
      if (!p || !p.name) return;
      const key = `${p.name}:${p.ticketCode || p.code || ''}`;
      if (mascot.nearNotified.has(key)) return;
      mascot.nearNotified.add(key);
      setState('excited');
      enqueue(NEAR(p.name), PRIORITY.MID, () => { if (mascot.state === 'excited') setState('normal'); });
    });
  }

  function onKinh(winners) {
    (winners || []).forEach((w) => {
      const key = `${w.name}:${w.code}`;
      if (mascot.kinhNotified.has(key)) return;
      mascot.kinhNotified.add(key);
      setState('excited');
      enqueue(KINH(w.name, w.code), PRIORITY.HIGH, null);
    });
  }

  function onGameReset() {
    mascot.nearNotified.clear();
    mascot.kinhNotified.clear();
    mascot.knownPlayers.clear();
    mascot.queue = [];
    if ('speechSynthesis' in root) { try { root.speechSynthesis.cancel(); } catch (e) {} }
    clearFallbacks();
    if (mascot.emptyTimer) { clearInterval(mascot.emptyTimer); mascot.emptyTimer = null; }
    if (mascot.fewTimer) { clearInterval(mascot.fewTimer); mascot.fewTimer = null; }
    mascot.isSpeaking = false;
    lipSync(false);
    clearBubble();
    setState('normal');
    updatePlayerCount(mascot.playerCount);
  }

  function clearFallbacks() {
    mascot.fallbackTimers.forEach((t) => clearTimeout(t));
    mascot.fallbackTimers = [];
  }

  function init() {
    mascot.root = $('tvMascot');
    mascot.bubble = $('mascotBubble');
    mascot.textEl = $('mascotText');
    if (!mascot.root) return;
    setState('normal');
    // Đồng bộ trạng thái Bot đọc số từ server.
    // (được cập nhật qua applyState trong tv.js)
  }

  function applyState(s) {
    if (!s) return;
    mascot.botEnabled = !!(s.botEnabled);
    mascot.announcerStyle = Number(s.announcerStyle) || 0;
    const participants = s.participants || s.players || [];
    detectNewPlayers(participants);
    updatePlayerCount(participants.length);
  }

  root.LotoMascot = {
    init, applyState, setState, enqueue,
    onDrawStart, onNumberRevealed, onNearKinh, onKinh, onGameReset,
    setBotEnabled: (v) => { mascot.botEnabled = !!v; },
  };

  // Tự khởi tạo khi DOM sẵn sàng.
  function ready() { init(); }
  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', ready);
  } else if (root.document) {
    ready();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = root.LotoMascot;
})(typeof window !== 'undefined' ? window : globalThis);
