/**
 * Intel 8085 CPU.
 *
 * The CPU is deliberately decoupled from everything else: it talks to memory
 * and the I/O bus through injected callbacks, so the emulator core can be
 * unit-tested with no peripherals at all (tests/cpu.test.ts does exactly
 * that).
 *
 * Educational simplifications (documented in docs/8085.md):
 *  - The interrupt lines INTR/RST 5.5/6.5/7.5/TRAP are not modeled beyond
 *    the EI/DI flip-flop and RIM/SIM serial bits.
 *  - READY/HOLD/HLDA (wait states, DMA) are not modeled.
 */
import { OPCODES, disassemble } from './isa';
import type { ExecContext } from './isa';

export interface CpuState {
  a: number; b: number; c: number; d: number; e: number; h: number; l: number;
  pc: number; sp: number;
  flags: { S: boolean; Z: boolean; AC: boolean; P: boolean; CY: boolean };
  halted: boolean;
  interruptsEnabled: boolean;
  tstates: number;
  instructions: number;
}

export class CpuError extends Error {
  constructor(message: string, readonly pc: number) {
    super(message);
    this.name = 'CpuError';
  }
}

export class Cpu8085 {
  a = 0x00; b = 0x00; c = 0x00; d = 0x00; e = 0x00; h = 0x00; l = 0x00;
  pc = 0x0000; sp = 0x0000;
  fS = false; fZ = false; fAC = false; fP = false; fCY = false;
  halted = false;
  iff = false; // interrupt flip-flop
  // Educational simplification: EI/DI are applied immediately after the
  // instruction instead of after the following one. Since no interrupt
  // sources are modeled, the one-instruction delay is unobservable.
  private eiPending = false;
  private diPending = false;
  tstates = 0;
  instructions = 0;
  sid: 0 | 1 = 0;
  sod: 0 | 1 = 0;

  constructor(
    readonly readMem8: (addr: number) => number,
    readonly writeMem8: (addr: number, v: number) => void,
    readonly ioIn: (port: number) => number,
    readonly ioOut: (port: number, v: number) => void,
  ) {}

  reset(): void {
    this.a = this.b = this.c = this.d = this.e = this.h = this.l = 0;
    this.pc = 0x0000;
    this.sp = 0x0000;
    this.fS = this.fZ = this.fAC = this.fP = this.fCY = false;
    this.halted = false;
    this.iff = false;
    this.eiPending = this.diPending = false;
    this.tstates = 0;
    this.instructions = 0;
    this.sid = 0;
    this.sod = 0;
  }

  /** Assemble the flags byte in PSW layout (bit 1 always 1, bit 3/5 always 0). */
  getFlagsByte(): number {
    return (
      (this.fS ? 0x80 : 0) | (this.fZ ? 0x40 : 0) | (this.fAC ? 0x10 : 0) |
      (this.fP ? 0x04 : 0) | 0x02 | (this.fCY ? 0x01 : 0)
    );
  }

  setFlagsByte(f: number): void {
    this.fS = (f & 0x80) !== 0;
    this.fZ = (f & 0x40) !== 0;
    this.fAC = (f & 0x10) !== 0;
    this.fP = (f & 0x04) !== 0;
    this.fCY = (f & 0x01) !== 0;
  }

  disassembleAt(addr: number): { text: string; size: number; valid: boolean } {
    return disassemble(addr, this.readMem8);
  }

  /** Peek at what the next instruction would be (debugger display). */
  peekNextInstruction(): { text: string; size: number; valid: boolean } {
    return this.disassembleAt(this.pc);
  }

  /**
   * Execute a single instruction. Returns the number of T-states consumed.
   * Throws CpuError on an invalid opcode (the debugger catches this and
   * shows it in the console).
   */
  step(): number {
    if (this.halted) return 2; // HALT consumes T-states doing nothing

    // EI/DI take effect after the instruction following them.
    this.eiPending = false;
    this.diPending = false;

    const opAddr = this.pc;
    const opcode = this.readMem8(opAddr);
    const info = OPCODES[opcode];
    if (!info) {
      throw new CpuError(
        `Invalid opcode ${opcode.toString(16).toUpperCase().padStart(2, '0')}H at ${opAddr.toString(16).toUpperCase().padStart(4, '0')}H`,
        opAddr,
      );
    }
    this.pc = (opAddr + 1) & 0xffff;
    info.exec(this.ctx);

    this.instructions++;
    this.tstates += info.tstates;
    if (this.eiPending) {
      this.iff = true;
      this.eiPending = false;
    }
    if (this.diPending) {
      this.iff = false;
      this.diPending = false;
    }
    return info.tstates;
  }

  private readonly ctx: ExecContext = this.makeCtx();

  private makeCtx(): ExecContext {
    // `this` binding: handlers run with this Cpu8085 as their context object.
    const cpu = this;
    return cpu as unknown as ExecContext;
  }

  // -- ExecContext surface (used by isa.ts handlers) ------------------
  // Plain property access (a,b,c,...) is shared via the cast above; the
  // methods below complete the interface.

  interruptsEnabled(): boolean {
    return this.iff;
  }

  getSid(): 0 | 1 {
    return this.sid;
  }

  setSod(v: 0 | 1): void {
    this.sod = v;
  }

  /** Serializable snapshot for the store / project save. */
  snapshot(): CpuState {
    return {
      a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, h: this.h, l: this.l,
      pc: this.pc, sp: this.sp,
      flags: { S: this.fS, Z: this.fZ, AC: this.fAC, P: this.fP, CY: this.fCY },
      halted: this.halted,
      interruptsEnabled: this.iff,
      tstates: this.tstates,
      instructions: this.instructions,
    };
  }

  restore(s: CpuState): void {
    this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e;
    this.h = s.h; this.l = s.l; this.pc = s.pc; this.sp = s.sp;
    this.fS = s.flags.S; this.fZ = s.flags.Z; this.fAC = s.flags.AC;
    this.fP = s.flags.P; this.fCY = s.flags.CY;
    this.halted = s.halted;
    this.iff = s.interruptsEnabled;
    this.tstates = s.tstates;
    this.instructions = s.instructions;
  }
}
