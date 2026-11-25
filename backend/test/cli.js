#!/usr/bin/env node
/* ============================================================
   LOTO TET - MENU CHẠY TEST TƯƠNG TÁC TRÊN TERMINAL
   Chỉ dùng module có sẵn của Node.js: readline, child_process,
   fs, path, net (không cài thêm thư viện).
   ============================================================ */
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const TEST_DIR = __dirname;
const BACKEND_DIR = path.resolve(TEST_DIR, '..');
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = `http://localhost:${PORT}`;

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};

const DESCRIPTIONS = {
  'server.test.js': 'Nghiệp vụ máy chủ (đăng nhập, xổ số, ví, lịch sử)',
  'frontend.test.js': 'Giao diện TV / Admin / Player (kiểm tra tĩnh)',
  'audio.test.js': 'Âm thanh lồng cầu (Web Audio API)',
  'concurrency.test.js': 'Chống trùng vé & race condition',
};

function clearScreen() { process.stdout.write('\x1b[2J\x1b[H'); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function pad(text, length) { return String(text) + ' '.repeat(Math.max(0, length - String(text).length)); }

function findTestFiles() {
  return fs.readdirSync(TEST_DIR)
    .filter((file) => file.endsWith('.test.js'))
    .sort();
}

function buildItems() {
  const items = [{
    label: 'Chạy TOÀN BỘ test tự động (node --test backend/test/*.test.js)',
    kind: 'all',
  }];
  for (const file of findTestFiles()) {
    items.push({
      label: `${pad(file, 24)} - ${DESCRIPTIONS[file] || 'Bài kiểm tra tự động'}`,
      kind: 'test',
      file,
    });
  }
  items.push({ label: 'Load Test - giả lập phòng đông (nhập số người chơi ảo)', kind: 'load' });
  items.push({ label: 'Thoát', kind: 'exit' });
  return items;
}

function renderMenu(items, selected) {
  clearScreen();
  const rule = `${C.gold}════════════════════════════════════════════════════${C.reset}`;
  console.log(rule);
  console.log(`  ${C.bold}${C.red}🧧 LÔ TÔ TẾT - MENU CHẠY TEST${C.reset}`);
  console.log(`  ${C.dim}↑/↓ chọn · Enter chạy · gõ số 1-9 chọn nhanh · 0 hoặc q thoát${C.reset}`);
  console.log(rule);
  items.forEach((item, index) => {
    const marker = index === selected ? `${C.green}▶${C.reset}` : ' ';
    const no = index === 0 ? '1' : String(index + 1);
    const color = index === selected ? C.bold + C.cyan : C.dim;
    console.log(`  ${marker} ${color}${pad(no + '.', 4)} ${item.label}${C.reset}`);
  });
  console.log(rule);
}

// Chọn bằng mũi tên / Enter hoặc gõ trực tiếp phím số.
function choose(items) {
  return new Promise((resolve) => {
    let selected = 0;
    const usingRaw = !!process.stdin.isTTY;
    readline.emitKeypressEvents(process.stdin);
    if (usingRaw) process.stdin.setRawMode(true);
    process.stdin.resume();
    renderMenu(items, selected);

    const finish = (value) => {
      process.stdin.off('keypress', onKey);
      if (usingRaw) process.stdin.setRawMode(false);
      resolve(value);
    };
    const onKey = (text, key) => {
      if (key && key.ctrl && key.name === 'c') { finish(null); return; }
      if (key && key.name === 'up') {
        selected = (selected - 1 + items.length) % items.length;
        renderMenu(items, selected);
      } else if (key && key.name === 'down') {
        selected = (selected + 1) % items.length;
        renderMenu(items, selected);
      } else if (key && key.name === 'return') {
        finish(items[selected]);
      } else if (text === '0' || text === 'q' || text === 'Q') {
        finish(null);
      } else if (/^[1-9]$/.test(text)) {
        const index = Number(text) - 1;
        if (index < items.length) finish(items[index]);
      }
    };
    process.stdin.on('keypress', onKey);
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

function waitEnter() {
  process.stdout.write(`\n  ${C.dim}Nhấn Enter để quay lại menu...${C.reset} `);
  return ask('');
}

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`\n  ${C.red}Lỗi khởi chạy: ${error.message}${C.reset}`);
      resolve({ code: 1, ms: Date.now() - started });
    });
    child.on('close', (code) => resolve({ code, ms: Date.now() - started }));
  });
}

async function portIsOpen(port, host = '127.0.0.1', timeout = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function waitForServer(url, child) {
  for (let i = 0; i < 60; i++) {
    if (child && child.exitCode !== null) throw new Error('Server tạm thoát trước khi sẵn sàng');
    try {
      const response = await fetch(`${url}/api/state`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Server không sẵn sàng sau 6 giây');
}

async function runLoadTest() {
  const answer = await ask(`  ${C.cyan}Số người chơi ảo [50, Enter để dùng mặc định]:${C.reset} `);
  const players = Number(String(answer).trim()) || 50;
  const wasRunning = await portIsOpen(PORT);
  let tempServer = null;
  try {
    if (!wasRunning) {
      console.log(`\n  ${C.gold}⚡ Chưa có server trên cổng ${PORT} - khởi động server tạm...${C.reset}`);
      tempServer = spawn(process.execPath, [path.join(BACKEND_DIR, 'server.js')], {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          PORT: String(PORT),
          ADMIN_PASSWORD_SALT: 'test-salt',
          ADMIN_PASSWORD_HASH: crypto.scryptSync('test123', 'test-salt', 32).toString('hex'),
        },
        stdio: 'ignore',
      });
      await waitForServer(BASE_URL, tempServer);
      console.log(`  ${C.green}✓ Server tạm đã sẵn sàng${C.reset}`);
    } else {
      console.log(`\n  ${C.green}✓ Dùng server đang chạy tại ${BASE_URL}${C.reset}`);
    }

    const result = await runNode([
      path.join(TEST_DIR, 'load-test.js'),
      '--players', String(players),
      '--url', BASE_URL,
    ], ROOT_DIR);
    console.log(`\n  ${result.code === 0 ? C.green + '✓ Load test ĐẠT' : C.red + '✗ Load test KHÔNG ĐẠT'}${C.reset} · ${result.ms}ms`);
  } catch (error) {
    console.error(`\n  ${C.red}✗ ${error.message}${C.reset}`);
  } finally {
    if (tempServer && !tempServer.killed) tempServer.kill('SIGTERM');
  }
}

async function main() {
  const items = buildItems();
  while (true) {
    const choice = await choose(items);
    if (!choice || choice.kind === 'exit') break;

    let result;
    if (choice.kind === 'all') {
      const files = findTestFiles().map((file) => path.join('test', file));
      console.log(`\n  ${C.cyan}$ node --test ${files.join(' ')}${C.reset}`);
      result = await runNode(['--test', ...files], BACKEND_DIR);
    } else if (choice.kind === 'test') {
      console.log(`\n  ${C.cyan}$ node --test ${path.join('test', choice.file)}${C.reset}`);
      result = await runNode(['--test', path.join('test', choice.file)], BACKEND_DIR);
    } else {
      await runLoadTest();
      await waitEnter();
      continue;
    }

    const color = result.code === 0 ? C.green : C.red;
    const label = result.code === 0 ? '✓ THÀNH CÔNG' : '✗ THẤT BẠI';
    console.log(`\n  ${color}${label}${C.reset} · mã ${result.code} · ${result.ms}ms`);
    await waitEnter();
  }
  clearScreen();
  console.log(`  ${C.gold}Hẹn gặp lại!${C.reset}\n`);
}

main().catch((error) => {
  console.error(`\n  ${C.red}Lỗi menu: ${error.message}${C.reset}`);
  process.exit(1);
});
