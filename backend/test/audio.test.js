const assert = require('node:assert/strict');
const { test } = require('node:test');

class FakeParam {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}
class FakeNode {
  constructor(kind, ctx) {
    this.kind = kind;
    this.type = kind;
    this.ctx = ctx;
    this.connections = [];
    this.gain = new FakeParam();
    this.frequency = new FakeParam();
    this.detune = new FakeParam();
    this.Q = new FakeParam();
    this.started = null;
    this.stopped = null;
  }
  connect(node) { this.connections.push(node); return node; }
  start(time) { this.started = time; }
  stop(time) { this.stopped = time; }
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'suspended';
    this.destination = new FakeNode('destination', this);
    this.nodes = [];
    this.resumed = 0;
  }
  _node(kind) { const node = new FakeNode(kind, this); this.nodes.push(node); return node; }
  createGain() { return this._node('gain'); }
  createBiquadFilter() { return this._node('filter'); }
  createBufferSource() { return this._node('source'); }
  createOscillator() { return this._node('osc'); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { this.resumed++; this.state = 'running'; }
}

global.AudioContext = FakeAudioContext;
const LotteryAudioEngine = require('../../frontend/js/audio.js');

function fresh() {
  const engine = new LotteryAudioEngine();
  engine.ensureContext();
  return engine;
}
function nodes(engine, kind) { return engine.ctx.nodes.filter((node) => node.kind === kind); }

test('autoplay unlock resumes suspended AudioContext and mute stops every source', () => {
  const engine = fresh();
  assert.equal(engine.ctx.state, 'suspended');
  engine.unlock();
  assert.equal(engine.ctx.resumed, 1);
  assert.equal(engine.ctx.state, 'running');

  engine.startFan(3000);
  engine.startClacks(3000);
  engine.startPipeRoll(2000);
  assert.ok(engine.fan && engine.clackTimer && engine.pipe);
  assert.equal(engine.setEnabled(false), false);
  assert.equal(engine.master.gain.value, 0);
  assert.equal(engine.fan, null);
  assert.equal(engine.clackTimer, null);
  assert.equal(engine.pipe, null);
  engine.stopAll();
});

test('stage 1 fan: white/pink noise through bandpass + lowpass, fade in then fade out', () => {
  const engine = fresh();
  engine.startFan(4000);
  const bandpass = nodes(engine, 'filter').find((n) => n.type === 'bandpass');
  const lowpass = nodes(engine, 'filter').find((n) => n.type === 'lowpass');
  assert.ok(bandpass && lowpass, 'fan uses bandpass and lowpass filters');
  const fadeIn = engine.fan.gain.gain.events.find((event) => event[0] === 'linear');
  assert.ok(fadeIn && fadeIn[1] > 0 && fadeIn[2] > 0, 'fan fades in smoothly');
  assert.ok(nodes(engine, 'source').some((n) => n.started !== null), 'noise source started');

  engine.stopFan(80);
  const fadeOut = engine.fan_gain_check || engine.ctx.nodes
    .filter((n) => n.kind === 'gain')
    .flatMap((n) => n.gain.events)
    .find((event) => event[0] === 'linear' && event[1] === 0);
  assert.ok(fadeOut, 'fan gain ramps down to silence');
  engine.stopAll();
});

test('stage 2 clack: 800-1800Hz mid/high pulse decaying in ~20ms', () => {
  const engine = fresh();
  engine.clack();
  const osc = nodes(engine, 'osc')[0];
  const gain = nodes(engine, 'gain').find((n) => n.connections.includes(engine.master));
  assert.ok(osc && gain);
  const clackFreq = osc.frequency.events[0][1];
  assert.ok(clackFreq >= 800 && clackFreq <= 1800, 'clack frequency range');
  const decay = gain.gain.events.find((event) => event[0] === 'exp' && event[1] === 0.0001);
  assert.ok(decay && decay[2] >= 0.015 && decay[2] <= 0.025, 'clack decays in 15-25ms');
  assert.ok(Math.abs(osc.stopped - osc.started - 0.025) < 1e-9, 'clack stops after 25ms');
  engine.stopAll();
});

test('stage 3 pipe roll envelope lasts exactly the ball travel duration', () => {
  const engine = fresh();
  engine.startPipeRoll(2345);
  const pipeGain = engine.pipe.gain.gain;
  const end = pipeGain.events.filter((event) => event[0] === 'linear').pop();
  assert.equal(end[1], 0);
  assert.ok(Math.abs(end[2] - 2.345) < 1e-9, 'silence at end of travel');
  assert.equal(nodes(engine, 'filter').some((n) => n.type === 'bandpass'), true);
  assert.ok(nodes(engine, 'osc').some((n) => n.frequency.value === 8), 'roll wobble LFO');
  engine.stopAll();
});

test('stage 4 tray drop has main hit + 70ms bounce, reveal has a soft ting', () => {
  const engine = fresh();
  engine.trayDrop();
  const thumps = nodes(engine, 'osc');
  assert.equal(thumps.length, 2);
  assert.equal(thumps[0].started, 0);
  assert.ok(Math.abs(thumps[1].started - 0.07) < 1e-9, 'bounce after ~70ms');
  const mainGain = thumps[0].connections[0].gain.events[1][1];
  const bounceGain = thumps[1].connections[0].gain.events[1][1];
  assert.ok(bounceGain < mainGain, 'bounce is quieter');

  engine.revealTing();
  const ting = nodes(engine, 'osc')[2];
  assert.equal(ting.frequency.events[0][1], 1320);
  assert.ok(ting.stopped > ting.started);
  engine.stopAll();
});

test('stopTumble kills fan and clacks before the bot reads the number', () => {
  const engine = fresh();
  engine.startFan(3000);
  engine.startClacks(3000);
  engine.stopTumble();
  assert.equal(engine.fan, null);
  assert.equal(engine.clackTimer, null);
  assert.equal(engine.clackDeadline, 0);
  engine.stopAll();
});
