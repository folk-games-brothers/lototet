#!/usr/bin/env node
/* ============================================================
   LOTO TET - TEST DASHBOARD SERVER (HTTP + SSE, không dùng thư viện ngoài)
   Chạy: node backend/test/ui-server.js  (mặc định http://localhost:3001)
   ============================================================ */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { run } = require('node:test');

const TEST_DIR = __dirname;
const BACKEND_DIR = path.resolve(TEST_DIR, '..');
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
const DASHBOARD = path.join(ROOT_DIR, 'frontend', 'test-dashboard.html');

// Danh mục test dùng cho cả /api/suites lẫn sidebar trên dashboard.
const SUITES = {
  all: {
    label: 'Chạy Toàn Bộ Kiểm Thử',
    typesLabel: '(Unit + Integration + Regression + Smoke + Concurrency + Load Test)',
    description: 'Chạy mọi file *.test.js trong backend/test.',
    files: null,
  },
  regression: {
    label: 'Chạy Tất Cả Regression',
    typesLabel: '(Unit + Integration + Smoke + Regression)',
    description: 'Gộp server + frontend + audio, không gồm concurrency/load.',
    files: ['server.test.js', 'frontend.test.js', 'audio.test.js'],
  },
  server: {
    label: 'Nghiệp vụ Máy chủ',
    typesLabel: '(Unit & Integration — Chia giải đồng Kinh, cấn nợ, khóa cài đặt ván, luật chơi TV, kiểm tra dữ liệu rác)',
    description: 'Luồng xổ số, ví tiền, lịch sử và cài đặt ván.',
    file: 'server.test.js', files: ['server.test.js'],
  },
  frontend: {
    label: 'Giao diện & Đồng bộ',
    typesLabel: '(Integration & Smoke — Màn hình TV, Admin, Người chơi, MC Dê Lửa 2027, bảng luật chơi)',
    description: 'Kiểm tra tĩnh cấu trúc TV/Admin/Player và mascot.',
    file: 'frontend.test.js', files: ['frontend.test.js'],
  },
  audio: {
    label: 'Hệ thống Âm thanh',
    typesLabel: '(Unit & Regression — Web Audio 4 lớp gió/banh, Audio Ducking, mở khóa Autoplay)',
    description: 'LotteryAudioEngine: fan, clack, pipe, tray, ducking.',
    file: 'audio.test.js', files: ['audio.test.js'],
  },
  concurrency: {
    label: 'Chống Xung đột Vé & Tiền',
    typesLabel: '(Concurrency & Spike — 10 người giành 1 vé V001, chống bấm đúp chốt vé/trả thưởng)',
    description: 'Race condition, chốt muộn, đồng Kinh vượt max.',
    file: 'concurrency.test.js', files: ['concurrency.test.js'],
  },
  load: {
    label: 'Giả lập Phòng đông',
    typesLabel: '(Load & Stress — Đo độ trễ Avg / p95 / p99, kiểm tra nghẽn mạng & đối soát tiền giải)',
    description: 'Chạy load-test.js với N bot, tự bật/tắt server 3000.',
    file: 'load-test.js', files: ['load-test.js'],
  },
};
const SUITE_LIST = Object.entries(SUITES).map(([id, suite]) => ({
  id, label: suite.label, typesLabel: suite.typesLabel,
  description: suite.description, file: suite.file || null,
}));

function categoryFor(file, name) {
  if (file === 'concurrency.test.js') return 'Concurrency';
  if (file === 'audio.test.js') return 'Unit';
  if (file === 'frontend.test.js') return 'Regression';
  if (file === 'server.test.js') return 'Integration';
  if (file === 'load-test.js') return 'Load';
  return /regression/i.test(String(name)) ? 'Regression' : 'Integration';
}

function openBrowser(url) {
  const target = url;
  try {
    let child;
    if (process.platform === 'darwin') child = spawn('open', [target], { stdio: 'ignore', detached: true });
    else if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '', `"${target}"`], { stdio: 'ignore', detached: true });
    else child = spawn('xdg-open', [target], { stdio: 'ignore', detached: true });
    if (child && child.on) child.on('error', () => {});
    if (child && child.unref) child.unref();
  } catch (error) {
    console.error('Không mở được trình duyệt:', error.message);
  }
}

function isPortOpen(port, host = '127.0.0.1', timeout = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(res, event) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function runTestSuite(res, suite, startedAt) {
  const meta = SUITES[suite] || SUITES.all;
  let files = meta.files;
  if (files === null) files = fs.readdirSync(TEST_DIR).filter((file) => file.endsWith('.test.js')).sort();
  const fileList = files.map((file) => path.join(TEST_DIR, file));
  let total = 0, completed = 0, passed = 0, failed = 0;
  let currentFile = files[0] || '';
  let currentTestName = '';
  const diagnostics = new Map();

  const progress = (extra = {}) => {
    const percent = Math.min(99, Math.round((completed / Math.max(total, 1)) * 100));
    send(res, {
      type: 'progress', suite,
      label: meta.label, typesLabel: meta.typesLabel,
      total, completed, percent,
      currentTestName, category: currentTestName ? categoryFor(currentFile, currentTestName) : null,
      ...extra,
    });
  };

  send(res, {
    type: 'run:start', suite, files, startedAt,
    label: meta.label, typesLabel: meta.typesLabel,
  });
  progress();

  try {
    const tests = run({ files: fileList });
    for await (const event of tests) {
      const data = event.data || {};
      if (event.type === 'test:enqueue') {
        if (/\.test\.js$/.test(String(data.name))) currentFile = path.basename(String(data.name));
        else { total++; progress(); }
      } else if (event.type === 'test:start') {
        currentTestName = String(data.name || '');
        diagnostics.set(currentTestName, []);
        send(res, { type: 'test:start', file: currentFile, name: currentTestName,
          category: categoryFor(currentFile, currentTestName) });
        progress();
      } else if (event.type === 'test:diagnostic') {
        const message = String(data.message || '');
        const isSummary = /^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(message);
        const name = isSummary ? null : [...diagnostics.keys()].reverse()[0] || null;
        if (name) diagnostics.get(name).push(message);
        send(res, { type: 'test:diagnostic', file: currentFile, name, message });
      } else if (event.type === 'test:pass' || event.type === 'test:fail') {
        completed++;
        const isPass = event.type === 'test:pass';
        if (isPass) passed++; else failed++;
        const error = data.error || {};
        const payload = {
          type: event.type, file: currentFile, name: data.name,
          category: categoryFor(currentFile, data.name),
          durationMs: data.duration_ms || 0,
          diagnostics: diagnostics.get(data.name) || [],
        };
        if (!isPass) {
          payload.error = {
            message: error.message || String(error),
            expected: error.expected,
            actual: error.actual,
            stack: error.stack ? String(error.stack) : '',
          };
        }
        progress();
        send(res, payload);
      }
    }
  } catch (error) {
    failed++; completed++;
    send(res, {
      type: 'test:fail', file: currentFile, name: 'Runner', category: 'Integration',
      durationMs: 0, diagnostics: [],
      error: { message: error.message, expected: null, actual: null, stack: String(error.stack || '') },
    });
  }
  total = Math.max(total, completed);
  progress({ percent: 100 });
  const done = {
    type: 'run:done', suite, passed, failed,
    total, completed, percent: 100,
    durationMs: Date.now() - startedAt,
    suites: SUITE_LIST,
  };
  send(res, done);
  send(res, { ...done, type: 'done' });
  res.end();
}

function parseLoadMetrics(lines) {
  const text = lines.join('\n');
  const num = (re) => { const m = text.match(re); return m ? Number(m[1].replace(/[^\d.]/g, '')) : 0; };
  const triple = (re) => {
    const m = text.match(re);
    if (!m) return { avg: 0, p95: 0, p99: 0 };
    return { avg: Number(m[1]), p95: Number(m[2]), p99: Number(m[3]) };
  };
  return {
    success: num(/Tổng request thành công\s+(\d+)/),
    fail: num(/Tổng request thất bại\s+(\d+)/),
    errorRate: num(/Tỷ lệ lỗi\s+([\d.]+)%/),
    lock: triple(/Chốt vé · trung bình \/ p95 \/ p99\s+(\d+)ms \/ (\d+)ms \/ (\d+)ms/),
    draw: triple(/Kết quả xổ · trung bình \/ p95 \/ p99\s+(\d+)ms \/ (\d+)ms \/ (\d+)ms/),
    locked: num(/Vé đã chốt \/ kỳ vọng\s+(\d+)/),
    prize: num(/Tổng giải \/ tiền thu\s+(\d+)đ/),
    draws: num(/Số lượt xổ\s+(\d+)/),
    consistent: /✅ ĐẠT/.test(text),
  };
}

async function runLoadTest(res, users, startedAt) {
  const url = 'http://localhost:3000';
  const meta = SUITES.load;
  const wasRunning = await isPortOpen(3000);
  let tempServer = null;
  const lines = [];
  let lastProgressAt = 0;
  let pendingProgress = null;
  let progressTimer = null;
  const sendProgress = (percent, stage = '', extra = {}) => {
    const payload = {
      type: 'progress', suite: 'load', label: meta.label, typesLabel: meta.typesLabel,
      total: 1, completed: 0, percent, currentTestName: stage, category: 'Load', ...extra,
    };
    const wait = 150 - (Date.now() - lastProgressAt);
    if (wait <= 0) {
      lastProgressAt = Date.now();
      send(res, payload);
    } else {
      pendingProgress = payload;
      if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = null;
          if (pendingProgress) {
            lastProgressAt = Date.now();
            send(res, pendingProgress);
            pendingProgress = null;
          }
        }, wait);
      }
    }
  };
  const flushProgress = () => {
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    if (pendingProgress) { send(res, pendingProgress); pendingProgress = null; }
  };

  send(res, {
    type: 'run:start', suite: 'load', files: ['load-test.js'], startedAt, users,
    label: meta.label, typesLabel: meta.typesLabel,
  });
  sendProgress(10, 'Khởi tạo');

  try {
    if (!wasRunning) {
      send(res, { type: 'load:log', line: '⚡ Chưa có server trên cổng 3000 - khởi động server tạm...' });
      tempServer = spawn(process.execPath, ['server.js'], {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          ADMIN_PASSWORD_SALT: 'test-salt',
          ADMIN_PASSWORD_HASH: require('node:crypto')
            .scryptSync('test123', 'test-salt', 32).toString('hex'),
        },
        stdio: 'ignore',
      });
      for (let i = 0; i < 60; i++) {
        try { const response = await fetch(`${url}/api/state`); if (response.ok) break; } catch {}
        await delay(100);
      }
    }
    const child = spawn(process.execPath, [
      path.join(TEST_DIR, 'load-test.js'), '--players', String(users), '--url', url,
    ], { cwd: ROOT_DIR });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const onData = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
        if (line.startsWith('__PROGRESS__:')) {
          try {
            const p = JSON.parse(line.slice(13));
            const stage = { init: 'Khởi tạo', joined: 'Bot tham gia & nạp tiền', locked: 'Chốt vé', draw: `Quay số · lượt ${p.draws || 0}` }[p.stage] || p.stage || '';
            sendProgress(p.percent || 0, stage, { draws: p.draws || 0 });
          } catch (e) {}
          continue;
        }
        send(res, { type: 'load:log', line });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const code = await new Promise((resolve) => child.on('close', resolve));
    flushProgress();
    sendProgress(100, 'Đối soát tiền giải');
    const parsed = parseLoadMetrics(lines);
    const metrics = {
      ...parsed,
      users, tickets: parsed.locked,
      avg: parsed.lock.avg, p95: parsed.lock.p95, p99: parsed.lock.p99,
      drawAvg: parsed.draw.avg, drawP95: parsed.draw.p95, drawP99: parsed.draw.p99,
    };
    send(res, {
      type: 'load:metrics', users, metrics, code,
      input: { users, url, autoStartedServer: !wasRunning },
      output: metrics,
    });
    const done = {
      type: 'run:done', suite: 'load',
      passed: code === 0 && metrics.consistent ? 1 : 0,
      failed: code === 0 && metrics.consistent ? 0 : 1,
      total: 1, completed: 1, percent: 100,
      durationMs: Date.now() - startedAt, suites: SUITE_LIST,
    };
    send(res, done);
    send(res, { ...done, type: 'done' });
  } catch (error) {
    send(res, { type: 'load:log', line: `❌ ${error.message}` });
    const done = { type: 'run:done', suite: 'load', passed: 0, failed: 1,
      total: 1, completed: 1, percent: 100, durationMs: Date.now() - startedAt, suites: SUITE_LIST };
    send(res, done);
    send(res, { ...done, type: 'done' });
  } finally {
    if (tempServer && !tempServer.killed) tempServer.kill('SIGTERM');
    res.end();
  }
}

function serveDashboard(res) {
  fs.readFile(DASHBOARD, 'utf8', (error, content) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Không tìm thấy frontend/test-dashboard.html');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  });
}

function startServer(startPort, attempt = 0) {
  const port = startPort + attempt;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/' || url.pathname === '/test-dashboard.html' || url.pathname === '/index.html') {
      return serveDashboard(res);
    }
    if (url.pathname === '/api/suites') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ suites: SUITE_LIST }));
      return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/api/run') {
      const suite = url.searchParams.get('suite') || 'all';
      const users = Number(url.searchParams.get('users')) || 50;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (res.flushHeaders) res.flushHeaders();
      const startedAt = Date.now();
      if (suite === 'load') runLoadTest(res, users, startedAt);
      else runTestSuite(res, suite, startedAt);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < 20) {
      console.log(`Cổng ${port} đang dùng, thử ${port + 1}...`);
      startServer(startPort, attempt + 1);
    } else {
      console.error('Không thể khởi động Test Dashboard:', error.message);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const lan = (() => {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
      }
      return 'localhost';
    })();
    const url = `http://localhost:${port}`;
    console.log('========================================================');
    console.log('  🧪 LÔ TÔ TẾT - TEST DASHBOARD');
    console.log(`  Local: ${url}`);
    console.log(`  LAN  : http://${lan}:${port}`);
    console.log('========================================================');
    if (!process.env.NO_BROWSER) openBrowser(url);
  });
}

startServer(Number(process.env.PORT) || 3001);
