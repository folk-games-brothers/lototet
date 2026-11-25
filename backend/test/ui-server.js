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

const SUITES = {
  all: null,
  server: ['server.test.js'],
  frontend: ['frontend.test.js'],
  audio: ['audio.test.js'],
  concurrency: ['concurrency.test.js'],
};
const DESCRIPTIONS = {
  'server.test.js': 'Nghiệp vụ máy chủ',
  'frontend.test.js': 'Giao diện TV / Admin / Player',
  'audio.test.js': 'Âm thanh lồng cầu',
  'concurrency.test.js': 'Chống trùng vé & race condition',
};

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
  let files = SUITES[suite];
  if (!files && suite !== 'all') files = [suite];
  if (suite === 'all' || files === null) {
    files = fs.readdirSync(TEST_DIR).filter((file) => file.endsWith('.test.js')).sort();
  }
  const fileList = files.map((file) => path.join(TEST_DIR, file));
  send(res, { type: 'run:start', suite, files, startedAt });

  let currentFile = files[0] || '';
  const diagnostics = new Map();
  let passed = 0;
  let failed = 0;

  try {
    const tests = run({ files: fileList });
    for await (const event of tests) {
      const data = event.data || {};
      if (event.type === 'test:enqueue' && /\.test\.js$/.test(String(data.name))) {
        currentFile = path.basename(String(data.name));
      } else if (event.type === 'test:start') {
        diagnostics.set(data.name, []);
        send(res, { type: 'test:start', file: currentFile, name: data.name });
      } else if (event.type === 'test:diagnostic') {
        const message = String(data.message || '');
        const isSummary = /^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(message);
        const name = isSummary ? null : [...diagnostics.keys()].reverse()[0] || null;
        const list = name ? diagnostics.get(name) : null;
        if (list) list.push(message);
        send(res, { type: 'test:diagnostic', file: currentFile, name, message });
      } else if (event.type === 'test:pass') {
        passed++;
        send(res, {
          type: 'test:pass', file: currentFile, name: data.name,
          durationMs: data.duration_ms || 0,
          diagnostics: diagnostics.get(data.name) || [],
        });
      } else if (event.type === 'test:fail') {
        failed++;
        const error = data.error || {};
        send(res, {
          type: 'test:fail', file: currentFile, name: data.name,
          durationMs: data.duration_ms || 0,
          error: {
            message: error.message || String(error),
            expected: error.expected,
            actual: error.actual,
            stack: error.stack ? String(error.stack) : '',
          },
          diagnostics: diagnostics.get(data.name) || [],
        });
      }
    }
  } catch (error) {
    failed++;
    send(res, {
      type: 'test:fail', file: currentFile, name: 'Runner',
      durationMs: 0,
      error: { message: error.message, expected: null, actual: null, stack: String(error.stack || '') },
      diagnostics: [],
    });
  }
  send(res, {
    type: 'run:done', suite, passed, failed,
    durationMs: Date.now() - startedAt,
    fileDescriptions: DESCRIPTIONS,
  });
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
  const wasRunning = await isPortOpen(3000);
  let tempServer = null;
  const lines = [];
  send(res, { type: 'run:start', suite: 'load', files: ['load-test.js'], startedAt, users });

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
        send(res, { type: 'load:log', line });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const code = await new Promise((resolve) => child.on('close', resolve));
    const metrics = parseLoadMetrics(lines);
    send(res, {
      type: 'load:metrics', users, metrics, code,
      input: { users, url, autoStartedServer: !wasRunning },
      output: metrics,
    });
    send(res, {
      type: 'run:done', suite: 'load',
      passed: code === 0 && metrics.consistent ? 1 : 0,
      failed: code === 0 && metrics.consistent ? 0 : 1,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    send(res, { type: 'load:log', line: `❌ ${error.message}` });
    send(res, { type: 'run:done', suite: 'load', passed: 0, failed: 1, durationMs: Date.now() - startedAt });
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
