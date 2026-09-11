/**
 * "Why isn't it working?" — a checklist computed live from the simulation.
 *
 * Every rule reads the actual machine state (assembler result, CPU state,
 * I/O map, control words, wiring, peripheral state) and produces one
 * actionable line. Pure function: the panel just re-runs it on each render.
 */
import type { Machine } from './system/machine';
import type { Component, Peripheral } from './core/circuit';
import { isPeripheral } from './core/circuit';
import { I8255, CW_ALL_INPUT } from './components/i8255';
import type { Adc0808 } from './components/adc0808';
import type { Oscilloscope } from './components/scope';
import type { LedBank } from './components/ledBank';

export interface DiagnosticCheck {
  status: 'ok' | 'bad' | 'info';
  text: string;
}

export interface DiagnosticsContext {
  /** Number of assembler errors on the current source. */
  asmErrorCount: number;
  /** A successfully assembled program is loaded. */
  hasProgram: boolean;
}

const hex4 = (v: number): string => v.toString(16).toUpperCase().padStart(4, '0');

/** True when any wire touches component `c`'s pin `pinId`. */
function pinWired(wired: Set<string>, c: Component, pinId: string): boolean {
  return wired.has(`${c.id}:${pinId}`);
}

export function runDiagnostics(machine: Machine, ctx: DiagnosticsContext): DiagnosticCheck[] {
  const out: DiagnosticCheck[] = [];
  const comps = [...machine.circuit.components.values()];
  const wired = new Set<string>();
  for (const w of machine.circuit.connections) {
    wired.add(`${w.fromComponent}:${w.fromPin}`);
    wired.add(`${w.toComponent}:${w.toPin}`);
  }

  /* ---------- program & CPU ---------- */

  if (ctx.asmErrorCount > 0) {
    out.push({
      status: 'bad',
      text: `${ctx.asmErrorCount} assembly error${ctx.asmErrorCount === 1 ? '' : 's'} — fix them in the editor first.`,
    });
    return out; // nothing downstream is meaningful yet
  }
  if (!ctx.hasProgram) {
    out.push({ status: 'bad', text: 'No program loaded — assemble first (Ctrl+Enter).' });
    return out;
  }
  out.push({ status: 'ok', text: `Program assembled, entry ${hex4(machine.entryPoint ?? 0)}H.` });

  if (machine.runState === 'halted') {
    out.push({
      status: 'ok',
      text: `Program halted after ${machine.totalInstructions} instructions (${machine.totalTstates} T-states).`,
    });
  } else if (machine.runState === 'running') {
    out.push({
      status: 'ok',
      text: `8085 running — ${machine.totalInstructions} instructions so far.`,
    });
  } else if (machine.totalInstructions === 0) {
    out.push({ status: 'info', text: 'Program not started yet — press Run (Space).' });
  } else {
    out.push({ status: 'info', text: `CPU ${machine.runState} at ${hex4(machine.cpu.pc)}H.` });
  }

  // Classic accident: JMP-to-self wait loop.
  const pc = machine.cpu.pc;
  if (
    machine.memory.read(pc) === 0xc3 &&
    ((machine.memory.read(pc + 1) | (machine.memory.read(pc + 2) << 8)) & 0xffff) === pc
  ) {
    out.push({ status: 'bad', text: `Infinite tight loop at ${hex4(pc)}H (JMP to itself).` });
  }

  /* ---------- I/O map ---------- */

  for (const c of machine.io.getConflicts()) {
    out.push({
      status: 'bad',
      text: `I/O conflict at ${c.address.toString(16).toUpperCase().padStart(2, '0')}H: ${c.first} and ${c.second}.`,
    });
  }
  const peripherals = comps.filter(isPeripheral) as Peripheral[];
  if (peripherals.length === 0) {
    out.push({ status: 'bad', text: 'No I/O peripherals — IN/OUT have nowhere to go. Add an 8255.' });
  } else {
    const windows = peripherals
      .map((p) => `${p.label} at ${p.baseAddress.toString(16).toUpperCase().padStart(2, '0')}H–${(p.baseAddress + p.addressCount - 1).toString(16).toUpperCase().padStart(2, '0')}H`)
      .join(', ');
    out.push({ status: 'ok', text: `I/O map: ${windows}.` });
  }

  /* ---------- 8255 configuration ---------- */

  const ppis = comps.filter((c): c is I8255 => c instanceof I8255);
  for (const ppi of ppis) {
    if (ppi.modeUnsupported) {
      out.push({
        status: 'bad',
        text: `${ppi.label}: Mode 1/2 is not simulated — use Mode 0 (control word D6=D5=0).`,
      });
    }
    if (ppi.controlWord === CW_ALL_INPUT && machine.totalInstructions > 0) {
      out.push({
        status: 'info',
        text: `${ppi.label} is still at its reset default (all ports input) — writing to an input port never moves the pins. Send a control word first (e.g. MVI A,80H / OUT ${hex2Of(ppi.baseAddress + 3)}).`,
      });
    }
    if ((ppi.controlWord & 0x80) === 0) {
      out.push({
        status: 'info',
        text: `${ppi.label}: Port C is in bit-set/reset (BSR) mode — write one bit at a time to base+3.`,
      });
    }
  }

  /* ---------- wiring ---------- */

  for (const w of machine.circuit.connections) {
    const a = machine.circuit.components.get(w.fromComponent);
    const b = machine.circuit.components.get(w.toComponent);
    if (!a || !b) continue;
    const da = a.getPinDir(w.fromPin);
    const db = b.getPinDir(w.toPin);
    if (da === 'out' && db === 'out') {
      out.push({
        status: 'bad',
        text: `Signal conflict: ${a.label}:${w.fromPin} → ${b.label}:${w.toPin} — both ends are outputs. Neither wins.`,
      });
    }
  }

  /* ---------- component-specific hints ---------- */

  for (const c of comps) {
    if (c instanceof I8255) {
      const pin = (p: string) => pinWired(wired, c, p);
      if (c.dirA === 'in' && !pin('PA0') && !pin('PA1') && !pin('PA4')) {
        out.push({ status: 'info', text: `${c.label}: Port A is an input but nothing is wired to it — reads 00H.` });
      }
      if (c.dirB === 'in' && !pin('PB0') && !pin('PB1') && !pin('PB4')) {
        out.push({ status: 'info', text: `${c.label}: Port B is an input but nothing is wired to it — reads 00H.` });
      }
    } else if (c.type === 'adc0808') {
      const adc = c as unknown as Adc0808;
      if (!pinWired(wired, c, 'START')) {
        out.push({ status: 'bad', text: `${c.label}: START isn't driven — no conversion can begin. Pulse it from a port pin.` });
      } else if (machine.totalInstructions === 0 && !pinWired(wired, c, 'EOC')) {
        out.push({ status: 'info', text: `${c.label}: EOC isn't connected — the CPU can't poll for completion.` });
      }
      if (adc.isConverting()) {
        out.push({ status: 'info', text: `${c.label}: conversion in progress (${Math.round(adc.progress() * 100)}%).` });
      }
    } else if (c.type === 'dac0808') {
      const missing = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].filter((p) => !pinWired(wired, c, p));
      if (missing.length > 0) {
        out.push({ status: 'info', text: `${c.label}: ${missing.join(', ')} unwired — unwired bits read 0.` });
      }
    } else if (c.type === 'lcd1602') {
      if (!pinWired(wired, c, 'EN')) {
        out.push({ status: 'bad', text: `${c.label}: EN isn't driven — the display latches a byte on EN's falling edge.` });
      }
    } else if (c.type === 'scope') {
      const scope = c as unknown as Oscilloscope;
      if (machine.totalInstructions > 0 && !['CH1', 'CH2', 'CH3', 'CH4'].some((ch) => pinWired(wired, c, ch))) {
        out.push({ status: 'info', text: `${c.label}: no probe channels wired — wire a signal to CH1 to see a trace.` });
      } else if (machine.totalInstructions > 0 && scope.getChannel(1).length === 0 && pinWired(wired, c, 'CH1')) {
        out.push({ status: 'info', text: `${c.label}: CH1 is wired but has recorded nothing — the traced signal never changed.` });
      }
    } else if (c.type === 'ledBank') {
      const led = c as unknown as LedBank;
      if (!['D0', 'D4', 'D7'].some((p) => pinWired(wired, c, p))) {
        out.push({ status: 'info', text: `${c.label} isn't wired to anything.` });
      } else if (machine.runState === 'halted' && led.litValue() === 0) {
        out.push({ status: 'info', text: `${c.label}: all LEDs off — the port pins are all 0.` });
      }
    }
  }

  return out;
}

function hex2Of(v: number): string {
  return v.toString(16).toUpperCase().padStart(2, '0');
}
