const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { numberToVietnamese, numberCallout, announcement, styles } = require('../../frontend/js/announcer');

const frontend = path.resolve(__dirname, '../../frontend');

function idsFromHtml(file) {
  const html = fs.readFileSync(path.join(frontend, file), 'utf8');
  return new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
}

function selectorsFromScript(file) {
  const script = fs.readFileSync(path.join(frontend, 'js', file), 'utf8');
  return [...script.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
}

test('frontend scripts only reference IDs present in their pages', () => {
  const pages = [
    ['host.js', 'index.html'],
    ['player.js', 'play.html'],
    ['tv.js', 'tv.html'],
  ];
  for (const [script, html] of pages) {
    const ids = idsFromHtml(html);
    const missing = selectorsFromScript(script).filter((id) => !ids.has(id));
    assert.deepEqual([...new Set(missing)], [], `${script} references missing IDs`);
  }
});

test('player displays live server ticket price without asking for ticket codes', () => {
  const html = fs.readFileSync(path.join(frontend, 'play.html'), 'utf8');
  const script = fs.readFileSync(path.join(frontend, 'js', 'player.js'), 'utf8');
  assert.match(html, /id="playerTicketPrice"/);
  assert.doesNotMatch(html, /ticketCodesInput|Mã vé đã có/);
  assert.match(script, /socket\.on\('tv:state'.*betPerTicket/);
  assert.match(script, /socket\.on\('game:reset'.*betPerTicket/);
});

test('player and admin show deposited money, winnings, debt, and wallet actions', () => {
  const play = fs.readFileSync(path.join(frontend, 'play.html'), 'utf8');
  const player = fs.readFileSync(path.join(frontend, 'js', 'player.js'), 'utf8');
  const admin = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'style.css'), 'utf8');
  assert.match(play, /id="walletDeposited"/);
  assert.match(play, /id="walletWon"/);
  assert.match(play, /id="walletDebt"/);
  assert.match(player, /wallet\.won = Number\(summary\.winnings\)/);
  assert.match(admin, /admin:wallet-set/);
  assert.match(admin, /editable-finance/);
  assert.match(admin, /data-field="deposited"/);
  assert.match(admin, /data-field="winnings"/);
  assert.match(admin, /data-field="debt"/);
  assert.match(admin, /\$\{count\} vé/); // compact accordion: số vé trên 1 dòng
  assert.match(admin, /admin-ticket-code/);
  assert.match(admin, /Đã nạp/);
  assert.match(admin, /Tiền thưởng/);
  assert.match(admin, /Đang nợ/);
  assert.match(css, /\.admin-ticket-code/);
});

test('admin has no TV preview iframe or TV link controls; phone preview stays', () => {
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'style.css'), 'utf8');
  const tvScript = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');

  // TV preview section and all of its controls are gone.
  for (const id of ['tvPreviewFrame', 'tvPageLink', 'btnCopyTVLink', 'btnRefreshTVPreview', 'tvCopyStatus']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `${id} must be removed from admin`);
    assert.doesNotMatch(host, new RegExp(id), `${id} must be removed from host.js`);
  }
  assert.doesNotMatch(html, /tv-admin-preview|tv-preview-screen|tv-preview-live|tv-preview-link-row/);
  assert.doesNotMatch(css, /\.tv-admin-preview|\.tv-preview-screen|\.tv-copy-status|\.tv-preview-live/);
  assert.doesNotMatch(host, /tv-preview-alive|refreshTVPreview|tvLastAlive/);
  assert.doesNotMatch(tvScript, /tv-preview-alive/);

  // Phone preview (separate feature) is kept.
  assert.match(html, /id="previewFrame"/);
  assert.match(html, /id="btnPreview"/);
  assert.match(host, /btnPreview/);
  assert.doesNotMatch(html, /id="bigNumber"|id="drawnGrid"/);
});

test('admin player list is a compact accordion with search, filters and internal scroll', () => {
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'style.css'), 'utf8');

  // Search + 3 filter tabs above the list.
  assert.match(html, /id="playerSearch"/);
  assert.match(html, /placeholder="Tìm tên hoặc mã vé \(VD: V001\)"/);
  for (const f of ['all', 'unlocked', 'debt']) assert.match(html, new RegExp(`data-filter="${f}"`));
  assert.match(host, /playerQuery/);
  assert.match(host, /playerFilter === 'unlocked'/);
  assert.match(host, /playerFilter === 'debt'/);

  // Collapsed row shows name, status badge, ticket count, debt badge, arrow, kick.
  assert.match(host, /player-accordion/);
  assert.match(host, /player-row/);
  assert.match(host, /badge-locked/);
  assert.match(host, /badge-unlocked/);
  assert.match(host, /badge-debt/);
  assert.match(host, /class="player-badge badge-debt">Nợ/);
  assert.match(host, /player-kick/);
  assert.match(host, /expandedPlayers\.has\(id\)/);
  assert.match(host, /role="button" tabindex="0" aria-expanded/);

  // Expanded detail: ticket chips wrap; 3 finance cells on one row.
  assert.match(host, /player-detail/);
  assert.match(css, /\.player-detail \.admin-ticket-codes[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.admin-player-finance\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);

  // Internal scroll capped ~360px with thin themed scrollbar; accordion open/close CSS.
  assert.match(css, /\.player-list\s*\{[^}]*max-height:\s*360px[^}]*overflow-y:\s*auto/s);
  assert.match(css, /scrollbar-color:\s*rgba\(255,212,94/);
  assert.match(css, /\.player-accordion\.is-open \.player-detail\s*\{\s*display:\s*block/);
  assert.match(css, /\.player-accordion\.is-open \.player-chevron\s*\{\s*transform:\s*rotate\(90deg\)/);
});

test('admin control panel: main actions + single next-round button, 4 TV/audio toggles, compact kick and collapsible config', () => {
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'style.css'), 'utf8');

  // Main actions hold draw + auto + the single unified "Qua ván mới" button.
  assert.match(html, /class="control-group control-primary"/);
  assert.doesNotMatch(html, /class="control-group control-manage"/);
  const main = html.slice(html.indexOf('class="main-actions"'), html.indexOf('Cụm 2'));
  assert.match(main, /id="btnDraw"/);
  assert.match(main, /id="btnAuto"/);
  assert.match(main, /id="btnNextRoundMain"/);
  assert.match(main, /QUA VÁN MỚI/);
  for (const id of ['btnNew', 'btnApplyConfig', 'btnFinish']) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.match(host, /function nextRound\(/);
  assert.match(host, /admin:next-round/);
  assert.match(host, /Ván hiện tại chưa đủ người Kinh/);

  // Exactly 4 equal TV/audio toggles.
  const toggles = html.slice(html.indexOf('class="toggle-grid"'), html.indexOf('Cài đặt'));
  for (const id of ['btnRules', 'btnLeaderboard', 'btnBot', 'btnBotStyle', 'btnSfx']) assert.match(toggles, new RegExp(`id="${id}"`));
  assert.equal((toggles.match(/class="btn btn-ghost toggle-btn"/g) || []).length, 5);
  assert.match(css, /\.toggle-grid\s*\{[^}]*repeat\(5, 1fr\)/);

  // No "Phản hồi" tab: bottom-right is a plain LỊCH SỬ VÁN panel.
  assert.doesNotMatch(html, /Phản hồi/);
  assert.doesNotMatch(html, /id="tabAcks"/);
  assert.match(html, /<h2>📜 LỊCH SỬ VÁN<\/h2>/);
  assert.match(html, /id="tabHistory" class="history-list"/);

  // Kick-all is a small text/outline button inline with the player heading.
  assert.match(html, /id="btnKickAll" class="btn-text btn-text-danger"/);
  assert.doesNotMatch(html, /<div style="margin-bottom:8px">\s*<button id="btnKickAll"/);
  assert.match(css, /\.btn-text-danger\s*\{[^}]*margin-left:\s*auto/);

  // Config collapsible: markup + JS toggle + auto-collapse after game starts.
  assert.match(html, /class="control-group config-panel" id="configPanel"/);
  assert.match(html, /id="btnToggleConfig"/);
  assert.match(css, /\.config-panel\.collapsed \.config-grid\s*\{\s*display:\s*none/);
  assert.match(host, /function setConfigCollapsed\(/);
  assert.match(host, /function autoCollapseConfig\(/);
  assert.match(host, /autoCollapseConfig\(\); \/\/ ván đã bắt đầu/);

  // Monochrome Lucide-style SVG icons, no multicolour emoji on control buttons.
  assert.match(html, /<svg class="icon" viewBox="0 0 24 24"/);
  assert.match(css, /\.icon\s*\{[^}]*stroke:\s*currentColor/);
  assert.match(host, /function setBtnLabel\(id, text\)/);
  assert.doesNotMatch(host, /setBtnLabel\([^)]*['"][🎲🤖📜🏆🔊🎤⏹]/);
});

test('business audit: rounded prize, locked settings bypass, locked-only Kinh and simultaneous over-limit', () => {
  const server = fs.readFileSync(path.join(frontend, '../backend/server.js'), 'utf8');

  // Prize per winner is a clean multiple of 1.000đ.
  assert.match(server, /Math\.floor\(pool \/ game\.winners\.length \/ 1000\) \* 1000/);

  // Admin cannot bypass hard locks through config:update (works after F5 too).
  assert.match(server, /socket\.on\('config:update', \(cfg\) => \{[\s\S]{0,400}LOCKED_FIELDS/);
  assert.match(server, /roundStarted = game\.drawn\.length > 0 \|\| game\.tickets\.some\(\(t\) => t\.locked\)/);

  // Only locked (chốt) tickets are matched / shown as near-Kinh; prizePool already filters locked.
  assert.match(server, /if \(!ticket\.owner \|\| !ticket\.locked\) return;/);
  assert.match(server, /if \(!ticket\.owner \|\| !ticket\.locked \|\| seenNear\.has\(ticket\.owner\)\) return;/);

  // Đồng Kinh trong CÙNG lượt được phép vượt max; không nhận thêm ở lượt sau.
  assert.match(server, /const winnersAtDrawStart = game\.winners\.length/);
  assert.match(server, /game\.winners\.length >= game\.config\.maxWinners\s*\n\s*&& game\.winners\.length === winnersAtDrawStart/);

  // Finance buttons never touch totalWon except reset-achievements.
  const payReward = server.slice(server.indexOf("socket.on('admin:pay-reward'"), server.indexOf("socket.on('admin:offset-debt'"));
  const offsetDebt = server.slice(server.indexOf("socket.on('admin:offset-debt'"), server.indexOf("socket.on('admin:reset-achievements'"));
  assert.match(payReward, /account\.winnings = 0;/);
  assert.doesNotMatch(payReward, /account\.totalWon/);
  assert.match(offsetDebt, /account\.winnings -= used;/);
  assert.doesNotMatch(offsetDebt, /account\.totalWon/);

  // Chốt vé: chống chốt đúp và chặn chốt muộn khi ván đã quay.
  assert.match(server, /if \(owned\.every\(\(t\) => t\.locked\)\)/);
  assert.match(server, /if \(game\.drawn\.length > 0 \|\| rolling\)/);
  assert.match(server, /không thể chốt vé muộn/);

  // Kick-all only clears tickets; wipe clears finances + history.
  const kickAll = server.slice(server.indexOf("socket.on('admin:kick-all'"), server.indexOf("socket.on('admin:adjust-wallet'"));
  assert.doesNotMatch(kickAll, /finances = \{\}/);
  const wipe = server.slice(server.indexOf("socket.on('admin:wipe-all-data'"));
  assert.match(wipe.slice(0, 700), /finances = \{\}/);
  assert.match(wipe.slice(0, 700), /writeJSON\(HISTORY_FILE, \[\]\)/);
});

test('TV rules overlay: fixed four-section text, Admin sync and auto-close on draw', () => {
  const server = fs.readFileSync(path.join(frontend, '../backend/server.js'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const tv = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const tvHtml = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const tvCss = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');

  // Server: showRules state, alias rulesVisible, realtime emit and auto-close on draw.
  assert.match(server, /let showRules = false/);
  assert.match(server, /showRules,\s*\n\s*rulesVisible: showRules/);
  assert.match(server, /function setRulesVisible\(visible\)/);
  assert.match(server, /io\.emit\('tv:rules', \{ visible: showRules \}\)/);
  assert.match(server, /function doDraw\([\s\S]{0,200}setRulesVisible\(false\)/);

  // Admin: button label + realtime listener.
  assert.match(host, /Tắt luật chơi TV/);
  assert.match(host, /Bật luật chơi TV/);
  assert.match(host, /socket\.on\('tv:rules'/);

  // TV: uses showRules with alias fallback.
  assert.match(tv, /s\.showRules \?\? s\.rulesVisible/);
  assert.match(tv, /socket\.on\('tv:rules'/);

  // Fixed, non-dynamic rule text with all 4 sections.
  assert.match(tvHtml, /id="tvRules" class="tv-rules hidden"/);
  assert.match(tvHtml, /LUẬT CHƠI LÔ TÔ NGÀY TẾT/);
  assert.match(tvHtml, /1\. Nạp tiền qua Quản trò/);
  assert.match(tvHtml, /2\. Chọn &amp; Chốt vé/);
  assert.match(tvHtml, /3\. Cách dò số/);
  assert.match(tvHtml, /4\. Điều kiện KINH &amp; Nhận thưởng/);
  assert.doesNotMatch(tvHtml, /id="tvRules"[\s\S]*?\{\{|\$\{/); // không chèn số cài đặt động
  assert.match(tvCss, /\.rules-board/);
  assert.match(tvCss, /@keyframes rulesScaleIn/);
});

test('performance: physics idle pause, cheap ball sprites, throttled audio, timer cleanup and DOM diffing', () => {
  const tv = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const audio = fs.readFileSync(path.join(frontend, 'js', 'audio.js'), 'utf8');
  const mascot = fs.readFileSync(path.join(frontend, 'js', 'mascot.js'), 'utf8');
  const tvHtml = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const tvCss = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');

  // Matter.js: 4/3 iterations, 28 cage segments, loop paused when idle.
  assert.match(tv, /positionIterations: 4, velocityIterations: 3/);
  assert.match(tv, /const segments = 28/);
  assert.match(tv, /function physicsActive\(\)/);
  assert.match(tv, /if \(!physicsActive\(\)\) return;/);
  assert.match(tv, /settleUntil = performance\.now\(\) \+ 900/);

  // 90 bóng được vẽ sẵn vào offscreen canvas, chỉ drawImage mỗi frame.
  assert.match(tv, /const ballNumberSprites = new Map\(\)/);
  assert.match(tv, /ensureNumberSprite\(number\)/);
  assert.match(tv, /ctx\.drawImage\(body, -half, -half, SPRITE_SIZE, SPRITE_SIZE\)/);
  assert.match(tv, /ctx\.drawImage\(digits, -half, -half, SPRITE_SIZE, SPRITE_SIZE\)/);
  assert.doesNotMatch(tv.slice(tv.indexOf('function drawBall('), tv.indexOf('function drawRect(')), /createRadialGradient/);

  // Không filter/drop-shadow trên phần tử mascot chuyển động.
  assert.doesNotMatch(tvHtml, /filter="url\(#fireGlow\)"/);
  assert.doesNotMatch(tvCss, /\.tv-mascot\s*\{[^}]*filter:/);
  assert.doesNotMatch(tvCss, /fireBright[^}]*filter:/);

  // Mascot dọn timer cũ trước khi tạo timer mới.
  assert.match(mascot, /function clearFallbacks\(\)/);
  assert.match(mascot, /clearFallbacks\(\);[\s\S]*setState\('singing'\)/);
  assert.match(mascot, /clearInterval\(mascot\.emptyTimer\)/);

  // Audio: 1 noise buffer dùng lại, throttle clack, disconnect trên onended.
  assert.match(audio, /this\.noiseBuffer = this\.createNoiseBuffer\(2\)/);
  assert.match(audio, /if \(this\.noiseBuffer\) return this\.noiseBuffer/);
  assert.match(audio, /MIN_CLACK_GAP_MS = 72/);
  assert.match(audio, /osc\.onended = \(\) => \{[\s\S]*osc\.disconnect\(\); gain\.disconnect\(\)/);

  // Diffing trước khi đụng DOM ở cả TV và Admin.
  assert.match(tv, /const tvRenderCache = Object\.create\(null\)/);
  assert.match(tv, /tvRenderCache\.players === sig/);
  assert.match(tv, /tvRenderCache\.leaderboard === sig/);
  assert.match(host, /function renderIfChanged\(key, signature\)/);
  assert.match(host, /renderIfChanged\('players', sig\)/);
  assert.match(host, /renderIfChanged\('winners', sig\)/);
});

test('TV mascot Dê Lửa Đinh Mùi 2027: inline SVG, four expressions, speech and timing hooks', () => {
  const tvHtml = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const tvCss = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');
  const mascot = fs.readFileSync(path.join(frontend, 'js', 'mascot.js'), 'utf8');
  const tv = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');

  // Vị trí & kích thước cố định góc trái dưới.
  assert.match(tvCss, /\.tv-mascot\s*\{[^}]*position:\s*fixed/);
  assert.match(tvCss, /\.tv-mascot\s*\{[^}]*bottom:\s*24px/);
  assert.match(tvCss, /\.tv-mascot\s*\{[^}]*left:\s*24px/);
  assert.match(tvCss, /\.tv-mascot\s*\{[^}]*z-index:\s*30/);
  assert.match(tvCss, /width:\s*145px/);

  // Inline SVG, phối màu lửa + kem ngà + áo Tết 2027.
  assert.match(tvHtml, /id="tvMascot"/);
  assert.match(tvHtml, /id="mascotBubble"/);
  assert.match(tvHtml, /id="mascotText"/);
  assert.match(tvHtml, /<svg class="mascot-svg"/);
  assert.match(tvHtml, /#FFF5E1/);
  assert.match(tvHtml, />2027</);
  assert.match(tvHtml, /url\(#fireGrad\)/);
  assert.match(tvHtml, /id="fireGrad"/); // gradient tĩnh, không SVG filter động

  // 4 trạng thái biểu cảm.
  for (const st of ['state-sad', 'state-normal', 'state-singing', 'state-excited']) {
    assert.match(tvCss, new RegExp('\\.' + st));
  }
  assert.match(mascot, /setState\('sad'\)/);
  assert.match(mascot, /setState\('singing'\)/);
  assert.match(mascot, /setState\('excited'\)/);

  // Web Speech API vi-VN + bong bóng thoại.
  assert.match(mascot, /SpeechSynthesisUtterance/);
  assert.match(mascot, /u\.lang = 'vi-VN'/);
  assert.match(mascot, /setBubble\(text\)/);

  // 6 tình huống: trống, ít người, chào, hát vè, chốt số, near kinh, kinh.
  assert.match(mascot, /EMPTY_LINES/);
  assert.match(mascot, /FEW_LINES/);
  assert.match(mascot, /SING_LINES/);
  assert.match(mascot, /Chào mừng/);
  assert.match(mascot, /Chốt số/);
  assert.match(mascot, /Hồi hộp quá/);
  assert.match(mascot, /Chúc mừng/);

  // Hàng đợi ưu tiên 3 mức.
  assert.match(mascot, /PRIORITY = \{ HIGH: 1, MID: 2, LOW: 3 \}/);
  assert.match(mascot, /priority === PRIORITY\.HIGH/);

  // Đồng bộ thời gian: hát xong mới mở cổ ống; fallback timeout.
  assert.match(mascot, /durationMs \|\| 3000\) \+ 1500/);
  assert.match(tv, /LotoMascot\.onDrawStart\(rollMs/);
  assert.match(tv, /gateOpenAt = engine\.timing\.timestamp \+ 100/);

  // Audio ducking hook.
  assert.match(mascot, /LotoAudio\.setDuck\(true\)/);
  assert.match(mascot, /LotoAudio\.setDuck\(false\)/);
  assert.match(mascot, /root\.LotoAudio/);

  // Bot đọc số tắt vẫn giữ cử động/bong bóng.
  assert.match(mascot, /if \(mascot\.botEnabled/);

  // Hook các sự kiện.
  assert.match(tv, /LotoMascot\.onNumberRevealed/);
  assert.match(tv, /LotoMascot\.onNearKinh/);
  assert.match(tv, /LotoMascot\.onKinh/);
  assert.match(tv, /LotoMascot\.onGameReset/);
  assert.match(tv, /LotoMascot\.applyState/);
  assert.match(tvHtml, /<script src="\/js\/mascot\.js"><\/script>/);
});

test('TV sound effects: Web Audio engine, four stages, stage hooks, autoplay unlock and toggle', () => {
  const audio = fs.readFileSync(path.join(frontend, 'js', 'audio.js'), 'utf8');
  const tv = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const tvHtml = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const tvCss = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');

  // No external audio files: synthesis only.
  assert.match(audio, /LotteryAudioEngine/);
  assert.match(audio, /createBufferSource\(\)/);
  assert.doesNotMatch(audio, /\.mp3|\.wav|new Audio\(/);
  assert.match(audio, /bandpass|lowpass/);
  // Stage 1 fade in/out; stage 2 800-1800Hz / 15-25ms; stage 3 envelope;
  // stage 4 double hit + 70ms bounce + ting.
  assert.match(audio, /linearRampToValueAtTime\(0\.2/);
  assert.match(audio, /stopTumble\(\)/);
  assert.match(audio, /800 \+ Math\.random\(\) \* 1000/);
  assert.match(audio, /now \+ 0\.02/);
  assert.match(audio, /startPipeRoll\(durationMs/);
  assert.match(audio, /this\.thump\(0\.07, 0\.16, 245\)/);
  assert.match(audio, /revealTing\(\)/);

  // Autoplay policy: resume on first gesture + speaker toggle button.
  assert.match(audio, /installUnlockHandlers/);
  assert.match(audio, /ctx\.state === 'suspended'/);
  assert.match(tvHtml, /id="tvAudioHint"/);
  assert.match(tvHtml, /Chạm vào màn hình để kích hoạt loa TV/);
  assert.match(tvHtml, /<script src="\/js\/audio\.js"><\/script>/);
  assert.match(tvCss, /\.tv-audio-hint/);
  assert.match(tv, /syncSfxState\(enabled\)/);
  assert.match(tv, /LotoAudio\.setEnabled/);
  assert.match(tv, /document\.addEventListener\('click', unlock/);

  // Stage hooks wired to the exact animation milestones.
  assert.match(tv, /Physics\.startRoll\(min \|\| 1, max \|\| 90, gameId, duration\)/);
  assert.match(tv, /LotoAudio\.startFan\(rollMs\)/);
  assert.match(tv, /LotoAudio\.startClacks\(rollMs\)/);
  assert.match(tv, /LotoAudio\.stopTumble\(\)/);
  assert.match(tv, /LotoAudio\.startPipeRoll\(ROLL_MS \* 0\.78\)/);
  assert.match(tv, /LotoAudio\.trayDrop\(\)/);
  assert.match(tv, /LotoAudio\.revealTing\(\)/);
  assert.match(tv, /LotoAudio\.stopAll\(\)/);
  assert.match(tv, /ROLL_MS = Math\.round\(rollMs \* 0\.78\)/);
  // Bot voice starts only after fan/clack fade-out completes.
  assert.match(host, /setTimeout\(\(\) => speakText\(announcement\.text, announcement\), 180\)/);
});

test('round settings: two ticket fields, real defaults, auto-save, in-round locks, timing and bot cadence', () => {
  const server = fs.readFileSync(path.join(frontend, '../backend/server.js'), 'utf8');
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'style.css'), 'utf8');

  // Two independent ticket fields with real defaults.
  assert.match(html, /Tổng kho vé phát hành/);
  assert.match(html, /id="cfgMaxPlayers"[^>]*value="200"/);
  assert.match(html, /Tối đa vé mỗi người/);
  assert.match(html, /id="cfgMaxPerPlayer"[^>]*value="3"/);
  assert.match(html, /id="cfgRoll"[^>]*value="4\.5"/);
  assert.match(html, /id="cfgAutoRoll"[^>]*value="9"/);
  assert.match(html, /id="cfgBet"[^>]*value="5000"/);
  assert.match(html, /id="cfgMaxWinners"[^>]*value="2"/);
  assert.match(server, /maxTicketsPerPlayer: 3/);
  assert.match(server, /maxWinners: 2/);
  assert.match(server, /rollSeconds: 4\.5/);
  assert.match(server, /autoRollSeconds: 9/);

  // Auto-save on blur/Enter with a fading "✓ Đã lưu" indicator.
  assert.match(html, /id="configSaved" class="config-saved"/);
  assert.match(host, /function flashSaved\(/);
  assert.match(host, /✓ Đã lưu/);
  assert.match(host, /addEventListener\('blur', \(\) => saveConfigField\(key\)\)/);
  assert.match(host, /event\.key === 'Enter'/);
  assert.match(host, /socket\.emit\('settings:update', \{ \[key\]: input\.value \}\)/);

  // Four hard-locked fields during a round; two timing fields stay editable.
  assert.equal((html.match(/class="field lockable"/g) || []).length, 4);
  assert.match(host, /LOCKED_CONFIG_FIELDS = \['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'\]/);
  assert.match(host, /function applyConfigLock\(/);
  assert.match(html, /Tự mở khóa khi Qua ván mới/);
  assert.match(css, /\.field\.is-locked input \{[^}]*cursor: not-allowed/);
  assert.match(server, /const LOCKED_FIELDS = \['betPerTicket', 'maxPlayers', 'maxTicketsPerPlayer', 'maxWinners'\]/);

  // autoRoll >= roll + 3.5 and bot speech cadence >= 2.5s.
  assert.match(host, /value < roll \+ 3\.5/);
  assert.match(server, /game\.config\.autoRollSeconds < game\.config\.rollSeconds \+ 3\.5/);
  assert.match(host, /socket\.emit\('bot:state'/);
  assert.match(server, /socket\.on\('bot:state'/);
  assert.match(server, /botEnabled \? 2500 : 400/);
});

test('Kinh progress keeps auto draw running; full limit settles, pays and opens TV honour board', () => {
  const server = fs.readFileSync(path.join(frontend, '../backend/server.js'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const tv = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const tvHtml = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const tvCss = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');

  // Continue auto draw when only 1/2 Kinh; stop when limit reached.
  assert.match(server, /if \(newKinh\.length && !reached\)/);
  assert.match(server, /io\.emit\('kinh:progress'/);
  assert.match(server, /Đang tiếp tục xổ/);
  assert.match(server, /const reached = limit > 0 \? game\.winners\.length >= limit : game\.winners\.length > 0/);
  assert.match(server, /setTimeout\(nextAutoDraw, botEnabled \? 2500 : 400\)/);
  assert.match(server, /io\.emit\('game:limit-reached'/);
  assert.match(server, /if \(settleGame\(\)\)/);
  assert.match(server, /account\.winnings \+= amount;/);
  assert.match(server, /account\.totalWon \+= amount;/);
  assert.match(server, /ticketRows: serializeRows\(ticket\)/);
  assert.match(host, /socket\.on\('kinh:progress'/);
  assert.match(tv, /socket\.on\('kinh:progress'/);

  // TV overlay: title, all winners, prize, mini ticket preview, confetti, scale-in.
  assert.match(tvHtml, /id="tvKinhOverlay"/);
  assert.match(tvHtml, /CHÚC MỪNG KINH!/);
  assert.match(tvHtml, /id="tvKinhWinners"/);
  assert.match(tvHtml, /id="tvConfetti"/);
  assert.match(tv, /function showKinhOverlay\(winners, per\)/);
  assert.match(tv, /function renderMiniTicket\(winner\)/);
  assert.match(tv, /is-kinh-row/);
  assert.match(tv, /socket\.on\('game:limit-reached'/);
  assert.match(tv, /socket\.on\('kinh:clear'/);
  assert.match(tvCss, /@keyframes kinhScaleIn/);
  assert.match(tvCss, /@keyframes kinhConfettiFall/);
  assert.match(tvCss, /\.kinh-mini-row\.is-kinh-row/);
  // Overlay is hidden again by the unified next-round flow.
  assert.match(server, /io\.emit\('kinh:clear'/);
});

test('winnings reward is separate from totalWon; leaderboard filters by totalWon; admin has reset-achievements and wipe-all-data', () => {
  const server = fs.readFileSync(path.join(frontend, '../backend/server.js'), 'utf8');
  const host = fs.readFileSync(path.join(frontend, 'js', 'host.js'), 'utf8');
  const tv = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');

  // totalWon default 0, added alongside reward (winnings) on a win.
  assert.match(server, /totalWon:\s*0/);
  assert.match(server, /account\.winnings \+= amount;/);
  assert.match(server, /account\.totalWon \+= amount;/);
  // Paying reward / offsetting debt only touches winnings, never totalWon.
  assert.match(server, /socket\.on\('admin:pay-reward'/);
  assert.match(server, /account\.winnings = 0;/);
  assert.match(server, /socket\.on\('admin:offset-debt'/);
  assert.match(server, /account\.winnings -= used;/);
  assert.match(server, /account\.debt -= used;/);

  // Leaderboard filters totalWon > 0 and sorts by totalWon.
  assert.match(server, /function leaderboard\(/);
  assert.match(server, /\.filter\(\(entry\) => entry\.totalWon > 0\)/);
  assert.match(server, /b\.totalWon - a\.totalWon/);
  assert.match(tv, /Chưa có ai ghi nhận thành tích/);
  assert.match(host, /Chưa có ai ghi nhận thành tích/);

  // Two distinct admin data-management buttons with confirms.
  assert.match(html, /id="btnResetAchievements"/);
  assert.match(html, /id="btnWipeAllData"/);
  assert.match(host, /admin:reset-achievements/);
  assert.match(host, /admin:wipe-all-data/);
  assert.match(server, /socket\.on\('admin:reset-achievements'/);
  assert.match(server, /account\.totalWon = 0/);
  assert.match(server, /socket\.on\('admin:wipe-all-data'/);
  assert.match(server, /writeJSON\(HISTORY_FILE, \[\]\)/);
  assert.match(host, /KHÔNG THỂ/); // strong warning on wipe
});

test('TV shows last drawn number centred above the cage with waiting state, pop zoom and ripple glow', () => {
  const html = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const script = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');

  // Markup sits between the cage title and the machine, with a fixed slot.
  assert.match(html, /id="tvLastDraw" class="tv-last-draw"/);
  assert.match(html, /<div class="tv-last-caption">SỐ VỪA XỔ<\/div>/);
  assert.match(html, /id="tvLastBall" class="tv-last-ball is-waiting"/);
  const iTitle = html.indexOf('LỒNG CẦU LÔ TÔ');
  const iLast = html.indexOf('id="tvLastDraw"');
  const iMachine = html.indexOf('id="tvMachine"');
  assert.ok(iTitle < iLast && iLast < iMachine, 'last-draw block must sit between title and cage');
  assert.match(css, /\.tv-last-draw\s*\{[^}]*min-height:\s*108px/s);
  assert.match(css, /\.tv-last-ball\s*\{[^}]*width:\s*72px[^}]*border:\s*3px solid #ffd977/s);
  assert.match(css, /\.tv-last-ball\.is-waiting/);

  // Zoom 0 -> 1.12 -> 1, opacity 0 -> 1, 450ms with spring easing.
  assert.match(css, /animation:\s*tvLastPop\s*\.45s cubic-bezier\(\.34, 1\.56, \.64, 1\)/);
  assert.match(css, /@keyframes tvLastPop/);
  assert.match(css, /scale\(1\.12\)/);
  // Ripple ring + ambient glow + 3-4 sparkles.
  assert.match(css, /tv-last-ripple/);
  assert.match(css, /tv-last-glow/);
  assert.match(css, /@keyframes tvLastRipple/);
  assert.match(css, /@keyframes tvLastGlow/);
  assert.match(css, /@keyframes tvLastSpark/);
  assert.equal((html.match(/tv-last-spark s[1-4]/g) || []).length, 4);

  // Re-trigger on every new result; reset on new game.
  assert.match(script, /function showLastDraw\(/);
  assert.match(script, /void ball\.offsetWidth/);
  assert.match(script, /ball\.classList\.add\('is-new'\)/);
  assert.match(script, /socket\.on\('draw:result'/);
  assert.match(script, /showLastDraw\(number\)/);
  assert.match(script, /function resetLastDraw\(/);
});

test('TV hides empty winner banner, uses BINGO, removes footer stats, and shows player lock state', () => {
  const html = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const script = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const css = fs.readFileSync(path.join(frontend, 'css', 'tv.css'), 'utf8');
  assert.match(html, /id="tvWinner" class="tv-winner hidden"/);
  assert.doesNotMatch(html, /Chưa có người kinh|Đang chờ người may mắn|<footer class="tv-footer"/i);
  assert.match(html, /CHÚC MỪNG KINH!/);
  assert.match(script, /Chưa có ai tham gia/);
  assert.match(script, /Chưa chốt/);
  assert.match(script, /Đã chốt/);
  assert.match(script, /tv-ticket-donut/);
  assert.match(script, /tv-ticket-check/);
  assert.match(script, /p\.waitingRows > 0/);
  assert.match(script, /Đợi \$\{p\.waitingRows\} hàng/);
  assert.doesNotMatch(script, /Còn \$\{p\.minRemaining/);
  assert.match(css, /@keyframes tvDonutSpin/);
  assert.match(css, /\.tv-near-bingo[^}]*font-size:\s*1\.2em/);
});

test('TV cage uses real Matter.js rigid-body physics, not random number arrays', () => {
  const html = fs.readFileSync(path.join(frontend, 'tv.html'), 'utf8');
  const script = fs.readFileSync(path.join(frontend, 'js', 'tv.js'), 'utf8');
  const server = fs.readFileSync(path.join(frontend, '../backend/server.js'), 'utf8');

  // Physics engine actually loaded and a canvas is provided to render bodies.
  assert.match(html, /matter\.min\.js/);
  assert.match(html, /id="tvPhysics"/);
  assert.match(script, /Engine\.create\(/);
  assert.match(script, /Engine\.update\(engine/);

  // High collision accuracy so fast-blown balls never tunnel through the cage.
  assert.match(script, /positionIterations:\s*4/);
  assert.match(script, /velocityIterations:\s*3/);

  // Cage is static colliders with a single gap of 2.2 * ball radius at the top.
  assert.match(script, /CAGE_GAP\s*=\s*BALL_R\s*\*\s*2\.2/);
  assert.match(script, /isStatic:\s*true[^}]*cage-wall/);

  // Tube & rail bore = 1.3 * ball diameter (2.6 * radius), matched together.
  assert.match(script, /TUBE_GAP\s*=\s*BALL_R\s*\*\s*2\.6/);
  assert.match(script, /RAIL_HALF\s*=\s*TUBE_GAP\s*\/\s*2/);
  // Curved tube joins the rail exactly at its left end; rail spans column 01..05
  // with no overhang, and drop-door necks touch each oval's top rim.
  assert.match(script, /\[420, 210\]/);
  assert.match(script, /RAIL_LEFT\s*=\s*SLOTS\.x/);
  assert.match(script, /RAIL_RIGHT\s*=\s*\(count\)/);
  assert.doesNotMatch(script, /RAIL_PAD/);
  assert.match(script, /CỔ CỬA THẢ|neckTop/);
  // Neck ends on the actual ellipse rim at neckDx (not the absolute top),
  // so no gap and no line piercing the oval interior.
  assert.match(script, /rimY\s*=\s*ovalCY\s*-\s*ry\s*\*\s*Math\.sqrt\(1\s*-\s*Math\.pow\(neckDx\s*\/\s*rx, 2\)\)/);

  // 90 unique numbers generated BY CODE (01..90), shuffled with Fisher-Yates,
  // each ball given a random rotation so they never stack in order.
  assert.match(script, /function generateNumbers\(/);
  assert.match(script, /for \(let n = min; n <= max; n\+\+\) nums\.push\(pad\(n\)\)/);
  assert.match(script, /new Set\(nums\)/);
  assert.match(script, /function shuffled\(/);
  assert.match(script, /for \(let i = a\.length - 1; i > 0; i--\)/);
  // Góc xoay lấy từ pool đã shuffle, KHÔNG gọi Math.random() riêng cho từng viên.
  assert.match(script, /const angles = shuffled\(/);
  assert.doesNotMatch(script, /Body\.setAngle\(ball, Math\.random\(\)/);
  assert.match(script, /restitution:\s*0\.85/);
  assert.match(script, /friction:\s*0\.00[0-9]/);

  // Gate opens by engine time; nearest ball to the gap is reported (no random array).
  assert.match(script, /gateOpenAt/);
  assert.match(script, /socket\.emit\('draw:physics-result'/);
  assert.match(script, /resultSent\s*=\s*true/);
  assert.match(script, /airUntil\s*=\s*0/);
  assert.match(script, /function emitBall\(/);

  // Short delivery tube + dynamic numbered slots (9 balls each, left -> right):
  // 5 by default, grow by one each time a slot fills, up to 10 (90 balls).
  assert.match(script, /const TUBE\s*=\s*\[/);
  assert.match(script, /const SLOTS\s*=\s*\{[^}]*minCount:\s*5[^}]*maxCount:\s*10[^}]*perSlot:\s*9/);
  assert.match(script, /Math\.ceil\([^\n]*SLOTS\.perSlot\)/);
  assert.match(script, /slotCount\s*\+=?\s*1/);
  assert.match(script, /< SLOTS\.perSlot/);

  // Continuous base plate + curved cradle; fan sits INSIDE the base blowing up
  // through a closed duct with a grille (gap smaller than a ball).
  assert.match(script, /function drawBase\(/);
  assert.match(script, /function drawCradle\(/);
  assert.match(script, /bottom-grille/);
  assert.match(script, /function drawFan\(/);
  assert.match(script, /fanAngle\s*\+=|rolling\)\s*fanAngle/);
  // Motor nằm ngang trong bệ, không còn hộp quạt quay mặt trước / vệt trắng.
  assert.match(script, /CỤM MOTOR \+ CÁNH QUẬT NẰM NGANG/);
  assert.match(script, /ctx\.scale\(1, Math\.max\(0\.15, Math\.abs\(Math\.cos\(fanAngle\)\)\)\)/);

  // Horizontal rail + 3 continuous phases; target cx computed dynamically at
  // emit, clamped (no overshoot), door opens only when the ball reaches cx.
  assert.match(script, /const RAIL_Y\s*=/);
  assert.match(script, /function doorState\(/);
  assert.match(script, /rail-wall/);
  assert.match(script, /k < 0\.42/);
  assert.match(script, /k < 0\.78/);
  assert.match(script, /rollingBall/);
  assert.match(script, /const CHUTE_END = \{ x: TUBE\[TUBE\.length - 1\]\[0\]/);
  assert.match(script, /const targetX = slotCenterX\(slot\)/);
  assert.match(script, /const dropPoint = slotDropPoint\(slot\)/);
  assert.match(script, /targetX,\s*dropPoint/);
  assert.match(script, /Math\.min\(targetX,/);
  assert.match(script, /if \(k < 0\.78 \|\| k >= 1\) return null/);

  // Layering: slot bodies first, moving ball in the middle, rail/oval rims last.
  assert.match(script, /function drawSlotBodies\(/);
  assert.match(script, /function drawSlotRims\(/);
  const iBodies = script.indexOf('drawSlotBodies();');
  const iBall = script.indexOf('if (rollingBall) {', iBodies);
  const iRims = script.indexOf('drawSlotRims();', iBall);
  assert.ok(iBodies >= 0 && iBall > iBodies && iRims > iBall, 'moving ball must be layered between bodies and rims');
  assert.doesNotMatch(script, /function catchBall\(/);
  assert.doesNotMatch(script, /function drawHand\(|function startHand\(/);

  // The server no longer picks a random number from an array for a draw.
  assert.doesNotMatch(server, /available\[Math\.floor\(Math\.random\(\)\s*\*\s*available\.length\)\]/);
  assert.match(server, /socket\.on\('draw:physics-result'/);
});

test('Vietnamese announcer pronounces numbers and uses varied playful callouts', () => {
  assert.equal(numberToVietnamese(0), 'không');
  assert.equal(numberToVietnamese(10), 'mười');
  assert.equal(numberToVietnamese(11), 'mười một');
  assert.equal(numberToVietnamese(21), 'hai mươi mốt');
  assert.equal(numberToVietnamese(25), 'hai mươi lăm');
  assert.equal(numberToVietnamese(90), 'chín mươi');
  assert.match(numberCallout(25, 0), /Bà con ơi.*hai mươi lăm/);
  assert.match(numberCallout(25, 1), /Lộc xuân.*hai mươi lăm/);
  assert.match(numberCallout(25, 2), /giơ tay/);
  assert.match(numberCallout(25, 3), /sân khấu/);
  assert.deepEqual(styles.map((style) => style.id), ['random', 'pop', 'rap', 'bolero', 'stage']);
  assert.match(announcement(21, 1).text, /Pop lên.*hai mươi mốt/);
  assert.equal(announcement(21, 2).rate, 1.18);
  assert.equal(announcement(21, 3).pitch, 0.96);
  assert.throws(() => numberToVietnamese(91), RangeError);
});
