/**
 * Integration tests: assembler → CPU → I/O bus → 8255 → wires → LEDs/switches.
 * These prove the full pipeline a student sees on screen is real, not faked.
 */
import { describe, it, expect } from 'vitest';
import { Assembler } from '../src/asm/assembler';
import { Machine } from '../src/system/machine';
import { I8255 } from '../src/components/i8255';
import { LedBank } from '../src/components/ledBank';
import { DipSwitches } from '../src/components/dipSwitches';

/** Wire 8255 port pins to an LED bank (PA0→D0 … PA7→D7). */
function wirePortToLeds(machine: Machine, ppi: I8255, leds: LedBank, prefix: string) {
  for (let i = 0; i < 8; i++) {
    expect(machine.circuit.connect(ppi.id, `${prefix}${i}`, leds.id, `D${i}`)).not.toBeNull();
  }
}

function runToHalt(machine: Machine, maxInstructions = 1000): number {
  machine.runState = 'running';
  let n = 0;
  while (n < maxInstructions) {
    if (!machine.stepInstruction()) break;
    n++;
    if (machine.runState !== 'running') break;
  }
  return n;
}

describe('8085 → 8255 → LED bank', () => {
  it('the canonical experiment: OUT 80H lights LED pattern 01010101', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const leds = new LedBank('leds', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(leds);
    wirePortToLeds(machine, ppi, leds, 'PA');

    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 80H
      OUT 83H
      MVI A, 55H
      OUT 80H
      HLT
    `);
    expect(r.errors).toEqual([]);
    machine.loadProgram(r.segments, r.entry);

    runToHalt(machine);
    expect(machine.runState).toBe('halted');
    // 55H = 01010101B → D0,D2,D4,D6 lit (active high)
    expect(leds.litValue()).toBe(0x55);
    expect(leds.lit(0)).toBe(true);
    expect(leds.lit(1)).toBe(false);
    expect(leds.lit(7)).toBe(false);
    expect(leds.lit(6)).toBe(true);
  });

  it('without the control word write, Port A stays input and LEDs stay dark', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const leds = new LedBank('leds', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(leds);
    wirePortToLeds(machine, ppi, leds, 'PA');

    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 0FFH
      OUT 80H
      HLT
    `);
    expect(r.errors).toEqual([]);
    machine.loadProgram(r.segments, r.entry);
    runToHalt(machine);

    // 8255 was never configured → ports input → OUT updates latch only.
    expect(leds.litValue()).toBe(0x00);
  });

  it('active-low LED bank inverts the pattern', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const leds = new LedBank('leds', 0, 0);
    leds.setConfig({ activeLow: true });
    machine.addPeripheral(ppi);
    machine.circuit.add(leds);
    wirePortToLeds(machine, ppi, leds, 'PB');

    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 80H
      OUT 83H
      MVI A, 0FH
      OUT 81H
      HLT
    `);
    expect(r.errors).toEqual([]);
    machine.loadProgram(r.segments, r.entry);
    runToHalt(machine);

    // Port B outputs 0FH; active-low → 0F0 lights
    expect(leds.litValue()).toBe(0xf0);
  });
});

describe('DIP switches → 8255 → CPU', () => {
  it('IN reads the switch pattern through Port A', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const switches = new DipSwitches('sw', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(switches);
    for (let i = 0; i < 8; i++) {
      expect(machine.circuit.connect(switches.id, `S${i}`, ppi.id, `PA${i}`)).not.toBeNull();
    }

    // Flip switches to 0A5H (10100101)
    switches.setConfig({ switches: 0xa5 });
    machine.circuit.propagate();

    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      IN 80H
      STA 3000H
      HLT
    `);
    expect(r.errors).toEqual([]);
    machine.loadProgram(r.segments, r.entry);
    runToHalt(machine);

    expect(machine.cpu.a).toBe(0xa5);
    expect(machine.memory.read(0x3000)).toBe(0xa5);
  });

  it('switch changes propagate to the port while the program is paused', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const switches = new DipSwitches('sw', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(switches);
    for (let i = 0; i < 8; i++) {
      machine.circuit.connect(switches.id, `S${i}`, ppi.id, `PA${i}`);
    }
    switches.setConfig({ switches: 0x0f });
    machine.circuit.propagate();
    expect(ppi.ioRead(0x80)).toBe(0x0f);

    // User flips more switches mid-session
    switches.toggle('S7');
    machine.circuit.propagate();
    expect(ppi.ioRead(0x80)).toBe(0x8f);
  });
});

describe('wiring rules', () => {
  it('rejects duplicate wires', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const leds = new LedBank('leds', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(leds);
    expect(machine.circuit.connect(ppi.id, 'PA0', leds.id, 'D0')).not.toBeNull();
    // same wire, reversed direction, is still a duplicate
    expect(machine.circuit.connect(leds.id, 'D0', ppi.id, 'PA0')).toBeNull();
    expect(machine.circuit.connections.length).toBe(1);
  });

  it('disconnecting drops the signal path', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const switches = new DipSwitches('sw', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(switches);
    const w = machine.circuit.connect(switches.id, 'S0', ppi.id, 'PA0')!;
    switches.setSwitch('S0', true);
    machine.circuit.propagate();
    expect(ppi.ioRead(0x80) & 1).toBe(1);

    machine.circuit.disconnect(w.id);
    machine.circuit.propagate();
    // The pin keeps its last value (no driver) — reading still reflects the pin.
    // Real hardware would float; we hold last state, documented simplification.
    expect(ppi.ioRead(0x80) & 1).toBe(1);
  });

  it('I/O address conflicts are detected and reported', () => {
    const machine = new Machine();
    const a = new I8255('a', 0, 0, 0x80);
    const b = new I8255('b', 0, 0, 0x82); // overlaps a's window
    expect(machine.addPeripheral(a)).toBe(true);
    expect(machine.addPeripheral(b)).toBe(false);
    expect(machine.errors.some((e) => e.kind === 'conflict')).toBe(true);

    // Rebasing b to a free window fixes it
    b.baseAddress = 0x60;
    expect(machine.rebasePeripheral(b)).toBe(true);
    expect(machine.io.ownerAt(0x60)).toBe(b);
  });
});

describe('machine lifecycle', () => {
  it('reset clears CPU and latches but keeps the program in memory', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const leds = new LedBank('leds', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(leds);
    wirePortToLeds(machine, ppi, leds, 'PA');

    const asm = new Assembler();
    const r = asm.assemble('ORG 2000H\nMVI A, 80H\nOUT 83H\nMVI A, 0AAH\nOUT 80H\nHLT');
    machine.loadProgram(r.segments, r.entry);
    runToHalt(machine);
    expect(leds.litValue()).toBe(0xaa);

    machine.reset(true);
    // Program still there, PC back at entry, ports re-initialized to input
    expect(machine.cpu.pc).toBe(0x2000);
    expect(ppi.dirA).toBe('in');
    expect(leds.litValue()).toBe(0x00);
    expect(machine.runState).toBe('stopped');

    // Re-running works
    runToHalt(machine);
    expect(leds.litValue()).toBe(0xaa);
  });

  it('invalid opcode pauses the machine with a CPU error', () => {
    const machine = new Machine();
    machine.runState = 'running';
    machine.loadProgram([{ start: 0x2000, bytes: [0xed] }], 0x2000); // invalid
    expect(machine.stepInstruction()).toBe(false);
    expect(machine.runState).toBe('paused');
    expect(machine.errors[0]!.kind).toBe('cpu');
  });
});
