/**
 * Phase 6 tests: every prebuilt experiment must actually work — instantiate
 * through the same loader the UI uses, assemble, run against the simulated
 * hardware, and produce its promised result.
 */
import { describe, it, expect } from 'vitest';
import { Machine } from '../src/system/machine';
import { Assembler } from '../src/asm/assembler';
import { instantiateProject } from '../src/projectLoad';
import { EXPERIMENTS, experimentById } from '../src/experiments';
import type { Component } from '../src/core/circuit';
import type { LedBank } from '../src/components/ledBank';
import type { DipSwitches } from '../src/components/dipSwitches';
import type { SevenSegment } from '../src/components/sevenSegment';
import type { Adc0808 } from '../src/components/adc0808';
import type { Dac0808 } from '../src/components/dac0808';
import type { Oscilloscope } from '../src/components/scope';
import type { Keypad } from '../src/components/keypad';
import type { Lcd1602 } from '../src/components/lcd';

/** Build the experiment's bench exactly as the UI would, program loaded. */
function load(id: string) {
  const exp = experimentById(id);
  if (!exp) throw new Error(`unknown experiment ${id}`);
  const machine = new Machine();
  const r = instantiateProject(machine, exp.project);
  expect(r.errors).toEqual([]);
  expect(r.wires).toBe(exp.project.connections.length); // every designed wire connects
  const asm = new Assembler().assemble(exp.project.source);
  expect(asm.ok).toBe(true);
  machine.loadProgram(asm.segments, asm.entry);
  return { exp, machine, parts: r.byIndex };
}

function part<T>(parts: Array<Component | null>, i: number, type: string): T {
  const c = parts[i];
  expect(c?.type).toBe(type);
  return c as unknown as T;
}

function runUntilHalted(machine: Machine, maxInstructions = 500_000): void {
  machine.runState = 'running';
  let n = 0;
  while (machine.runState === 'running') {
    const k = machine.runBatch(1000);
    n += k;
    if (k === 0 || n >= maxInstructions) break;
  }
  expect(machine.runState).toBe('halted');
}

describe('experiment library', () => {
  it('has 8 experiments with unique ids and complete metadata', () => {
    expect(EXPERIMENTS).toHaveLength(8);
    const ids = new Set(EXPERIMENTS.map((e) => e.id));
    expect(ids.size).toBe(8);
    for (const e of EXPERIMENTS) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.explanation.length).toBeGreaterThan(40);
      expect(e.expected.length).toBeGreaterThan(10);
      expect(e.project.format).toBe('microlab-8085-project');
    }
  });
});

describe('experiment 1 — LEDs', () => {
  it('OUT 55H lights the alternating LEDs', () => {
    const { machine, parts } = load('led-blink');
    runUntilHalted(machine);
    const led = part<LedBank>(parts, 1, 'ledBank');
    expect(led.litValue()).toBe(0x55);
    expect(machine.cpu.a).toBe(0x55); // the pattern is still in A
  });
});

describe('experiment 2 — switch echo', () => {
  it('LEDs mirror the DIP switches, live while it runs', () => {
    const { machine, parts } = load('switch-echo');
    const dip = part<DipSwitches>(parts, 1, 'dipSwitches');
    const led = part<LedBank>(parts, 2, 'ledBank');

    dip.setSwitch('S0', true);
    dip.setSwitch('S3', true);
    dip.setSwitch('S6', true);
    machine.runState = 'running';
    machine.runBatch(100);
    expect(led.litValue()).toBe(0x49);

    // Flip a switch mid-run — the LEDs must follow within one loop pass.
    dip.setSwitch('S7', true);
    machine.runBatch(100);
    expect(led.litValue()).toBe(0xc9);
    expect(machine.runState).toBe('running'); // still echoing
  });
});

describe('experiment 3 — 7-segment counter', () => {
  it('counts through the digit table on the display', () => {
    const { machine, parts } = load('seven-seg-counter');
    const seg = part<SevenSegment>(parts, 1, 'sevenSegment');
    const TABLE = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const seen = new Set<number>();

    machine.runState = 'running';
    let n = 0;
    while (n < 400_000 && !(seen.has(TABLE[0]!) && seen.has(TABLE[1]!))) {
      n += machine.runBatch(2000);
      seen.add(seg.segmentValue());
    }
    expect(seen.has(TABLE[0]!)).toBe(true); // digit 0
    expect(seen.has(TABLE[1]!)).toBe(true); // digit 1
    for (const v of seen) expect(TABLE).toContain(v); // only real digit shapes
  });
});

describe('experiment 4 — ADC + potentiometer', () => {
  it('converts the 50% knob to 80H and parks it in B', () => {
    const { machine, parts } = load('adc-pot');
    const adc = part<Adc0808>(parts, 1, 'adc0808');
    runUntilHalted(machine);
    expect(adc.lastResult()).toBe(128);
    expect(machine.cpu.b).toBe(128);
  });
});

describe('experiment 5 — DAC sawtooth', () => {
  it('emits the full staircase, visible on the scope', () => {
    const { machine, parts } = load('dac-sawtooth');
    const dac = part<Dac0808>(parts, 1, 'dac0808');
    const scope = part<Oscilloscope>(parts, 2, 'scope');
    runUntilHalted(machine);

    const ch = scope.getChannel(1);
    // 256 samples: codes 1–255 each change pins, plus the final wrap to 0.
    // (The very first OUT writes code 0 onto pins already at 0 — no edge.)
    expect(ch.length).toBe(256);
    const volts = ch.map((s) => s.analog ?? -1);
    expect(volts.some((v) => Math.abs(v - 0) < 0.01)).toBe(true);
    expect(volts.some((v) => Math.abs(v - (128 / 256) * 5) < 0.01)).toBe(true);
    expect(volts.some((v) => Math.abs(v - (255 / 256) * 5) < 0.01)).toBe(true);
    expect(dac.outputVolts()).toBeCloseTo(0, 2); // ends on code 0
  });
});

describe('experiment 6 — LM35 thermometer', () => {
  it('reads the temperature directly as a byte (Vref 2.56 V)', () => {
    const { machine, parts } = load('adc-temp');
    const adc = part<Adc0808>(parts, 1, 'adc0808');
    runUntilHalted(machine);
    expect(adc.lastResult()).toBe(100); // 100 °C = 1.00 V → 1.00/2.56×256
    expect(machine.cpu.b).toBe(100);
  });
});

describe('experiment 7 — keypad scanner', () => {
  it('scans forever until a key is pressed', () => {
    const { machine } = load('keypad-scan');
    machine.runState = 'running';
    machine.runBatch(5000);
    expect(machine.runState).toBe('running'); // nothing pressed → still scanning
  });

  it('decodes pressed keys to row×4+col in B', () => {
    for (const [keyChar, code] of [
      ['5', 5],
      ['A', 3],
      ['D', 15],
      ['0', 13],
    ] as const) {
      const { machine, parts } = load('keypad-scan');
      const pad = part<Keypad>(parts, 1, 'keypad');
      pad.setPressed(code, true);
      runUntilHalted(machine);
      expect(machine.cpu.b).toBe(code);
      expect(pad.isPressed(code)).toBe(true);
      void keyChar;
    }
  });
});

describe('experiment 8 — LCD text', () => {
  it('writes HELLO on line 1', () => {
    const { machine, parts } = load('lcd-hello');
    const lcd = part<Lcd1602>(parts, 1, 'lcd1602');
    runUntilHalted(machine);
    expect(lcd.text()[0]?.trim()).toBe('HELLO');
    expect(lcd.text()[1]?.trim()).toBe('');
  });
});
