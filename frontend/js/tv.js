/* ============================================================
   MÀN HÌNH TV - lồng cầu vật lý thật (Matter.js) + kết quả realtime
   ============================================================ */
const socket = io();
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const pad = (n) => String(n).padStart(2, '0');
// Bộ hiệu ứng âm thanh tổng hợp bằng Web Audio API (xem js/audio.js).
const LotoAudio = window.LotoAudio || {
  startFan() {}, stopFan() {}, startClacks() {}, stopClacks() {}, stopTumble() {},
  startPipeRoll() {}, stopPipeRoll() {}, trayDrop() {}, revealTing() {},
  stopAll() {}, unlock() {}, setEnabled() { return false; }, isEnabled() { return false; }, setDuck() {},
};

let stateLoaded = false;
let lastConfig = null;
// Tránh re-render khi state không đổi (TV nhận tv:state khá thường xuyên).
const tvRenderCache = Object.create(null);

/* ============================================================
   MÔ PHỎNG VẬT LÝ LỒNG CẦU (RIGID-BODY PHYSICS)
   ============================================================ */
const Physics = (() => {
  const { Engine, Bodies, Body, Composite, Events, Sleeping } = window.Matter || {};
  const canvas = $('tvPhysics');
  const ctx = canvas ? canvas.getContext('2d') : null;

  const WORLD_W = 1000;
  const WORLD_H = 560;
  const BALL_R = 10;

  // Sprite đệm: tạo 1 lần rỗi mỗi lần vẽ gradient cho 90 bóng.
  const SPRITE_SCALE = 2;
  const SPRITE_SIZE = (BALL_R + 2) * 2;
  let ballBodySprite = null;
  const ballNumberSprites = new Map();
  function makeSprite() {
    if (!document || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = SPRITE_SIZE * SPRITE_SCALE;
    c.height = SPRITE_SIZE * SPRITE_SCALE;
    const cx = c.getContext('2d');
    cx.scale(SPRITE_SCALE, SPRITE_SCALE);
    return { canvas: c, ctx: cx };
  }
  function ensureBallSprites() {
    if (ballBodySprite) return ballBodySprite;
    const body = makeSprite();
    if (!body) return null;
    const c = SPRITE_SIZE / 2;
    const g = body.ctx.createRadialGradient(c - 3, c - 4, 1, c, c, BALL_R);
    g.addColorStop(0, '#fffde8');
    g.addColorStop(0.62, '#ffe08b');
    g.addColorStop(1, '#c98122');
    body.ctx.beginPath();
    body.ctx.arc(c, c, BALL_R, 0, Math.PI * 2);
    body.ctx.fillStyle = g;
    body.ctx.fill();
    body.ctx.lineWidth = 1;
    body.ctx.strokeStyle = 'rgba(255,255,255,.9)';
    body.ctx.stroke();
    ballBodySprite = body.canvas;
    return ballBodySprite;
  }
  function ensureNumberSprite(number) {
    if (ballNumberSprites.has(number)) return ballNumberSprites.get(number);
    const sprite = makeSprite();
    if (!sprite) return null;
    const c = SPRITE_SIZE / 2;
    sprite.ctx.fillStyle = '#8a1518';
    sprite.ctx.font = '800 10px "Baloo 2", sans-serif';
    sprite.ctx.textAlign = 'center';
    sprite.ctx.textBaseline = 'middle';
    sprite.ctx.fillText(pad(Number(number)), c, c + 0.5);
    ballNumberSprites.set(number, sprite.canvas);
    return sprite.canvas;
  }

  // Bệ đỡ dùng chung: mặt trên của bệ là đường nền cho cả lồng lẫn 5 cột.
  const BASE_TOP = 470;
  const BASE_BOTTOM = 540;
  const CAGE = { x: 190, y: BASE_TOP - 150, r: 150 };   // đáy cầu = BASE_TOP
  const CAGE_GAP = BALL_R * 2.2;                        // khe đỉnh lồng
  const TUBE_GAP = BALL_R * 2.6;                        // lòng ống = 1.3 * đường kính bi (26px)
  const WALL_T = 9;
  const GATE_CLOSED = { x: CAGE.x, y: CAGE.y - CAGE.r + 1 };
  const GATE_OPEN = { x: CAGE.x, y: -200 };
  const SENSOR_AT = { x: CAGE.x, y: CAGE.y - CAGE.r - 12 };

  // ỐNG LÊN ĐỈNH + ĐƯỜNG RAY NGANG: ray chạy qua tâm từng cột, có cửa thả.
  const TUBE = [
    [190, 168], [196, 140], [214, 120], [240, 112], [270, 116],
    [300, 132], [330, 154], [360, 180], [388, 198], [408, 210],
    [420, 210], // đầu ray = mép trái cột 01, ống nối mượt vào đây
  ];
  const CHUTE_END = { x: TUBE[TUBE.length - 1][0], y: TUBE[TUBE.length - 1][1] };
  const RAIL_Y = 210;
  const RAIL_HALF = TUBE_GAP / 2 + WALL_T / 2;

  // 5 cột kết quả (mặc định), mỗi cột 9 bi; tự mở thêm tới 10.
  const SLOTS = { minCount: 5, maxCount: 10, perSlot: 9, x: 410, y: BASE_TOP - 220 - 27, w: 52, cell: 22, gap: 6 };
  // Ray khớp KHÍT: trái = mép trái cột 01, phải = mép phải cột cuối.
  const RAIL_LEFT = SLOTS.x;
  const RAIL_RIGHT = (count) => SLOTS.x + count * (SLOTS.w + SLOTS.gap) - SLOTS.gap;
  const SLOT_BODY_TOP = SLOTS.y + 27;
  const SLOT_BODY_H = SLOTS.perSlot * SLOTS.cell + 22;   // 220 -> đáy = BASE_TOP

  // Quạt nằm GỌN TRONG BỆ, thổi thẳng lên qua cổ dẫn + lưới ở đáy lồng.
  const FAN = { x: CAGE.x, y: (BASE_TOP + BASE_BOTTOM) / 2 + 6, w: 58, h: 30 };
  // Thời lượng chuyển động bám theo "Thời gian quay" gửi từ server.
  let ROLL_MS = 2600; // đủ chậm để thấy bi lăn qua ống, ray rồi rơi vào cột

  let engine = null;
  let timer = null;
  let gate = null;
  let walls = [];
  let rangeKey = '';
  let balls = new Map();
  let slotBalls = Array.from({ length: SLOTS.minCount }, () => []);
  let slotCount = SLOTS.minCount;
  let rollingBall = null;         // { ball, number, slot, t }
  let settleUntil = 0;            // chạy thêm vài trăm ms để bi dừng hẳn rồi mới tạm dừng
  let fanAngle = 0;
  let airUntil = 0;
  let gateOpenAt = 0;
  let rolling = false;
  let resultSent = false;
  let currentGameId = '';
  let dpr = 1, scale = 1, offX = 0, offY = 0;

  function resize() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    offX = (rect.width - WORLD_W * scale) / 2;
    offY = (rect.height - WORLD_H * scale) / 2;
  }

  /* ---------------- Sinh 90 số + xáo trộn Fisher-Yates ---------------- */
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Sinh dữ liệu BẰNG CODE: mảng DUY NHẤT "01".."90", rồi mới shuffle Fisher-Yates.
  // Không dùng Math.random() riêng cho từng viên (tránh trùng số như 09/15 do
  // text bị xoay ngẫu nhiên).
  function generateNumbers(min, max, drawn) {
    const nums = [];
    for (let n = min; n <= max; n++) nums.push(pad(n));   // "01".."90"
    const unique = [...new Set(nums)];                    // dedupe by code
    return shuffled(unique)                               // Fisher-Yates
      .map(Number)
      .filter((n) => !(drawn || []).includes(n));
  }

  function makeBall(number, x, y) {
    return Bodies.circle(x, y, BALL_R, {
      label: 'ball', restitution: 0.85, friction: 0.002,
      frictionStatic: 0.004, frictionAir: 0.004, density: 0.001,
      plugin: { number, catchable: false },
    });
  }

  function addBalls(min, max, drawn) {
    const numbers = generateNumbers(min, max, drawn);
    // Vị trí vòng xoắn, rồi XÁO TRỘN vị trí để bi không xếp hàng tuần tự.
    const positions = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    numbers.forEach((n, i) => {
      const t = i / Math.max(1, numbers.length - 1);
      const yv = 1 - t * 2;
      const rad = Math.sqrt(Math.max(0, 1 - yv * yv));
      const theta = golden * i;
      positions.push({
        x: CAGE.x + Math.cos(theta) * rad * (CAGE.r - BALL_R - 16),
        y: CAGE.y + yv * (CAGE.r - BALL_R - 16),
      });
    });
    const spots = shuffled(positions);
    // Góc xoay 0..360 lấy từ MỘT pool đã shuffle (Fisher-Yates), không phải
    // Math.random() gọi riêng cho từng viên — tránh lặp số do text bị xoay.
    const angles = shuffled(numbers.map((_, i) => (i * 360 / Math.max(1, numbers.length))));
    numbers.forEach((n, i) => {
      const ball = makeBall(n, spots[i].x, spots[i].y);
      Body.setAngle(ball, angles[i] * Math.PI / 180);
      balls.set(n, ball);
      Composite.add(engine.world, ball);
    });
  }

  function clearBalls() {
    balls.forEach((body) => Composite.remove(engine.world, body));
    balls.clear();
  }

  /* ---------------- Tường vật lý ---------------- */
  function makeCageWalls() {
    const list = [];
    const halfGapAngle = Math.asin((CAGE_GAP / 2) / CAGE.r);
    const segments = 28; // đủ khít, giảm hơn 4 lần số body so với 120 đoạn
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      let diff = Math.abs(mid - Math.PI * 1.5);
      diff = Math.min(diff, Math.PI * 2 - diff);
      if (diff < halfGapAngle) continue;
      const p0 = { x: CAGE.x + Math.cos(a0) * CAGE.r, y: CAGE.y + Math.sin(a0) * CAGE.r };
      const p1 = { x: CAGE.x + Math.cos(a1) * CAGE.r, y: CAGE.y + Math.sin(a1) * CAGE.r };
      list.push(Bodies.rectangle((p0.x + p1.x) / 2, (p0.y + p1.y) / 2,
        Math.hypot(p1.x - p0.x, p1.y - p0.y) + 3, WALL_T, {
          isStatic: true, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
          friction: 0.02, restitution: 0.85, label: 'cage-wall',
        }));
    }
    // Lưới chắn đáy lồng: bi không rơi xuống buồng quạt (khe < đường kính bi).
    list.push(Bodies.rectangle(CAGE.x, CAGE.y + CAGE.r - 2, CAGE.r * 1.6, 6, {
      isStatic: true, friction: 0.02, restitution: 0.3, label: 'bottom-grille',
    }));
    return list;
  }

  function makeTubeWalls() {
    const list = [];
    const offset = TUBE_GAP / 2 + WALL_T / 2;
    for (let i = 0; i < TUBE.length - 1; i++) {
      const [x0, y0] = TUBE[i];
      const [x1, y1] = TUBE[i + 1];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const nx = -dy / len, ny = dx / len;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (const sign of [-1, 1]) {
        list.push(Bodies.rectangle(cx + nx * offset * sign, cy + ny * offset * sign,
          len + 3, WALL_T, {
            isStatic: true, angle: Math.atan2(dy, dx),
            friction: 0.01, restitution: 0.7, label: 'tube-wall',
          }));
      }
    }
    // Đường ray ngang phủ qua cả 10 cột (dùng maxCount để khỏi tạo lại).
    const railLeft = RAIL_LEFT;
    const railRight = RAIL_RIGHT(SLOTS.maxCount);
    for (const sign of [-1, 1]) {
      list.push(Bodies.rectangle((railLeft + railRight) / 2, RAIL_Y + RAIL_HALF * sign,
        railRight - railLeft, WALL_T, {
          isStatic: true, friction: 0.01, restitution: 0.5, label: 'rail-wall',
        }));
    }
    return list;
  }

  /* ---------------- Ngăn kết quả ---------------- */
  function countFor(n) {
    return Math.max(SLOTS.minCount, Math.min(SLOTS.maxCount, Math.ceil(Number(n || 0) / SLOTS.perSlot)));
  }
  function emptySlots(count) { return Array.from({ length: count }, () => []); }
  function slotsFromDrawn(drawn) {
    const list = Array.isArray(drawn) ? drawn : [];
    slotCount = countFor(list.length);
    const slots = emptySlots(slotCount);
    list.slice(0, slotCount * SLOTS.perSlot).forEach((n, i) => {
      slots[Math.floor(i / SLOTS.perSlot)].push(Number(n));
    });
    return slots;
  }
  function syncSlots(drawn) {
    if (rollingBall) return; // đang thả bi, đợi xong rồi đồng bộ
    const want = slotsFromDrawn(drawn);
    if (want.length !== slotBalls.length || want.some((s, i) => s.join() !== (slotBalls[i] || []).join())) {
      slotBalls = want;
    }
  }
  function openSlotIndex() {
    for (let i = 0; i < slotCount; i++) if ((slotBalls[i] || []).length < SLOTS.perSlot) return i;
    if (slotCount < SLOTS.maxCount) { slotCount += 1; if (!slotBalls[slotCount - 1]) slotBalls[slotCount - 1] = []; return slotCount - 1; }
    return SLOTS.maxCount - 1;
  }
  function slotCenterX(index) { return SLOTS.x + index * (SLOTS.w + SLOTS.gap) + SLOTS.w / 2; }
  function slotDropPoint(index) {
    const filled = (slotBalls[index] || []).length;
    const yBottom = SLOT_BODY_TOP + (SLOTS.perSlot - 1) * SLOTS.cell + SLOTS.cell / 2;
    return { x: slotCenterX(index), y: yBottom - filled * SLOTS.cell };
  }

  // Chỉ chạy vật lý khi đang quay, bi đang đi trong ống, hoặc vừa xong để bi kịp ổn định.
  function physicsActive() {
    return rolling || !!rollingBall || settleUntil > performance.now();
  }
  function ensureEngine() {
    if (engine) return;
    engine = Engine.create({ positionIterations: 4, velocityIterations: 3, constraintIterations: 2, enableSleeping: true });
    engine.gravity.y = 1;
    engine.gravity.scale = 0.001;

    walls = makeCageWalls().concat(makeTubeWalls());
    Composite.add(engine.world, walls);
    gate = Bodies.rectangle(GATE_CLOSED.x, GATE_CLOSED.y, CAGE_GAP + 16, WALL_T + 6, {
      isStatic: true, friction: 0.02, restitution: 0.6, label: 'gate',
    });
    Composite.add(engine.world, [gate]);

    Events.on(engine, 'beforeUpdate', applyForces);
    const step = 1000 / 60;
    // Tạm dừng vòng lặp khi lồng cầu đứng yên (Runner.stop tương đương với setInterval).
    timer = setInterval(() => {
      if (!physicsActive()) return;
      Engine.update(engine, step);
      updateAnimations(step);
      draw();
    }, step);
    resize();
    window.addEventListener('resize', resize);
  }

  /* ---------------- Lực thổi + đảo bi ---------------- */
  function applyForces() {
    if (!physicsActive()) return;
    const now = performance.now();
    if (gateOpenAt && rolling && !resultSent && engine.timing.timestamp >= gateOpenAt) {
      gateOpenAt = 0;
      Body.setPosition(gate, { x: GATE_OPEN.x, y: GATE_OPEN.y });
      let best = null, bestD = Infinity;
      for (const ball of balls.values()) {
        const d = Math.hypot(ball.position.x - CAGE.x, ball.position.y - (CAGE.y - CAGE.r));
        if (d < bestD) { bestD = d; best = ball; }
      }
      emitBall(best);
    }
    for (const ball of balls.values()) {
      if (airUntil > now) {
        const dx = ball.position.x - CAGE.x;
        const dy = ball.position.y - CAGE.y;
        const dist = Math.hypot(dx, dy) || 1;
        const bottom = Math.max(0, (dy + CAGE.r) / (2 * CAGE.r));
        // Đảo hỗn loạn: đẩy lên từ đáy + nhiễu loạn xoáy + kéo vào tâm.
        const lift = ball.mass * (0.0012 + 0.0011 * bottom);
        const swirl = ball.mass * (0.0016 * Math.sin(now / 150 + dy / 26) + (Math.random() - 0.5) * 0.0012);
        const inward = dist > CAGE.r * 0.92 ? ball.mass * 0.0004 : 0;
        const nearGap = Math.abs(dx) < 26 && dy < -CAGE.r + 46;
        const jet = nearGap ? ball.mass * 0.0042 : 0;
        Body.applyForce(ball, ball.position, {
          x: swirl - inward * dx / dist - (nearGap ? dx * 0.00016 * ball.mass : 0),
          y: -lift - jet - inward * dy / dist,
        });
        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        if (speed > 3) Body.setVelocity(ball, { x: ball.velocity.x * 3 / speed, y: ball.velocity.y * 3 / speed });
      }
    }
  }

  function emitBall(ball) {
    if (!ball || resultSent) return;
    resultSent = true;
    rolling = false;
    airUntil = 0;
    Body.setPosition(gate, { x: GATE_CLOSED.x, y: GATE_CLOSED.y });
    const number = Number(ball.plugin.number);
    const slot = openSlotIndex();
    if (!slotBalls[slot]) slotBalls[slot] = [];
    // Khóa ngay tọa độ đích: cx tính ĐỘNG theo vị trí cột hiện tại, và vị trí
    // xếp chồng tính theo số bi ĐANG CÓ trong cột (không hardcode, không đổi giữa chừng).
    const targetX = slotCenterX(slot);
    const dropPoint = slotDropPoint(slot);
    Body.setVelocity(ball, { x: 0, y: 0 });
    Body.setAngularVelocity(ball, 0);
    Body.setPosition(ball, { x: CAGE.x, y: CAGE.y - CAGE.r - 2 });
    rollingBall = { ball, number, slot, t: 0, targetX, dropPoint };
    settleUntil = performance.now() + 900;
    // Giai đoạn 1 & 2 kết thúc TRƯỚC khi Bot đọc số (draw:result đi cùng lúc này).
    LotoAudio.stopTumble();
    // Giai đoạn 3: tiếng lăn rỗng đúng bằng thời gian bi đi ống + ray tới cửa thả.
    LotoAudio.startPipeRoll(ROLL_MS * 0.78);
    socket.emit('draw:physics-result', { number, gameId: currentGameId });
  }

  // Cửa thả tại tâm cột: mở khi bi đang đi qua ray tới cột đích.
  function doorState() {
    if (!rollingBall) return null;
    const k = rollingBall.t / ROLL_MS;
    // Cửa chỉ mở khi bi ĐÃ chạm đúng cx (k >= 0.78) và đóng khi bi vào cột.
    if (k < 0.78 || k >= 1) return null;
    return rollingBall.slot;
  }

  function updateAnimations(dt) {
    if (rolling) fanAngle += 0.34;
    if (!rollingBall) return;
    rollingBall.t += dt;
    const k = Math.min(1, rollingBall.t / ROLL_MS);
    const targetX = rollingBall.targetX;   // cx đã khóa lúc bắn
    const dropY = rollingBall.dropPoint.y; // vị trí xếp trên cùng đã khóa
    let x, y;
    if (k < 0.42) {
      // Chặng 1: từ đỉnh lồng theo đường cong vào ĐẦU ray (CHUTE_END).
      const f = (k / 0.42) * (TUBE.length - 1);
      const i = Math.min(TUBE.length - 2, Math.floor(f));
      const t = f - i;
      x = TUBE[i][0] + (TUBE[i + 1][0] - TUBE[i][0]) * t;
      y = TUBE[i][1] + (TUBE[i + 1][1] - TUBE[i][1]) * t;
    } else if (k < 0.78) {
      // Chặng 2: trượt ngang TRONG lòng ray, dừng ĐÚNG cx (clamp, không vượt).
      const f = (k - 0.42) / 0.36;
      const ease = f * f * (3 - 2 * f);
      x = Math.min(targetX, CHUTE_END.x + (targetX - CHUTE_END.x) * ease);
      y = RAIL_Y;
    } else {
      // Chặng 3: ngay khi chạm cx -> cửa mở, rơi thẳng đứng (ease-in như trọng lực).
      const f = (k - 0.78) / 0.22;
      x = targetX;
      y = RAIL_Y + (dropY - RAIL_Y) * f * f;
    }
    Body.setPosition(rollingBall.ball, { x, y });
    Body.setVelocity(rollingBall.ball, { x: 0, y: 0 });
    Body.setAngularVelocity(rollingBall.ball, rollingBall.ball.angularVelocity * 0.9);
    if (k >= 1) {
      // Giai đoạn 4: bi chạm đỉnh chồng bi trong cột -> "cộp" + nảy phụ.
      LotoAudio.trayDrop();
      slotBalls[rollingBall.slot].push(rollingBall.number);
      Composite.remove(engine.world, rollingBall.ball);
      balls.delete(rollingBall.number);
      rollingBall = null;
      settleUntil = Math.max(settleUntil, performance.now() + 400);
    }
  }

  /* ---------------- Vẽ ---------------- */
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBall(number, x, y, angle = 0) {
    const body = ensureBallSprites();
    const digits = ensureNumberSprite(Number(number));
    if (!body || !digits) return;
    const half = SPRITE_SIZE / 2;
    ctx.save();
    ctx.translate(x, y);
    // Thân bóng xoay theo vật lý, chữ số giữ nguyên để đọc được từ xa.
    ctx.save();
    ctx.rotate(angle);
    ctx.drawImage(body, -half, -half, SPRITE_SIZE, SPRITE_SIZE);
    ctx.restore();
    ctx.drawImage(digits, -half, -half, SPRITE_SIZE, SPRITE_SIZE);
    ctx.restore();
  }

  function drawRect(body, fill, stroke) {
    const v = body.vertices;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  // BỆ ĐỠ liên mạch: một tấm đế chung cho cả lồng và các cột.
  function drawBase() {
    const left = CAGE.x - CAGE.r - 16;
    const right = SLOTS.x + slotCount * (SLOTS.w + SLOTS.gap) + 14;
    const grad = ctx.createLinearGradient(0, BASE_TOP, 0, BASE_BOTTOM);
    grad.addColorStop(0, 'rgba(120,24,18,.98)');
    grad.addColorStop(1, 'rgba(52,8,6,.98)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(left, BASE_TOP);
    ctx.lineTo(right, BASE_TOP);
    ctx.lineTo(right - 10, BASE_BOTTOM);
    ctx.lineTo(left + 10, BASE_BOTTOM);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffd977';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Đường viền nền ngang chung
    ctx.beginPath();
    ctx.moveTo(left, BASE_TOP);
    ctx.lineTo(right, BASE_TOP);
    ctx.strokeStyle = 'rgba(255,218,119,.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Khung đỡ CONG ôm sát đáy quả cầu.
  function drawCradle() {
    ctx.beginPath();
    ctx.arc(CAGE.x, CAGE.y, CAGE.r + 9, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(60,10,8,.98)';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,218,119,.85)';
    ctx.stroke();
    // Cổ dẫn khí từ quạt lên đáy lồng (kín hai bên).
    const ductW = FAN.w + 10;
    ctx.fillStyle = 'rgba(30,6,5,.95)';
    ctx.fillRect(CAGE.x - ductW / 2, CAGE.y + CAGE.r - 6, ductW, BASE_TOP - (CAGE.y + CAGE.r - 6) + 12);
    ctx.strokeStyle = '#ffd977';
    ctx.lineWidth = 2;
    ctx.strokeRect(CAGE.x - ductW / 2, CAGE.y + CAGE.r - 6, ductW, BASE_TOP - (CAGE.y + CAGE.r - 6) + 12);
    // Lưới chắn tại điểm tiếp xúc (khe nhỏ hơn đường kính bi).
    ctx.strokeStyle = 'rgba(255,218,119,.8)';
    ctx.lineWidth = 1.5;
    for (let gx = CAGE.x - ductW / 2 + 6; gx < CAGE.x + ductW / 2; gx += 7) {
      ctx.beginPath();
      ctx.moveTo(gx, CAGE.y + CAGE.r - 6);
      ctx.lineTo(gx, CAGE.y + CAGE.r + 4);
      ctx.stroke();
    }
  }

  // CỤM MOTOR + CÁNH QUẬT NẰM NGANG bên trong bệ (side-view).
  // Không còn hộp quay mặt ra trước, không có vệt trắng phía trên.
  function drawFan() {
    const cx = CAGE.x;
    const cy = FAN.y;
    // Thân motor nằm ngang
    roundRectPath(cx - FAN.w / 2, cy - FAN.h / 2, FAN.w, FAN.h, 4);
    ctx.fillStyle = 'rgba(24,5,4,.96)';
    ctx.fill();
    ctx.strokeStyle = '#ffd977';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Trục quay ngang + cánh quạt nhìn từ bên (đĩa mỏng xoay theo trục ngang)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(fanAngle))));
    ctx.beginPath();
    ctx.ellipse(0, 0, FAN.w * 0.22, FAN.h * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,212,94,.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(cx - FAN.w / 2 + 4, cy);
    ctx.lineTo(cx + FAN.w / 2 - 4, cy);
    ctx.strokeStyle = 'rgba(255,218,119,.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Ống dẫn khí + lưới chắn nối THẲNG từ motor lên đáy lồng (xem drawCradle).
  }

  // Nét liền quanh lồng, chừa khe ở đỉnh.
  function drawCageOutline() {
    const half = Math.asin((CAGE_GAP / 2) / CAGE.r);
    const a0 = -Math.PI / 2 + half + 0.02;
    const a1 = Math.PI * 1.5 - half - 0.02;
    ctx.beginPath();
    ctx.arc(CAGE.x, CAGE.y, CAGE.r, a0, a1);
    ctx.lineWidth = WALL_T;
    ctx.strokeStyle = 'rgba(70,12,10,.95)';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,218,119,.9)';
    ctx.stroke();
  }

  // Ống + ray: hai thành song song, nét liền. Cửa thả hở tại cột đích.
  function drawTubeAndRail() {
    const offset = TUBE_GAP / 2 + WALL_T / 2;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i < TUBE.length; i++) {
        let nx = 0, ny = 0;
        if (i === 0) { nx = -(TUBE[1][1] - TUBE[0][1]); ny = TUBE[1][0] - TUBE[0][0]; }
        else if (i === TUBE.length - 1) { nx = -(TUBE[i][1] - TUBE[i - 1][1]); ny = TUBE[i][0] - TUBE[i - 1][0]; }
        else { nx = -(TUBE[i + 1][1] - TUBE[i - 1][1]); ny = TUBE[i + 1][0] - TUBE[i - 1][0]; }
        const len = Math.hypot(nx, ny) || 1;
        const px = TUBE[i][0] + nx / len * offset * sign;
        const py = TUBE[i][1] + ny / len * offset * sign;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = WALL_T;
      ctx.strokeStyle = 'rgba(70,12,10,.95)';
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,218,119,.85)';
      ctx.stroke();
    }

    // Ray ngang (thành trên + thành dưới). Thành dưới có cửa thả tại cột đích.
    const left = RAIL_LEFT;
    const right = RAIL_RIGHT(slotCount);
    const door = doorState();
    const doorX = door != null ? slotCenterX(door) : -1;
    const doorHalf = SLOTS.w * 0.42;
    const railY = [RAIL_Y - RAIL_HALF, RAIL_Y + RAIL_HALF];
    for (let w = 0; w < 2; w++) {
      const yy = railY[w];
      ctx.lineWidth = WALL_T;
      ctx.strokeStyle = 'rgba(70,12,10,.95)';
      if (w === 1 && doorX >= 0) {
        ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(doorX - doorHalf, yy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(doorX + doorHalf, yy); ctx.lineTo(right, yy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(doorX - doorHalf, yy);
        ctx.moveTo(doorX + doorHalf, yy); ctx.lineTo(right, yy);
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,218,119,.85)'; ctx.stroke();
        // Viền cửa mở
        ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(doorX - doorHalf, yy - 6); ctx.lineTo(doorX - doorHalf, yy + 6);
        ctx.moveTo(doorX + doorHalf, yy - 6); ctx.lineTo(doorX + doorHalf, yy + 6); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,218,119,.85)';
        ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
      }
    }
  }

  // Thân cột + bi tĩnh + nhãn: nằm DƯỚI viên bi đang di chuyển.
  function drawSlotBodies() {
    for (let i = 0; i < slotCount; i++) {
      const x = SLOTS.x + i * (SLOTS.w + SLOTS.gap);
      const cx = x + SLOTS.w / 2;
      const y = SLOT_BODY_TOP;
      const colH = SLOT_BODY_H;
      const r = 8;

      // Nền tối miệng oval (chỉ fill, viền sẽ vẽ sau cùng).
      ctx.beginPath();
      ctx.ellipse(cx, y, SLOTS.w / 2, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,4,3,.9)';
      ctx.fill();

      // Thân cột: 2 thành dọc + đáy bo tròn, không cạnh trên cản bi.
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + colH - r);
      ctx.arcTo(x, y + colH, x + r, y + colH, r);
      ctx.lineTo(x + SLOTS.w - r, y + colH);
      ctx.arcTo(x + SLOTS.w, y + colH, x + SLOTS.w, y + colH - r, r);
      ctx.lineTo(x + SLOTS.w, y);
      ctx.fillStyle = 'rgba(40,8,6,.92)';
      ctx.fill();
      ctx.strokeStyle = '#ffd977';
      ctx.lineWidth = 2;
      ctx.stroke();

      const col = slotBalls[i] || [];
      for (let j = 0; j < col.length; j++) {
        const cy = y + (SLOTS.perSlot - 1 - j) * SLOTS.cell + SLOTS.cell / 2;
        drawBall(col[j], cx, cy);
      }

      ctx.beginPath();
      ctx.moveTo(x + 5, y + colH - 24);
      ctx.lineTo(x + SLOTS.w - 5, y + colH - 24);
      ctx.strokeStyle = 'rgba(255,218,119,.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffd977';
      ctx.font = '800 15px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pad(i + 1), cx, y + colH - 12);
    }
  }

  // Viền miệng oval + cổ cửa thả: vẽ SAU cùng để nằm TRÊN viên bi đang chạy,
  // tạo cảm giác bi lọt bên trong lòng ống chứ không trôi đè lên nét viền.
  function drawSlotRims() {
    for (let i = 0; i < slotCount; i++) {
      const x = SLOTS.x + i * (SLOTS.w + SLOTS.gap);
      const cx = x + SLOTS.w / 2;
      const rx = SLOTS.w / 2;
      const ry = 10;
      const ovalCY = SLOT_BODY_TOP;
      const neckDx = rx * 0.7;
      const rimY = ovalCY - ry * Math.sqrt(1 - Math.pow(neckDx / rx, 2));
      const neckTop = RAIL_Y + RAIL_HALF;
      ctx.strokeStyle = 'rgba(255,218,119,.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - neckDx, neckTop); ctx.lineTo(cx - neckDx, rimY);
      ctx.moveTo(cx + neckDx, neckTop); ctx.lineTo(cx + neckDx, rimY);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, ovalCY, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,218,119,.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function machineShiftX() {
    const left = CAGE.x - CAGE.r - 16;
    const right = SLOTS.x + slotCount * (SLOTS.w + SLOTS.gap) + 14;
    return WORLD_W / 2 - (left + right) / 2;
  }

  function draw() {
    if (!ctx || !engine) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offX + machineShiftX() * scale), dpr * offY);

    drawBase();
    drawCradle();
    drawFan();

    const grad = ctx.createRadialGradient(CAGE.x - 40, CAGE.y - 50, 10, CAGE.x, CAGE.y, CAGE.r);
    grad.addColorStop(0, 'rgba(255,255,255,.10)');
    grad.addColorStop(1, 'rgba(90,15,12,.35)');
    ctx.beginPath();
    ctx.arc(CAGE.x, CAGE.y, CAGE.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Bi tĩnh trong lồng trước, viền lồng đè sau để bi nằm TRONG lồng.
    for (const ball of balls.values()) {
      if (rollingBall && ball === rollingBall.ball) continue;
      drawBall(Number(ball.plugin.number), ball.position.x, ball.position.y, ball.angle);
    }
    drawCageOutline();
    drawRect(gate, rolling ? 'rgba(220,70,60,.95)' : 'rgba(120,220,140,.95)', '#fff');

    if (rolling && !resultSent) {
      ctx.save();
      ctx.shadowColor = '#fff3b0';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = '#fff3b0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(CAGE.x - CAGE_GAP / 2 - 8, SENSOR_AT.y);
      ctx.lineTo(CAGE.x + CAGE_GAP / 2 + 8, SENSOR_AT.y);
      ctx.stroke();
      ctx.restore();
    }

    drawSlotBodies();
    // Viên bi đang di chuyển ở GIỮA: dưới khung ray & miệng oval, trên thân cột.
    if (rollingBall) {
      const b = rollingBall.ball;
      drawBall(rollingBall.number, b.position.x, b.position.y, b.angle);
    }
    drawTubeAndRail();   // khung ray đè lên bi -> bi trông chạy trong lòng ray
    drawSlotRims();      // viền oval + cổ đè lên bi -> không trôi qua nét viền
  }

  return {
    ensure(min, max, drawn, gameId) {
      ensureEngine();
      currentGameId = gameId || '';
      const key = `${min}:${max}`;
      if (key !== rangeKey) { rangeKey = key; clearBalls(); addBalls(min, max, drawn || []); }
      syncSlots(drawn);
      resize();
      draw();
    },
    startRoll(min, max, gameId, durationMs) {
      ensureEngine();
      currentGameId = gameId || '';
      const key = `${min}:${max}`;
      if (key !== rangeKey) { rangeKey = key; clearBalls(); addBalls(min, max, []); }
      // Khớp nhịp quay với cài đặt "Thời gian quay (giây)" của Admin.
      const rollMs = Math.max(1200, Math.min(8000, Number(durationMs) || 3000));
      ROLL_MS = Math.round(rollMs * 0.78);
      rolling = true;
      resultSent = false;
      settleUntil = 0;
      // Sleeping cần được đánh thức khi bật quạt trở lại.
      if (Sleeping && Sleeping.set) balls.forEach((ball) => Sleeping.set(ball, false));
      airUntil = Number.POSITIVE_INFINITY;
      Body.setPosition(gate, { x: GATE_CLOSED.x, y: GATE_CLOSED.y });
      // Cổ ống chỉ mở sau khi chú Dê Lửa hát xong vè (hoặc fallback timeout).
      gateOpenAt = 0;
      // Giai đoạn 1 & 2: gió quạt + banh va đập trong lồng.
      LotoAudio.startFan(rollMs);
      LotoAudio.startClacks(rollMs);
      if (window.LotoMascot && typeof window.LotoMascot.onDrawStart === 'function') {
        root.LotoMascot.onDrawStart(rollMs, () => {
          if (rolling && !resultSent) gateOpenAt = engine.timing.timestamp + 100;
        });
      } else {
        gateOpenAt = engine.timing.timestamp + Math.min(rollMs * 0.9, 2700);
      }
    },
    cancel() {
      rolling = false;
      resultSent = false;
      settleUntil = 0;
      airUntil = 0;
      LotoAudio.stopAll();
      if (rollingBall) { Composite.remove(engine.world, rollingBall.ball); rollingBall = null; }
      if (gate) Body.setPosition(gate, { x: GATE_CLOSED.x, y: GATE_CLOSED.y });
    },
    reset(min, max) {
      ensureEngine();
      rangeKey = '';
      clearBalls();
      addBalls(min || 1, max || 90, []);
      slotCount = SLOTS.minCount;
      slotBalls = emptySlots(slotCount);
      this.cancel();
      resize();
      draw();
    },
  };
})();

/* ============================================================
   NGƯỜI CHIẾN THẮNG / NGƯỜI THAM GIA / BẢNG XẾP HẠNG
   ============================================================ */
function clearWinner() {
  tvRenderCache.winners = '';
  const box = $('tvWinner');
  box.classList.remove('has-winner');
  box.classList.add('hidden');
  $('tvWinnerTitle').textContent = '';
  $('tvWinnerName').textContent = '';
  $('tvWinnerInfo').textContent = '';
  $('tvWinnerMoney').textContent = '';
}

function showWinners(list, per) {
  if (!list || !list.length) { clearWinner(); return; }
  const sig = JSON.stringify([list.map((w) => [w.name, w.row, w.code]), per]);
  if (tvRenderCache.winners === sig) return;
  tvRenderCache.winners = sig;
  const box = $('tvWinner');
  box.classList.remove('hidden');
  box.classList.add('has-winner');
  $('tvWinnerTitle').textContent = list.length > 1 ? `🎉 ${list.length} BINGO! 🎉` : '🎉 BINGO! 🎉';
  $('tvWinnerName').textContent = list.map((w) => w.name).join('  ·  ');
  $('tvWinnerInfo').textContent = list
    .map((w) => `Hàng ${w.row} · Bingo thứ ${w.position} (vé ${w.code || ''})`.trim())
    .join('  |  ');
  $('tvWinnerMoney').textContent = `Tiền thưởng mỗi người: ${fmt(per)}`;
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
}

function renderTvPlayers(players) {
  const box = $('tvPlayersList');
  if (!box) return;
  const list = players || [];
  const sig = JSON.stringify(list.map((p) => [
    p.name, p.ticketCount, p.locked, p.awaitingTicket, p.waitingNextRound,
    p.minRemaining, p.waitingRows,
  ]));
  if (tvRenderCache.players === sig) return;
  tvRenderCache.players = sig;
  if (!list.length) { box.innerHTML = '<div class="tv-empty">Chưa có ai tham gia.</div>'; }
  else {
    box.innerHTML = list.map((p) => `
    <div class="tv-player">
      <div class="tv-player-head">
        <b>${escapeHtmlTv(p.name)}</b>
        <span class="tv-ticket-status ${p.awaitingTicket ? 'awaiting' : p.waitingNextRound ? 'waiting-next' : p.locked ? 'locked' : 'unlocked'}">
          ${p.locked
            ? '<span class="tv-ticket-check" aria-hidden="true">✓</span> Đã chốt'
            : p.awaitingTicket
              ? '<span class="tv-ticket-donut" aria-hidden="true"></span> Chờ nhận vé'
              : p.waitingNextRound
                ? '<span class="tv-ticket-donut" aria-hidden="true"></span> Chờ ván sau'
                : '<span class="tv-ticket-donut" aria-hidden="true"></span> Chưa chốt'}
        </span>
      </div>
      ${p.awaitingTicket
        ? '<small>Đang vào ván · Chưa có vé</small>'
        : p.waitingNextRound
          ? '<small>Đang ở hàng chờ</small>'
          : `<small class="tv-player-meta">
              <span>${p.ticketCount || 0} vé</span>
              ${p.waitingRows > 0 ? `<b class="tv-near-bingo">Đợi ${p.waitingRows} hàng</b>` : ''}
            </small>`}
    </div>`).join('');
  }
}
function escapeHtmlTv(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- Bảng vinh danh CHÚC MỪNG KINH ---------------- */
let kinhBannerTimer;
function showKinhBanner(message) {
  const box = $('kinhBanner');
  if (!box || !message) return;
  box.textContent = message;
  box.classList.remove('hidden');
  box.classList.add('show');
  clearTimeout(kinhBannerTimer);
  kinhBannerTimer = setTimeout(() => {
    box.classList.remove('show');
    box.classList.add('hidden');
  }, 6000);
}
function hideKinhBanner() {
  const box = $('kinhBanner');
  if (!box) return;
  box.classList.remove('show');
  box.classList.add('hidden');
}

function renderMiniTicket(winner) {
  const rows = Array.isArray(winner.ticketRows) ? winner.ticketRows : [];
  const kinRow = Number(winner.row) || 0;
  if (!rows.length) return '<div class="kinh-mini-empty">(Không có dữ liệu lưới vé)</div>';
  return `<div class="kinh-mini-grid">${rows.map((row, ri) => {
    const cells = Array.isArray(row.cells) ? row.cells : [];
    return `<div class="kinh-mini-row ${ri + 1 === kinRow ? 'is-kinh-row' : ''}">${
      cells.map((cell) => cell
        ? `<span class="kinh-mini-cell ${cell.matched ? 'is-matched' : ''}">${pad(cell.value)}</span>`
        : '<span class="kinh-mini-cell is-blank"></span>').join('')
    }</div>`;
  }).join('')}</div>`;
}

function showKinhOverlay(winners, per) {
  const list = (winners || []).filter(Boolean);
  if (!list.length) return;
  const box = $('tvKinhOverlay');
  const amount = Number(per || 0);
  $('tvKinhWinners').innerHTML = list.map((w) => `
    <div class="kinh-card">
      <div class="kinh-card-head">
        <span class="kinh-card-name">${escapeHtmlTv(w.name)}</span>
        <span class="kinh-card-ticket">Vé ${escapeHtmlTv(w.code || '')}</span>
      </div>
      <div class="kinh-card-money">${fmt(amount)}</div>
      <div class="kinh-card-label">Hàng ${Number(w.row) || '?'} · đối chiếu vé bên dưới</div>
      ${renderMiniTicket(w)}
    </div>`).join('');
  // Pháo giấy: tạo lại mỗi lần mở để hiệu ứng luôn chạy.
  const confetti = $('tvConfetti');
  if (confetti) {
    const colors = ['#ffd54f', '#ff5252', '#69f0ae', '#40c4ff', '#ff9100', '#fff'];
    confetti.innerHTML = Array.from({ length: 70 }, (_, i) => {
      const left = Math.random() * 100;
      const delay = (Math.random() * 2.5).toFixed(2);
      const duration = (2.6 + Math.random() * 2.4).toFixed(2);
      const color = colors[i % colors.length];
      return `<i style="left:${left}%;background:${color};animation-delay:${delay}s;animation-duration:${duration}s"></i>`;
    }).join('');
  }
  box.classList.remove('hidden');
  box.classList.add('show');
  // Re-trigger scale-in animation.
  const board = box.querySelector('.kinh-board');
  if (board) {
    board.style.animation = 'none';
    void board.offsetWidth;
    board.style.animation = '';
  }
}
function hideKinhOverlay() {
  const box = $('tvKinhOverlay');
  if (!box) return;
  box.classList.remove('show');
  box.classList.add('hidden');
  const confetti = $('tvConfetti');
  if (confetti) confetti.innerHTML = '';
}

function renderLeaderboard(entries) {
  const box = $('tvLeaderboardList');
  const crowns = ['👑', '🥈', '🥉'];
  // Chỉ hiển thị người có totalWon > 0 (server đã lọc/sắp theo totalWon).
  const valid = (entries || []).filter((e) => Number(e.totalWon ?? e.winnings) > 0);
  const sig = JSON.stringify(valid.map((e) => [e.name, e.totalWon ?? e.winnings]));
  if (tvRenderCache.leaderboard === sig) return;
  tvRenderCache.leaderboard = sig;
  box.innerHTML = valid.map((entry, index) => `
    <div class="tv-leader-row">
      <span>${crowns[index] || '🏅'} ${escapeHtmlTv(entry.name)}</span>
      <b>${fmt(entry.totalWon ?? entry.winnings)}</b>
    </div>`).join('') || '<div class="tv-empty">Chưa có ai ghi nhận thành tích.</div>';
}

/* ============================================================
   SỐ VỪA XỔ (re-trigger animation mỗi lượt)
   ============================================================ */
function showLastDraw(number) {
  const wrap = $('tvLastDraw');
  const ball = $('tvLastBall');
  if (!wrap || !ball) return;
  ball.textContent = pad(Number(number));
  ball.classList.remove('is-waiting', 'is-new');
  wrap.classList.remove('is-live');
  // Ép reflow để animation chạy LẠI hoàn toàn dù số trước đó vẫn là số mới.
  void ball.offsetWidth;
  ball.classList.add('is-new');
  wrap.classList.add('is-live');
  // Giai đoạn 4: "ting" êm tai đúng lúc ô Số vừa xổ phóng to.
  LotoAudio.revealTing();
}

function resetLastDraw() {
  const wrap = $('tvLastDraw');
  const ball = $('tvLastBall');
  if (!ball) return;
  ball.textContent = '--';
  ball.classList.remove('is-new');
  ball.classList.add('is-waiting');
  if (wrap) wrap.classList.remove('is-live');
}

/* ============================================================
   STATE / SOCKET
   ============================================================ */
function applyState(s) {
  lastConfig = s.config || lastConfig;
  const min = s.config && s.config.minNumber;
  const max = s.config && s.config.maxNumber;
  const gameId = s.gameId || '';
  const drawn = s.drawn || [];
  const betText = `${fmt(s.config && s.config.betPerTicket)}/vé`;
  if (tvRenderCache.bet !== betText) {
    tvRenderCache.bet = betText;
    $('tvBet').textContent = betText;
  }
  // Không dựng lại lồng cầu nếu ván/kho số không đổi.
  const physicsSig = `${min || 1}:${max || 90}:${gameId}:${drawn.length}`;
  if (tvRenderCache.physics !== physicsSig) {
    tvRenderCache.physics = physicsSig;
    Physics.ensure(min || 1, max || 90, drawn, gameId);
  }
  renderTvPlayers(s.participants || s.players);
  if (tvRenderCache.leaderVisible !== !!s.leaderboardVisible) {
    tvRenderCache.leaderVisible = !!s.leaderboardVisible;
    $('tvLeaderboard').classList.toggle('hidden', !s.leaderboardVisible);
  }
  renderLeaderboard(s.leaderboard);
  const rulesOn = !!(s.showRules ?? s.rulesVisible);
  if (tvRenderCache.rulesVisible !== rulesOn) {
    tvRenderCache.rulesVisible = rulesOn;
    $('tvRules').classList.toggle('hidden', !rulesOn);
  }
  if (window.LotoMascot && typeof window.LotoMascot.applyState === 'function') {
    window.LotoMascot.applyState(s);
  }
  if (typeof syncSfxState === 'function' && typeof s.sfxEnabled === 'boolean') {
    syncSfxState(s.sfxEnabled);
  }
  if (!stateLoaded) {
    stateLoaded = true;
    if (s.winners && s.winners.length && s.maxWinnersReached) {
      showKinhOverlay(s.winners, s.prizePerWinner);
    } else if (s.winners && s.winners.length) {
      showWinners(s.winners.slice(-3).reverse(), s.prizePerWinner);
    }
  }
}

socket.on('connect', () => socket.emit('tv:register'));
socket.on('tv:state', applyState);
socket.on('qr:ready', ({ dataUrl, joinUrl }) => {
  const img = $('tvQrImg');
  const url = $('tvQrUrl');
  if (img && dataUrl) img.src = dataUrl;
  if (url && joinUrl) url.textContent = joinUrl;
});

socket.on('draw:rolling', ({ min, max, mode, duration, gameId } = {}) => {
  if (mode === 'physics') {
    Physics.startRoll(min || 1, max || 90, gameId, duration);
  }
});
socket.on('draw:result', ({ number } = {}) => {
  // Bóng vật lý đã tự lăn qua ống vào ngăn xếp trên canvas ->
  // bật số vừa xổ với hiệu ứng ngay khoảnh khắc này.
  if (number !== undefined && number !== null) {
    showLastDraw(number);
    if (window.LotoMascot && typeof window.LotoMascot.onNumberRevealed === 'function') {
      window.LotoMascot.onNumberRevealed(number);
    }
  }
});
socket.on('host:kinh', ({ latest, winners, prizePerWinner }) => {
  // Tiến trình Kinh: chỉ cập nhật bảng nhỏ, KHÔNG mở overlay vinh danh.
  showWinners(latest && latest.length ? latest : winners.slice(-3), prizePerWinner);
});
socket.on('near:kinh', ({ players }) => {
  if (window.LotoMascot && typeof window.LotoMascot.onNearKinh === 'function') {
    window.LotoMascot.onNearKinh(players);
  }
});
socket.on('kinh:progress', ({ message }) => {
  if (message) showKinhBanner(message);
});
socket.on('kinh:clear', () => {
  hideKinhBanner();
  hideKinhOverlay();
});
socket.on('game:limit-reached', ({ winners, prizePerWinner }) => {
  showKinhOverlay(winners, prizePerWinner);
  if (window.LotoMascot && typeof window.LotoMascot.onKinh === 'function') {
    window.LotoMascot.onKinh(winners);
  }
});
socket.on('tv:rules', ({ visible }) => {
  const on = !!visible;
  tvRenderCache.rulesVisible = on;
  $('tvRules').classList.toggle('hidden', !on);
});
socket.on('draw:cancel', () => Physics.cancel());
socket.on('game:reset', (payload) => {
  stateLoaded = false;
  tvRenderCache.physics = '';
  tvRenderCache.players = '';
  tvRenderCache.leaderboard = '';
  hideKinhBanner();
  hideKinhOverlay();
  clearWinner();
  resetLastDraw();
  if (window.LotoMascot && typeof window.LotoMascot.onGameReset === 'function') {
    window.LotoMascot.onGameReset();
  }
  renderTvPlayers([]);
  Physics.reset(payload && payload.config && payload.config.minNumber || 1,
    payload && payload.config && payload.config.maxNumber || 90);
});
socket.on('game:finished', ({ winners, prizePerWinner }) => {
  if (winners && winners.length) showKinhOverlay(winners, prizePerWinner);
});

/* ---------------- Đồng bộ trạng thái âm thanh từ Admin ---------------- */
function syncSfxState(enabled) {
  const on = !!enabled;
  LotoAudio.setEnabled(on);
  const hint = $('tvAudioHint');
  if (!hint) return;
  // Chỉ hiện gợi ý khi Admin đang bật âm thanh mà trình duyệt còn giữ AudioContext suspended.
  if (on && LotoAudio.ensureContext && LotoAudio.ensureContext() && LotoAudio.ensureContext().state === 'suspended') {
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}
socket.on('sfx:state', ({ enabled } = {}) => syncSfxState(enabled));

// Tự động mở khóa AudioContext ngay lần tương tác đầu tiên trên trang TV.
(function installTvAudioUnlock() {
  const hint = $('tvAudioHint');
  const unlock = () => {
    if (LotoAudio && typeof LotoAudio.unlock === 'function') LotoAudio.unlock();
    if (hint) hint.classList.add('hidden');
    document.removeEventListener('click', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('pointerdown', unlock, true);
  };
  document.addEventListener('click', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('pointerdown', unlock, { capture: true });
})();
