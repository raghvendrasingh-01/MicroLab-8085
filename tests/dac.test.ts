/**
 * Phase 5 tests: DAC0808 output physics, oscilloscope recording, and a full
 * CPU → 8255 → DAC → scope staircase run.
 */
import { describe, it, expect } from 'vitest';
import { Machine } from '../src/system/machine';
import { Assembler } from '../src/asm/assembler';
import { I8255 } from '../src/components/i8255';
import { Dac0808 } from '../src/components/dac0808';
import { Oscilloscope, MAX_SCOPE_SAMPLES } from '../src/components/scope';
import { DipSwitches } from '../src/components/dipSwitches';
import { Potentiometer } from '../src/components/sensors';

/** Array contains a value within `digits` of `expected`. */
function containsClose(arr: number[], expected: number, digits = 2): boolean {
  return arr.some((v) => Math.abs(v - expected) < Math.pow(10, -digits) / 2);
}

describe('DAC0808 conversion physics', () => {
  it('maps code 0 / 128 / 255 to the expected voltages', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 40, 40);
    const dac = new Dac0808('dac', 400, 40);
    machine.addPeripheral(ppi);
    machine.circuit.add(dac);
    for (let i = 0; i < 8; i++) machine.circuit.connect('ppi', `PA${i}`, 'dac', `D${i}`);
    ppi.ioWrite(0x83, 0x80); // all ports output
    machine.circuit.propagate();

    ppi.ioWrite(0x80, 0x00);
    machine.circuit.propagate();
    expect(dac.outputVolts()).toBeCloseTo(0);

    ppi.ioWrite(0x80, 0x80);
    machine.circuit.propagate();
    expect(dac.outputVolts()).toBeCloseTo(2.5);
    expect(dac.outputByte()).toBe(0x80);

    ppi.ioWrite(0x80, 0xff);
    machine.circuit.propagate();
    // 255/256 × 5 — one LSB short of full scale, like the real chip.
    expect(dac.outputVolts()).toBeCloseTo((255 / 256) * 5);
    expect(dac.lsbVolts()).toBeCloseTo(5 / 256);
  });

  it('drives the OUT pin with analog volts and a digital threshold', () => {
    const machine = new Machine();
    const dac = new Dac0808('dac', 0, 0);
    const ctl = new DipSwitches('ctl', 400, 0);
    machine.circuit.add(dac);
    machine.circuit.add(ctl);
    // Drive code 128 (2.50 V) bit by bit through switches: D7 = S0.
    machine.circuit.connect('ctl', 'S0', 'dac', 'D7');
    ctl.setSwitch('S0', true);
    machine.circuit.propagate();
    expect(dac.getPin('OUT').analog).toBeCloseTo(2.5);
    expect(dac.getPin('OUT').digital).toBe(1);

    ctl.setSwitch('S0', false);
    machine.circuit.propagate();
    expect(dac.getPin('OUT').analog).toBeCloseTo(0);
    expect(dac.getPin('OUT').digital).toBe(0);
  });

  it('honors a configurable Vref', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 40, 40);
    const dac = new Dac0808('dac', 400, 40);
    machine.addPeripheral(ppi);
    machine.circuit.add(dac);
    for (let i = 0; i < 8; i++) machine.circuit.connect('ppi', `PA${i}`, 'dac', `D${i}`);
    ppi.ioWrite(0x83, 0x80);
    dac.setConfig({ vref: 2.56 });
    expect(dac.getConfig()).toEqual({ vref: 2.56 });
    ppi.ioWrite(0x80, 0x80);
    machine.circuit.propagate();
    expect(dac.outputVolts()).toBeCloseTo(1.28);
    // Vref is clamped to the 5 V system rail.
    dac.setConfig({ vref: 99 });
    expect(dac.vref).toBe(5);
    dac.setConfig({ vref: 0 });
    expect(dac.vref).toBeCloseTo(0.1);
  });

  it('follows the input in real time and resets to 0 V', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 40, 40);
    const dac = new Dac0808('dac', 400, 40);
    machine.addPeripheral(ppi);
    machine.circuit.add(dac);
    for (let i = 0; i < 8; i++) machine.circuit.connect('ppi', `PA${i}`, 'dac', `D${i}`);
    ppi.ioWrite(0x83, 0x80);
    for (const code of [0x00, 0x33, 0xcc, 0x55]) {
      ppi.ioWrite(0x80, code);
      machine.circuit.propagate();
      expect(dac.outputByte()).toBe(code);
      expect(dac.outputVolts()).toBeCloseTo((code / 256) * 5);
    }
    machine.reset(false);
    machine.circuit.propagate();
    expect(dac.outputVolts()).toBe(0);
    expect(dac.outputByte()).toBe(0);
  });
});

describe('oscilloscope recording', () => {
  function rig() {
    const machine = new Machine();
    const scope = new Oscilloscope('scope', 700, 40);
    const ctl = new DipSwitches('ctl', 400, 40);
    const pot = new Potentiometer('pot', 400, 300);
    machine.circuit.add(scope);
    machine.circuit.add(ctl);
    machine.circuit.add(pot);
    machine.circuit.connect('ctl', 'S0', 'scope', 'CH1');
    machine.circuit.connect('pot', 'out', 'scope', 'CH2');
    const tick = (n: number) => {
      for (const c of machine.circuit.components.values()) c.tick(n);
    };
    return { machine, scope, ctl, pot, tick };
  }

  it('records digital transitions stamped with T-states', () => {
    const r = rig();
    r.ctl.setSwitch('S0', true);
    r.machine.circuit.propagate();
    r.tick(100);
    r.ctl.setSwitch('S0', false);
    r.machine.circuit.propagate();
    const ch1 = r.scope.getChannel(1);
    expect(ch1.length).toBe(2);
    expect(ch1[0]).toEqual({ t: 0, digital: 1, analog: null });
    expect(ch1[1]).toEqual({ t: 100, digital: 0, analog: null });
    expect(r.scope.now()).toBe(100);
    expect(r.scope.channelIsAnalog(1)).toBe(false);
  });

  it('records analog changes even when the logic level does not change', () => {
    const r = rig();
    r.pot.setLevel(50); // 2.50 V
    r.machine.circuit.propagate();
    r.tick(50);
    r.pot.setLevel(60); // 3.00 V — still logic 1
    r.machine.circuit.propagate();
    const ch2 = r.scope.getChannel(2);
    expect(ch2.length).toBe(2);
    expect(ch2[0]!.analog).toBeCloseTo(2.5);
    expect(ch2[1]!.analog).toBeCloseTo(3.0);
    expect(ch2[0]!.t).toBe(0);
    expect(ch2[1]!.t).toBe(50);
    expect(r.scope.channelIsAnalog(2)).toBe(true);
  });

  it('coalesces repeated identical values', () => {
    const r = rig();
    r.ctl.setSwitch('S0', true);
    r.machine.circuit.propagate();
    r.machine.circuit.propagate();
    r.ctl.setSwitch('S0', true); // no change
    r.machine.circuit.propagate();
    expect(r.scope.getChannel(1).length).toBe(1);
  });

  it('caps the sample buffer and drops the oldest', () => {
    const r = rig();
    for (let i = 0; i < MAX_SCOPE_SAMPLES + 200; i++) {
      r.ctl.setSwitch('S0', i % 2 === 0);
      r.machine.circuit.propagate();
    }
    const ch1 = r.scope.getChannel(1);
    expect(ch1.length).toBe(MAX_SCOPE_SAMPLES);
    expect(ch1[0]!.digital).toBe(1); // oldest surviving starts mid-stream
  });

  it('reset clears the trace and rewinds time', () => {
    const r = rig();
    r.ctl.setSwitch('S0', true);
    r.machine.circuit.propagate();
    r.tick(999);
    r.scope.reset();
    expect(r.scope.now()).toBe(0);
    expect(r.scope.getChannel(1).length).toBe(0);
    expect(r.scope.getChannel(2).length).toBe(0);
  });

  it('window property round-trips through config with clamping', () => {
    const scope = new Oscilloscope('s', 0, 0);
    expect(scope.windowTstates).toBe(20000);
    scope.setConfig({ windowTstates: 5000 });
    expect(scope.getConfig()).toMatchObject({ windowTstates: 5000 });
    scope.setConfig({ windowTstates: 1 });
    expect(scope.windowTstates).toBe(1000);
    scope.setConfig({ windowTstates: 1e9 });
    expect(scope.windowTstates).toBe(10_000_000);
  });

  it('display size and channel visibility round-trip through config with clamping', () => {
    const scope = new Oscilloscope('s', 0, 0);
    expect(scope.getDisplaySize()).toEqual({ width: 370, height: 320 });
    scope.resizeTo(200, 100); // below minimum → clamped to the default card size
    expect(scope.getDisplaySize()).toEqual({ width: 370, height: 320 });
    scope.resizeTo(5000, 5000); // above maximum → clamped
    expect(scope.getDisplaySize()).toEqual({ width: 1000, height: 800 });
    scope.resizeTo(600, 500);
    scope.chVisible[2] = false; // hide CH3
    scope.setConfig(scope.getConfig());
    expect(scope.getDisplaySize()).toEqual({ width: 600, height: 500 });
    expect(scope.chVisible).toEqual([true, true, false, true]);
    expect(scope.getConfig()).toMatchObject({ displayW: 600, displayH: 500, ch3: false });
  });
});

describe('DAC + scope through the CPU', () => {
  it('a staircase program draws one sample per OUT on the scope', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 40, 40);
    const dac = new Dac0808('dac', 400, 40);
    const scope = new Oscilloscope('scope', 700, 40);
    machine.addPeripheral(ppi);
    machine.circuit.add(dac);
    machine.circuit.add(scope);
    for (let i = 0; i < 8; i++) machine.circuit.connect('ppi', `PA${i}`, 'dac', `D${i}`);
    machine.circuit.connect('dac', 'OUT', 'scope', 'CH1');

    const src = `
        MVI A,80H    ; all ports output
        OUT 83H
        MVI A,00H
        OUT 80H      ; 0.00 V
        MVI A,40H
        OUT 80H      ; 1.25 V
        MVI A,80H
        OUT 80H      ; 2.50 V
        MVI A,C0H
        OUT 80H      ; 3.75 V
        HLT`;
    const r = new Assembler().assemble(src);
    expect(r.ok).toBe(true);
    machine.loadProgram(r.segments, r.entry);
    machine.runState = 'running';
    let guard = 0;
    while (machine.runState === 'running' && guard++ < 50) machine.runBatch(500);
    expect(machine.runState).toBe('halted');

    expect(dac.outputByte()).toBe(0xc0);
    expect(dac.outputVolts()).toBeCloseTo(3.75);
    // Every OUT (plus the initial 0 after the control word) landed a sample.
    const ch1 = scope.getChannel(1);
    expect(ch1.length).toBeGreaterThanOrEqual(4);
    const volts = ch1.map((s) => s.analog ?? 0);
    expect(containsClose(volts, 0)).toBe(true);
    expect(containsClose(volts, 1.25)).toBe(true);
    expect(containsClose(volts, 2.5)).toBe(true);
    expect(containsClose(volts, 3.75)).toBe(true);
    // Samples advance in time as the program runs.
    for (let i = 1; i < ch1.length; i++) expect(ch1[i]!.t).toBeGreaterThanOrEqual(ch1[i - 1]!.t);
  });

  it('a sawtooth ramp program records the full 0–255 staircase', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 40, 40);
    const dac = new Dac0808('dac', 400, 40);
    const scope = new Oscilloscope('scope', 700, 40);
    machine.addPeripheral(ppi);
    machine.circuit.add(dac);
    machine.circuit.add(scope);
    for (let i = 0; i < 8; i++) machine.circuit.connect('ppi', `PA${i}`, 'dac', `D${i}`);
    machine.circuit.connect('dac', 'OUT', 'scope', 'CH1');

    const src = `
        MVI A,80H
        OUT 83H
        XRA A
LOOP:   OUT 80H      ; emit the code
        INR A
        JNZ LOOP      ; 0..255, then wraps to 0 and exits
        OUT 80H       ; back to 0 V — one full sawtooth
        HLT`;
    const r = new Assembler().assemble(src);
    expect(r.ok).toBe(true);
    machine.loadProgram(r.segments, r.entry);
    machine.runState = 'running';
    let guard = 0;
    while (machine.runState === 'running' && guard++ < 200) machine.runBatch(2000);
    expect(machine.runState).toBe('halted');

    expect(dac.outputVolts()).toBeCloseTo(0); // ended at code 0
    const ch1 = scope.getChannel(1);
    expect(ch1.length).toBeGreaterThanOrEqual(256);
    const volts = new Set(ch1.map((s) => Math.round((s.analog ?? 0) * 1000)));
    for (let code = 0; code <= 255; code++) {
      expect(volts.has(Math.round((code / 256) * 5 * 1000))).toBe(true);
    }
  });
});
