/**
 * Machine: CPU + memory + I/O bus + circuit + clock, wired together.
 *
 * This is the top-level simulation object. The store (and the run loop) only
 * talk to this class. CPU ↔ peripherals flow strictly through the I/O bus.
 */
import { Cpu8085, CpuError } from '../cpu/cpu';
import { Memory } from '../core/memory';
import { IoBus } from '../core/ioBus';
import { Circuit } from '../core/circuit';
import type { Peripheral } from '../core/circuit';

export interface Breakpoints {
  /** Addresses that pause execution when the PC reaches them. */
  addresses: Set<number>;
}

export type RunState = 'stopped' | 'running' | 'paused' | 'halted';

/** Extra error info surfaced to the console panel. */
export interface MachineError {
  kind: 'cpu' | 'io' | 'conflict';
  message: string;
  at?: number;
}

export class Machine {
  readonly memory = new Memory();
  readonly io = new IoBus();
  readonly circuit = new Circuit();
  readonly cpu: Cpu8085;

  runState: RunState = 'stopped';
  /** Instructions executed between UI refreshes at 'max' speed. */
  breakpoints = new Set<number>();
  errors: MachineError[] = [];
  /** Entry point of the last loaded program (restored on soft reset). */
  entryPoint: number | null = null;
  /** Cumulative counters for the status bar. */
  totalInstructions = 0;
  totalTstates = 0;
  /** PC of the breakpoint we are currently paused ON. Resuming executes it
   *  instead of pausing on it a second time. */
  private pausedAtBreakpoint: number | null = null;

  constructor() {
    this.cpu = new Cpu8085(
      (a) => this.memory.read(a),
      (a, v) => this.memory.write(a, v),
      (p) => this.io.read(p),
      (p, v) => this.io.write(p, v),
    );
  }

  /** Register a peripheral on the circuit AND the I/O bus. */
  addPeripheral(p: Peripheral): boolean {
    this.circuit.add(p);
    const ok = this.io.register(p);
    if (!ok) {
      this.errors.push({
        kind: 'conflict',
        message: `I/O address conflict while adding ${p.label}: ${this.describeLastConflict()}`,
      });
    }
    return ok;
  }

  removeComponent(id: string): void {
    const c = this.circuit.get(id);
    if (c && 'baseAddress' in c) this.io.unregister(c as Peripheral);
    this.circuit.remove(id);
  }

  /** After an inspector change to baseAddress / addressing. */
  rebasePeripheral(p: Peripheral): boolean {
    return this.io.rebase(p);
  }

  private describeLastConflict(): string {
    const cs = this.io.getConflicts();
    const last = cs[cs.length - 1];
    return last ? `${last.first} and ${last.second} both claim ${last.address.toString(16).toUpperCase().padStart(2, '0')}H` : 'unknown';
  }

  /**
   * Execute one instruction, then tick peripherals and propagate signals.
   * Returns false if the machine cannot continue (invalid opcode).
   */
  stepInstruction(): boolean {
    if (this.runState === 'halted') return false;
    try {
      // Breakpoint at the current PC: pause BEFORE executing, so a
      // breakpoint on the entry point stops there instead of sailing past
      // the first instruction. Resuming from that pause executes it.
      if (this.breakpoints.has(this.cpu.pc)) {
        if (this.pausedAtBreakpoint !== this.cpu.pc) {
          this.pausedAtBreakpoint = this.cpu.pc;
          this.runState = 'paused';
          return true;
        }
        this.pausedAtBreakpoint = null; // we are resuming: execute it
      }
      const ts = this.cpu.step();
      this.totalInstructions++;
      this.totalTstates += ts;
      this.tickPeripherals(ts);
      this.circuit.propagate();
      if (this.cpu.halted) this.runState = 'halted';
      else if (this.breakpoints.has(this.cpu.pc)) {
        this.pausedAtBreakpoint = this.cpu.pc;
        this.runState = 'paused';
      }
      return true;
    } catch (err) {
      if (err instanceof CpuError) {
        this.errors.push({ kind: 'cpu', message: err.message, at: err.pc });
        this.runState = 'paused';
        return false;
      }
      throw err;
    }
  }

  /**
   * Peripheral time advances with the CPU. Components that need wall-clock-
   * like progress (ADC conversion, LCD EN edge detection) consume T-states
   * through tick(). We propagate every instruction for responsiveness.
   */
  private tickPeripherals(tstates: number): void {
    for (const c of this.circuit.components.values()) c.tick(tstates);
  }

  /** Hard reset: CPU, peripherals; keep memory + program when asked. */
  reset(keepMemory: boolean): void {
    this.cpu.reset();
    this.io.clearConflicts();
    this.errors = [];
    this.pausedAtBreakpoint = null;
    for (const c of this.circuit.components.values()) c.reset();
    this.circuit.propagate();
    if (!keepMemory) {
      this.memory.clear();
      this.entryPoint = null;
    } else if (this.entryPoint !== null) {
      // Soft reset: point PC at the loaded program, like re-RUN on a kit.
      this.cpu.pc = this.entryPoint;
    }
    this.runState = 'stopped';
    this.totalInstructions = 0;
    this.totalTstates = 0;
  }

  /** Load assembler output into memory. */
  loadProgram(segments: Array<{ start: number; bytes: number[] }>, entry: number | null): void {
    // Loading a new program invalidates the previous one entirely — even a
    // zero-byte result must clear the stale entry, never re-run old code.
    this.entryPoint = null;
    this.cpu.pc = 0x0000;
    this.cpu.halted = false;
    for (const seg of segments) this.memory.load(seg.start, seg.bytes);
    // No explicit ORG/END entry: start where the program is placed.
    const e = entry ?? segments[0]?.start ?? null;
    if (e !== null) {
      this.entryPoint = e;
      this.cpu.pc = e;
    }
    this.circuit.propagate(); // inputs (switches…) may now be readable
  }

  /**
   * Run up to `maxInstructions` instructions or until halted/paused/breakpoint.
   * Returns the number executed. The UI run loop calls this repeatedly with
   * a budget derived from the speed setting.
   */
  runBatch(maxInstructions: number): number {
    let n = 0;
    while (n < maxInstructions) {
      if (this.runState !== 'running') break;
      if (this.cpu.halted) {
        this.runState = 'halted';
        break;
      }
      if (!this.stepInstruction()) break;
      n++;
    }
    return n;
  }
}
