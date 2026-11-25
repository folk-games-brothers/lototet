/* ============================================================
   LÔ TÔ TẾT - LotteryAudioEngine
   Hiệu ứng âm thanh lồng cầu được tổng hợp trực tiếp bằng Web Audio API.
   Không phụ thuộc file mp3/wav bên ngoài.
   ============================================================ */
(function exposeAudioEngine(root) {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));

  class LotteryAudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
      this.enabled = true;
      this.fan = null;
      this.fanTimer = null;
      this.clackTimer = null;
      this.clackDeadline = 0;
      this.pipe = null;
      this.pipeTimer = null;
      this.unlocked = false;
      this.ducked = false;
      this.clackLevel = 0.24;
    }

    /* ---------- Hạ tầng ---------- */
    ensureContext() {
      if (this.ctx) return this.ctx;
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      if (this.ctx.destination) this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(2);
      return this.ctx;
    }

    // Nhiễu trắng được làm ấm bằng bộ lọc một cực (pink-ish) rồi dùng lại cho quạt/ống.
    createNoiseBuffer(seconds) {
      const ctx = this.ctx;
      if (!ctx || !ctx.createBuffer) return null;
      const length = Math.max(1, Math.floor((ctx.sampleRate || 44100) * seconds));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
      }
      return buffer;
    }

    noiseSource() {
      const ctx = this.ensureContext();
      if (!ctx || !this.noiseBuffer) return null;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      return src;
    }

    // Autoplay policy: resume ngay lần tương tác đầu tiên trên trang.
    unlock() {
      const ctx = this.ensureContext();
      if (!ctx) return false;
      this.unlocked = true;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
      return true;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master && this.master.gain) this.master.gain.value = this.enabled ? 0.9 : 0;
      if (!this.enabled) this.stopAll();
      else this.unlock();
      return this.enabled;
    }

    isEnabled() { return !!this.enabled; }

    // Audio ducking: giảm tiếng quạt + va đập xuống ~35% khi Dê Lửa hát.
    setDuck(on) {
      this.ducked = !!on;
      this.clackLevel = this.ducked ? 0.084 : 0.24;
      if (this.fan && this.fan.gain) {
        const ctx = this.ctx;
        const now = ctx ? ctx.currentTime || 0 : 0;
        const target = this.ducked ? 0.07 : 0.2;
        try {
          this.fan.gain.gain.cancelScheduledValues(now);
          this.fan.gain.gain.setValueAtTime(this.fan.gain.gain.value || 0, now);
          this.fan.gain.gain.linearRampToValueAtTime(target, now + 0.15);
        } catch (e) { /* đã dừng */ }
      }
      return this.ducked;
    }

    /* ---------- Giai đoạn 1: gió quạt ---------- */
    startFan(durationMs = 3000) {
      const ctx = this.ensureContext();
      const src = this.noiseSource();
      if (!ctx || !src || !this.enabled) return false;
      this.stopFan(40);
      const now = ctx.currentTime || 0;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 420;
      bandpass.Q.value = 0.75;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1150;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      const fadeIn = clamp(Number(durationMs) / 1000 * 0.28, 0.12, 0.7);
      gain.gain.linearRampToValueAtTime(0.2, now + fadeIn);

      src.connect(bandpass);
      bandpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(this.master);
      src.start(now);
      this.fan = { src, gain, bandpass, lowpass };

      // Đảm bảo tắt ngay cả khi ván bị hủy / không có viên bi thoát ra.
      this.fanTimer = setTimeout(() => this.stopFan(120), Math.max(0, Number(durationMs) - 120));
      return true;
    }

    stopFan(fadeMs = 90) {
      if (this.fanTimer) { clearTimeout(this.fanTimer); this.fanTimer = null; }
      const fan = this.fan;
      this.fan = null;
      if (!fan) return;
      const ctx = this.ctx;
      const now = ctx ? ctx.currentTime || 0 : 0;
      const seconds = clamp(Number(fadeMs) / 1000, 0.01, 0.5);
      try {
        fan.gain.gain.cancelScheduledValues(now);
        fan.gain.gain.setValueAtTime(fan.gain.gain.value || 0, now);
        fan.gain.gain.linearRampToValueAtTime(0, now + seconds);
        fan.src.stop(now + seconds + 0.02);
      } catch (e) { /* nguồn đã dừng thì bỏ qua */ }
    }

    /* ---------- Giai đoạn 2: banh va đập trong lồng ---------- */
    clack() {
      const ctx = this.ensureContext();
      if (!ctx || !this.enabled) return false;
      const now = ctx.currentTime || 0;
      const freq = 800 + Math.random() * 1000;          // 800Hz - 1800Hz
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.62, now + 0.02);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(this.clackLevel || 0.24, now + 0.003);
      // Xung tắt nhanh trong 15-25ms.
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.025);
      return true;
    }

    startClacks(durationMs = 3000) {
      if (!this.enabled) return false;
      this.stopClacks();
      const deadline = Date.now() + clamp(Number(durationMs) - 150, 100, 20000);
      this.clackDeadline = deadline;
      const tick = () => {
        if (!this.enabled || Date.now() > this.clackDeadline) { this.stopClacks(); return; }
        this.clack();
        this.clackTimer = setTimeout(tick, 70 + Math.random() * 170);
      };
      this.clackTimer = setTimeout(tick, 80);
      return true;
    }

    stopClacks() {
      if (this.clackTimer) clearTimeout(this.clackTimer);
      this.clackTimer = null;
      this.clackDeadline = 0;
    }

    // Gọi ngay khi viên bi được hút lên cổ ống: gió + va đập phải tắt hẳn
    // trước khi Bot đọc số phát âm (draw:result được gửi cùng khoảnh khắc này).
    stopTumble() {
      this.stopFan(70);
      this.stopClacks();
    }

    /* ---------- Giai đoạn 3: bi lăn trong ống & đường ray ---------- */
    startPipeRoll(durationMs = 2000) {
      const ctx = this.ensureContext();
      const src = this.noiseSource();
      if (!ctx || !src || !this.enabled) return false;
      this.stopPipeRoll(40);
      const now = ctx.currentTime || 0;
      const seconds = clamp(Number(durationMs) / 1000, 0.2, 12);
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 560;
      bandpass.Q.value = 2.4;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1500;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.13, now + 0.05);
      gain.gain.setValueAtTime(0.13, now + Math.max(0.06, seconds - 0.14));
      gain.gain.linearRampToValueAtTime(0, now + seconds);

      // Rung nhẹ để tiếng lăn nghe rỗng chứ không phải tiếng gió phẳng.
      let lfo = null;
      if (ctx.createOscillator && ctx.createGain) {
        lfo = ctx.createOscillator();
        lfo.frequency.value = 8;
        const depth = ctx.createGain();
        depth.gain.value = 0.025;
        lfo.connect(depth);
        depth.connect(gain.gain);
        lfo.start(now);
      }
      src.connect(bandpass);
      bandpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(this.master);
      src.start(now);
      this.pipe = { src, gain, bandpass, lowpass, lfo };
      this.pipeTimer = setTimeout(() => this.stopPipeRoll(60), seconds * 1000 + 40);
      return true;
    }

    stopPipeRoll(fadeMs = 60) {
      if (this.pipeTimer) { clearTimeout(this.pipeTimer); this.pipeTimer = null; }
      const pipe = this.pipe;
      this.pipe = null;
      if (!pipe) return;
      const ctx = this.ctx;
      const now = ctx ? ctx.currentTime || 0 : 0;
      const seconds = clamp(Number(fadeMs) / 1000, 0.01, 0.5);
      try {
        pipe.gain.gain.cancelScheduledValues(now);
        pipe.gain.gain.setValueAtTime(pipe.gain.gain.value || 0, now);
        pipe.gain.gain.linearRampToValueAtTime(0, now + seconds);
        pipe.src.stop(now + seconds + 0.02);
        if (pipe.lfo) pipe.lfo.stop(now + seconds + 0.02);
      } catch (e) { /* đã dừng */ }
    }

    /* ---------- Giai đoạn 4: rơi vào cột + ting lên số ---------- */
    thump(atOffset, level, frequency) {
      const ctx = this.ensureContext();
      if (!ctx || !this.enabled) return false;
      const at = (ctx.currentTime || 0) + atOffset;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, at);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.55, at + 0.09);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(at);
      osc.stop(at + 0.13);
      return true;
    }

    trayDrop() {
      // "Cộp" chính + tiếng nảy phụ nhỏ hơn sau ~70ms.
      this.thump(0, 0.34, 190);
      this.thump(0.07, 0.16, 245);
    }

    revealTing() {
      const ctx = this.ensureContext();
      if (!ctx || !this.enabled) return false;
      const now = ctx.currentTime || 0;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, now);
      osc.frequency.linearRampToValueAtTime(1180, now + 0.45);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.17, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.52);
      return true;
    }

    stopAll() {
      this.stopFan(40);
      this.stopClacks();
      this.stopPipeRoll(40);
    }
  }

  function installUnlockHandlers(engine, target) {
    if (!target || !target.addEventListener) return;
    const events = ['pointerdown', 'touchstart', 'click', 'keydown'];
    const unlock = () => {
      engine.unlock();
      events.forEach((name) => target.removeEventListener(name, unlock, true));
    };
    events.forEach((name) => target.addEventListener(name, unlock, { capture: true }));
  }

  const engine = new LotteryAudioEngine();
  root.LotteryAudioEngine = LotteryAudioEngine;
  root.LotoAudio = engine;
  installUnlockHandlers(engine, root);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LotteryAudioEngine;
    module.exports.installUnlockHandlers = installUnlockHandlers;
  }
})(typeof window !== 'undefined' ? window : globalThis);
