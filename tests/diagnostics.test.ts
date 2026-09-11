/**
 * Phase 6 tests: the "Why isn't it working?" checklist must fire on real
 * failure states and stay quiet when the bench is healthy.
 */
import { describe, it, expect } from 'vitest';
import { Machine } from '../src/system/machine';
import { Assembler } from '../src/asm/assembler';
import { instantiateProject } from '../src/projectLoad';
import { runDiagnostics, type DiagnosticsContext } from '../src/diagnostics';
import type { ProjectFile } from '../src/store/labStore';
import { I8255 } from '../src/components/i8255';

type Wire = [number, string, number, string];

function bench(
  source: string,
  components: ProjectFile['components'],
  wires: Wire[] = [],
): Machine {
  const file: ProjectFile = {
    format: 'microlab-8085-project',
    version: 1,
    name: 'bench',
    source,
    components,
    connections: wires.map(([fromIndex, fromPin, toIndex, toPin]) => ({
      fromIndex,
      fromPin,
      toIndex,
      toPin,
    })),
  };
  const machine = new Machine();
  const r = instantiateProject(machine, file);
  expect(r.ok).toBe(true);
  const asm = new Assembler().assemble(source);
  expect(asm.ok).toBe(true);
  machine.loadProgram(asm.segments, asm.entry);
  return machine;
}

const ctx = (machine: Machine): DiagnosticsContext => ({
  asmErrorCount: 0,
  hasProgram: machine.entryPoint !== null,
});

const texts = (machine: Machine, status?: 'ok' | 'bad' | 'info') =>
  runDiagnostics(machine, ctx(machine))
    .filter((c) => !status || c.status === status)
    .map((c) => c.text);

const runToHalt = (machine: Machine): void => {
  machine.runState = 'running';
  let guard = 0;
  while (machine.runState === 'running' && guard++ < 1000) machine.runBatch(500);
  expect(machine.runState).toBe('halted');
};

const PPI = { type: 'i8255', label: '8255 PPI', x: 0, y: 0, config: { baseAddress: 0x80 } };

describe('diagnostics', () => {
  it('flags a missing program and assembly errors before anything else', () => {
    const m = new Machine();
    const noProgram = runDiagnostics(m, { asmErrorCount: 0, hasProgram: false });
    expect(noProgram).toHaveLength(1);
    expect(noProgram[0]!.status).toBe('bad');
    expect(noProgram[0]!.text).toContain('No program loaded');

    const asmErr = runDiagnostics(m, { asmErrorCount: 3, hasProgram: false });
    expect(asmErr).toHaveLength(1);
    expect(asmErr[0]!.text).toContain('3 assembly errors');
  });

  it('a healthy run of experiment 1 produces no bad checks', () => {
    const m = bench(
      `ORG 2000H
        MVI A,80H
        OUT 83H
        MVI A,55H
        OUT 80H
        HLT`,
      [PPI, { type: 'ledBank', label: 'LED bank', x: 400, y: 0, config: { activeLow: false } }],
      [
        [0, 'PA0', 1, 'D0'], [0, 'PA1', 1, 'D1'], [0, 'PA2', 1, 'D2'], [0, 'PA3', 1, 'D3'],
        [0, 'PA4', 1, 'D4'], [0, 'PA5', 1, 'D5'], [0, 'PA6', 1, 'D6'], [0, 'PA7', 1, 'D7'],
      ],
    );
    const before = texts(m);
    expect(before.some((t) => t.includes('not started yet'))).toBe(true);
    expect(texts(m, 'bad')).toEqual([]);

    runToHalt(m);
    expect(texts(m, 'bad')).toEqual([]);
    expect(texts(m).some((t) => t.includes('halted after'))).toBe(true);
    expect(texts(m).some((t) => t.includes('I/O map: 8255 PPI at 80H–83H'))).toBe(true);
  });

  it('detects a JMP-to-self tight loop', () => {
    const m = bench('ORG 2000H\nHERE: JMP HERE', [PPI]);
    expect(texts(m, 'bad').some((t) => t.includes('Infinite tight loop'))).toBe(true);
  });

  it('hints when the 8255 never got a control word', () => {
    const m = bench(
      `ORG 2000H
        MVI A,55H
        OUT 80H
        HLT`, // forgot the mode word — port A is still an input
      [PPI],
    );
    runToHalt(m);
    const info = texts(m, 'info');
    expect(info.some((t) => t.includes('reset default'))).toBe(true);
    expect(info.some((t) => t.includes('Port A is an input but nothing is wired'))).toBe(true);
  });

  it('flags unsupported 8255 Mode 2', () => {
    const m = bench(
      `ORG 2000H
        MVI A,0B4H    ; Mode 2 — not simulated
        OUT 83H
        HLT`,
      [PPI],
    );
    runToHalt(m);
    expect(texts(m, 'bad').some((t) => t.includes('Mode 1/2'))).toBe(true);
  });

  it('flags output-to-output signal conflicts', () => {
    // Port A becomes an output; ADC data pins are outputs (OE strapped high).
    const m = bench(
      `ORG 2000H
        MVI A,80H
        OUT 83H
        HLT`,
      [PPI, { type: 'adc0808', label: 'ADC0808', x: 400, y: 0, config: { vref: 5 } }],
      [[0, 'PA0', 1, 'D0']],
    );
    runToHalt(m);
    expect(texts(m, 'bad').some((t) => t.includes('Signal conflict'))).toBe(true);
  });

  it('flags an unwired ADC START and LCD EN', () => {
    const adc = bench('ORG 2000H\nHLT', [PPI, { type: 'adc0808', label: 'ADC0808', x: 400, y: 0, config: { vref: 5 } }]);
    expect(texts(adc, 'bad').some((t) => t.includes("START isn't driven"))).toBe(true);

    const lcd = bench(
      'ORG 2000H\nHLT',
      [PPI, { type: 'lcd1602', label: 'LCD 16x2', x: 400, y: 0, config: {} }],
      [[0, 'PA0', 1, 'D0']],
    );
    expect(texts(lcd, 'bad').some((t) => t.includes("EN isn't driven"))).toBe(true);
  });

  it('notices a silent scope and an all-off LED bank', () => {
    const m = bench(
      `ORG 2000H
        MVI A,80H
        OUT 83H
        MVI A,00H
        OUT 80H
        HLT`,
      [
        PPI,
        { type: 'ledBank', label: 'LED bank', x: 400, y: 0, config: { activeLow: false } },
        { type: 'scope', label: 'Oscilloscope', x: 700, y: 0, config: { windowTstates: 20000 } },
      ],
      [
        [0, 'PA0', 1, 'D0'], [0, 'PA1', 1, 'D1'], [0, 'PA2', 1, 'D2'], [0, 'PA3', 1, 'D3'],
        [0, 'PA4', 1, 'D4'], [0, 'PA5', 1, 'D5'], [0, 'PA6', 1, 'D6'], [0, 'PA7', 1, 'D7'],
      ],
    );
    runToHalt(m);
    const info = texts(m, 'info');
    expect(info.some((t) => t.includes('all LEDs off'))).toBe(true);
    expect(info.some((t) => t.includes('no probe channels wired'))).toBe(true);
    expect(texts(m, 'bad')).toEqual([]);
  });

  it('reports I/O address conflicts', () => {
    const m = new Machine();
    m.addPeripheral(new I8255('a', 0, 0));
    m.addPeripheral(new I8255('b', 400, 0)); // same default base 80H
    // No program on this machine — seed one so diagnostics gets past the gate.
    const asm = new Assembler().assemble('ORG 2000H\nHLT');
    m.loadProgram(asm.segments, asm.entry);
    expect(texts(m, 'bad').some((t) => t.includes('I/O conflict at 80H'))).toBe(true);
  });
});
