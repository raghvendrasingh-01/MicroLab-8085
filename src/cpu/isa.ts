/**
 * 8085 instruction set architecture table.
 *
 * One authoritative table drives execution, disassembly and the debugger's
 * "current instruction" display, so they can never drift apart.
 *
 * T-states follow the Intel 8085 datasheet (they differ from the 8080 for
 * INX/DCX/RET/RST/PUSH and others — see docs/8085.md).
 */

/** Minimal surface the opcode handlers need from the CPU. */
export interface ExecContext {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  pc: number;
  sp: number;
  fS: boolean;
  fZ: boolean;
  fAC: boolean;
  fP: boolean;
  fCY: boolean;
  halted: boolean;
  readMem8(addr: number): number;
  writeMem8(addr: number, v: number): void;
  ioIn(port: number): number;
  ioOut(port: number, v: number): void;
  /** RIM: serial input data line. */
  getSid(): 0 | 1;
  /** SIM: serial output data line. */
  setSod(v: 0 | 1): void;
  /** Interrupt flip-flop state (for RIM). */
  interruptsEnabled(): boolean;
  /** Set by EI/DI handlers; the CPU wrapper applies them after the NEXT
   *  instruction, matching 8085 hardware (interrupts re-enable one
   *  instruction later). */
  eiPending: boolean;
  diPending: boolean;
}

export interface OpcodeInfo {
  mnemonic: string;
  size: 1 | 2 | 3;
  /** T-states when the instruction completes normally (or branch not taken). */
  tstates: number;
  /** T-states when a conditional branch IS taken. */
  tstatesTaken?: number;
  exec: (ctx: ExecContext) => void;
  /** Render the instruction for disassembly; b[0] is the opcode. */
  dis: (b: number[]) => string;
}

/** Entries that are invalid on the 8085 (undefined opcodes) are null. */
export const OPCODES: Array<OpcodeInfo | null> = new Array(256).fill(null);

export const REG_NAMES = ['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A'] as const;
export const REG_PAIRS = ['B', 'D', 'H', 'SP'] as const;
export const COND_NAMES = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'] as const;

/* ------------------------------------------------------------------ */
/* ALU helpers                                                          */
/* ------------------------------------------------------------------ */

function parity(v: number): boolean {
  let p = 1;
  for (let i = 0; i < 8; i++) if ((v >> i) & 1) p ^= 1;
  return p === 1;
}

function setZSP(ctx: ExecContext, v: number): void {
  ctx.fZ = v === 0;
  ctx.fS = (v & 0x80) !== 0;
  ctx.fP = parity(v);
}

function fetch8(ctx: ExecContext): number {
  return ctx.readMem8(ctx.pc++);
}

function fetch16(ctx: ExecContext): number {
  const lo = fetch8(ctx);
  const hi = fetch8(ctx);
  return lo | (hi << 8);
}

/** Read register/memory by 3-bit code (6 = M = memory at HL). */
function rd(ctx: ExecContext, code: number): number {
  if (code === 6) return ctx.readMem8((ctx.h << 8) | ctx.l);
  return regRaw(ctx, code);
}

function wr(ctx: ExecContext, code: number, v: number): void {
  if (code === 6) {
    ctx.writeMem8((ctx.h << 8) | ctx.l, v);
    return;
  }
  setRegRaw(ctx, code, v);
}

function regRaw(ctx: ExecContext, code: number): number {
  switch (code) {
    case 0: return ctx.b;
    case 1: return ctx.c;
    case 2: return ctx.d;
    case 3: return ctx.e;
    case 4: return ctx.h;
    case 5: return ctx.l;
    case 7: return ctx.a;
    default: return 0; // unreachable via public paths
  }
}

function setRegRaw(ctx: ExecContext, code: number, v: number): void {
  switch (code) {
    case 0: ctx.b = v; break;
    case 1: ctx.c = v; break;
    case 2: ctx.d = v; break;
    case 3: ctx.e = v; break;
    case 4: ctx.h = v; break;
    case 5: ctx.l = v; break;
    case 7: ctx.a = v; break;
    default: break;
  }
}

function hl(ctx: ExecContext): number {
  return (ctx.h << 8) | ctx.l;
}

function setHl(ctx: ExecContext, v: number): void {
  ctx.h = (v >> 8) & 0xff;
  ctx.l = v & 0xff;
}

function pair(ctx: ExecContext, code: number): number {
  switch (code) {
    case 0: return (ctx.b << 8) | ctx.c;
    case 1: return (ctx.d << 8) | ctx.e;
    case 2: return hl(ctx);
    case 3: return ctx.sp;
    default: return 0;
  }
}

function setPair(ctx: ExecContext, code: number, v: number): void {
  const val = v & 0xffff;
  switch (code) {
    case 0: ctx.b = val >> 8; ctx.c = val & 0xff; break;
    case 1: ctx.d = val >> 8; ctx.e = val & 0xff; break;
    case 2: setHl(ctx, val); break;
    case 3: ctx.sp = val; break;
    default: break;
  }
}

function push16(ctx: ExecContext, v: number): void {
  ctx.sp = (ctx.sp - 1) & 0xffff;
  ctx.writeMem8(ctx.sp, (v >> 8) & 0xff);
  ctx.sp = (ctx.sp - 1) & 0xffff;
  ctx.writeMem8(ctx.sp, v & 0xff);
}

function pop16(ctx: ExecContext): number {
  const lo = ctx.readMem8(ctx.sp);
  ctx.sp = (ctx.sp + 1) & 0xffff;
  const hi = ctx.readMem8(ctx.sp);
  ctx.sp = (ctx.sp + 1) & 0xffff;
  return lo | (hi << 8);
}

/** Condition code 0..7 → boolean. */
function cond(ctx: ExecContext, code: number): boolean {
  switch (code) {
    case 0: return !ctx.fZ;
    case 1: return ctx.fZ;
    case 2: return !ctx.fCY;
    case 3: return ctx.fCY;
    case 4: return !ctx.fP;
    case 5: return ctx.fP;
    case 6: return !ctx.fS;
    case 7: return ctx.fS;
    default: return false;
  }
}

/* ALU operations — flag rules documented in docs/8085.md */

function aluAdd(ctx: ExecContext, v: number, carryIn: 0 | 1): void {
  const sum = ctx.a + v + carryIn;
  ctx.fAC = (ctx.a & 0xf) + (v & 0xf) + carryIn > 0xf;
  ctx.fCY = sum > 0xff;
  ctx.a = sum & 0xff;
  setZSP(ctx, ctx.a);
}

/**
 * Subtraction implemented as two's-complement addition so that AC comes out
 * exactly as the silicon computes it (carry out of bit 3 of the internal add).
 */
function aluSub(ctx: ExecContext, v: number, borrowIn: 0 | 1, store: boolean): void {
  const a = ctx.a;
  const carryIn = (1 - borrowIn) as 0 | 1;
  const sum = a + (~v & 0xff) + carryIn;
  ctx.fAC = (a & 0xf) + (~v & 0xf) + carryIn > 0xf;
  ctx.fCY = sum <= 0xff; // no carry out of the internal add = borrow
  const r = sum & 0xff;
  if (store) ctx.a = r;
  setZSP(ctx, r);
}

function aluInr(ctx: ExecContext, v: number): number {
  const r = (v + 1) & 0xff;
  ctx.fAC = (v & 0xf) === 0xf;
  setZSP(ctx, r);
  return r; // CY unchanged
}

function aluDcr(ctx: ExecContext, v: number): number {
  const r = (v - 1) & 0xff;
  ctx.fAC = (v & 0xf) === 0x0;
  setZSP(ctx, r);
  return r; // CY unchanged
}

function aluAna(ctx: ExecContext, v: number): void {
  ctx.fAC = ((ctx.a | v) & 0x08) !== 0; // 8085: AC = OR of bit 3s
  ctx.fCY = false;
  ctx.a = ctx.a & v;
  setZSP(ctx, ctx.a);
}

function aluOra(ctx: ExecContext, v: number): void {
  ctx.fAC = false;
  ctx.fCY = false;
  ctx.a = ctx.a | v;
  setZSP(ctx, ctx.a);
}

function aluXra(ctx: ExecContext, v: number): void {
  ctx.fAC = false;
  ctx.fCY = false;
  ctx.a = (ctx.a ^ v) & 0xff;
  setZSP(ctx, ctx.a);
}

function aluDaa(ctx: ExecContext): void {
  let t = ctx.a;
  let cy = ctx.fCY;
  let ac = ctx.fAC;
  if (ac || (t & 0x0f) > 9) {
    t = (t + 6) & 0x1ff;
    ac = true;
  }
  if (cy || (t >> 4) > 9) {
    t = (t + 0x60) & 0x1ff;
    cy = true;
  }
  ctx.a = t & 0xff;
  ctx.fCY = cy;
  ctx.fAC = ac;
  setZSP(ctx, ctx.a);
}

/* ------------------------------------------------------------------ */
/* Table construction                                                   */
/* ------------------------------------------------------------------ */

const hex2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (v: number): string => v.toString(16).toUpperCase().padStart(4, '0');

function def(
  code: number,
  mnemonic: string,
  size: 1 | 2 | 3,
  tstates: number,
  exec: (ctx: ExecContext) => void,
  dis: (b: number[]) => string,
  tstatesTaken?: number,
): void {
  OPCODES[code] = { mnemonic, size, tstates, tstatesTaken, exec, dis };
}

/* --- NOP family and serial/interrupt control ----------------------- */

def(0x00, 'NOP', 1, 4, () => {}, () => 'NOP');
for (const c of [0x08, 0x10, 0x18, 0x28, 0x38]) {
  def(c, 'NOP', 1, 4, () => {}, () => 'NOP'); // undocumented no-ops on the 8085
}
def(
  0x20, 'RIM', 1, 4,
  (ctx) => {
    // Educational model: only SID and the interrupt-enable bit are real.
    ctx.a = (ctx.getSid() << 7) | (ctx.interruptsEnabled() ? 0x08 : 0x00);
  },
  () => 'RIM',
);
def(
  0x30, 'SIM', 1, 4,
  (ctx) => {
    if ((ctx.a & 0x80) !== 0) ctx.setSod(((ctx.a >> 6) & 1) as 0 | 1);
    // Interrupt masks (RST 7.5/6.5/5.5) are not modeled — documented simplification.
  },
  () => 'SIM',
);

/* --- 16-bit immediate loads, increments ------------------------------ */

const LXI_TS = 10;
def(0x01, 'LXI', 3, LXI_TS, (ctx) => setPair(ctx, 0, fetch16(ctx)), (b) => `LXI B,${hex4(b[1]! | (b[2]! << 8))}H`);
def(0x11, 'LXI', 3, LXI_TS, (ctx) => setPair(ctx, 1, fetch16(ctx)), (b) => `LXI D,${hex4(b[1]! | (b[2]! << 8))}H`);
def(0x21, 'LXI', 3, LXI_TS, (ctx) => setPair(ctx, 2, fetch16(ctx)), (b) => `LXI H,${hex4(b[1]! | (b[2]! << 8))}H`);
def(0x31, 'LXI', 3, LXI_TS, (ctx) => { ctx.sp = fetch16(ctx); }, (b) => `LXI SP,${hex4(b[1]! | (b[2]! << 8))}H`);

def(0x03, 'INX', 1, 6, (ctx) => setPair(ctx, 0, pair(ctx, 0) + 1), () => 'INX B');
def(0x13, 'INX', 1, 6, (ctx) => setPair(ctx, 1, pair(ctx, 1) + 1), () => 'INX D');
def(0x23, 'INX', 1, 6, (ctx) => setPair(ctx, 2, pair(ctx, 2) + 1), () => 'INX H');
def(0x33, 'INX', 1, 6, (ctx) => { ctx.sp = (ctx.sp + 1) & 0xffff; }, () => 'INX SP');

def(0x0b, 'DCX', 1, 6, (ctx) => setPair(ctx, 0, pair(ctx, 0) - 1), () => 'DCX B');
def(0x1b, 'DCX', 1, 6, (ctx) => setPair(ctx, 1, pair(ctx, 1) - 1), () => 'DCX D');
def(0x2b, 'DCX', 1, 6, (ctx) => setPair(ctx, 2, pair(ctx, 2) - 1), () => 'DCX H');
def(0x3b, 'DCX', 1, 6, (ctx) => { ctx.sp = (ctx.sp - 1) & 0xffff; }, () => 'DCX SP');

/* --- Indirect / direct accumulator transfers ------------------------- */

def(0x02, 'STAX', 1, 7, (ctx) => ctx.writeMem8(pair(ctx, 0), ctx.a), () => 'STAX B');
def(0x12, 'STAX', 1, 7, (ctx) => ctx.writeMem8(pair(ctx, 1), ctx.a), () => 'STAX D');
def(0x0a, 'LDAX', 1, 7, (ctx) => { ctx.a = ctx.readMem8(pair(ctx, 0)); }, () => 'LDAX B');
def(0x1a, 'LDAX', 1, 7, (ctx) => { ctx.a = ctx.readMem8(pair(ctx, 1)); }, () => 'LDAX D');

def(0x22, 'SHLD', 3, 16, (ctx) => { const a = fetch16(ctx); ctx.writeMem8(a, ctx.l); ctx.writeMem8((a + 1) & 0xffff, ctx.h); }, (b) => `SHLD ${hex4(b[1]! | (b[2]! << 8))}H`);
def(0x2a, 'LHLD', 3, 16, (ctx) => { const a = fetch16(ctx); ctx.l = ctx.readMem8(a); ctx.h = ctx.readMem8((a + 1) & 0xffff); }, (b) => `LHLD ${hex4(b[1]! | (b[2]! << 8))}H`);
def(0x32, 'STA', 3, 13, (ctx) => { ctx.writeMem8(fetch16(ctx), ctx.a); }, (b) => `STA ${hex4(b[1]! | (b[2]! << 8))}H`);
def(0x3a, 'LDA', 3, 13, (ctx) => { ctx.a = ctx.readMem8(fetch16(ctx)); }, (b) => `LDA ${hex4(b[1]! | (b[2]! << 8))}H`);

def(0xeb, 'XCHG', 1, 4, (ctx) => {
  const d = ctx.d, e = ctx.e;
  ctx.d = ctx.h; ctx.e = ctx.l; ctx.h = d; ctx.l = e;
}, () => 'XCHG');

/* --- INR / DCR / MVI on r and M ------------------------------------- */

for (let r = 0; r < 8; r++) {
  if (r === 6) continue;
  const inrCode = 0x04 | (r << 3);
  def(inrCode, 'INR', 1, 4, (ctx) => wr(ctx, r, aluInr(ctx, rd(ctx, r))), () => `INR ${REG_NAMES[r]}`);
  const dcrCode = 0x05 | (r << 3);
  def(dcrCode, 'DCR', 1, 4, (ctx) => wr(ctx, r, aluDcr(ctx, rd(ctx, r))), () => `DCR ${REG_NAMES[r]}`);
  const mviCode = 0x06 | (r << 3);
  def(mviCode, 'MVI', 2, 7, (ctx) => wr(ctx, r, fetch8(ctx)), (b) => `MVI ${REG_NAMES[r]},${hex2(b[1]!)}H`);
}
def(0x34, 'INR', 1, 10, (ctx) => { const addr = hl(ctx); ctx.writeMem8(addr, aluInr(ctx, ctx.readMem8(addr))); }, () => 'INR M');
def(0x35, 'DCR', 1, 10, (ctx) => { const addr = hl(ctx); ctx.writeMem8(addr, aluDcr(ctx, ctx.readMem8(addr))); }, () => 'DCR M');
def(0x36, 'MVI', 2, 10, (ctx) => ctx.writeMem8(hl(ctx), fetch8(ctx)), (b) => `MVI M,${hex2(b[1]!)}H`);

/* --- Accumulator rotates / complement / carry ------------------------ */

def(0x07, 'RLC', 1, 4, (ctx) => { const a = ctx.a; ctx.fCY = ((a >> 7) & 1) === 1; ctx.a = ((a << 1) | (a >> 7)) & 0xff; }, () => 'RLC');
def(0x0f, 'RRC', 1, 4, (ctx) => { const a = ctx.a; ctx.fCY = (a & 1) === 1; ctx.a = ((a >> 1) | (a << 7)) & 0xff; }, () => 'RRC');
def(0x17, 'RAL', 1, 4, (ctx) => { const a = ctx.a; const cy = ctx.fCY ? 1 : 0; ctx.fCY = ((a >> 7) & 1) === 1; ctx.a = ((a << 1) | cy) & 0xff; }, () => 'RAL');
def(0x1f, 'RAR', 1, 4, (ctx) => { const a = ctx.a; const cy = ctx.fCY ? 1 : 0; ctx.fCY = (a & 1) === 1; ctx.a = ((a >> 1) | (cy << 7)) & 0xff; }, () => 'RAR');
def(0x2f, 'CMA', 1, 4, (ctx) => { ctx.a = ~ctx.a & 0xff; }, () => 'CMA');
def(0x27, 'DAA', 1, 4, aluDaa, () => 'DAA');
def(0x37, 'STC', 1, 4, (ctx) => { ctx.fCY = true; }, () => 'STC');
def(0x3f, 'CMC', 1, 4, (ctx) => { ctx.fCY = !ctx.fCY; }, () => 'CMC');

/* --- DAD -------------------------------------------------------------- */

function dad(ctx: ExecContext, v: number): void {
  const sum = hl(ctx) + v;
  ctx.fCY = sum > 0xffff;
  setHl(ctx, sum & 0xffff);
}
def(0x09, 'DAD', 1, 10, (ctx) => dad(ctx, pair(ctx, 0)), () => 'DAD B');
def(0x19, 'DAD', 1, 10, (ctx) => dad(ctx, pair(ctx, 1)), () => 'DAD D');
def(0x29, 'DAD', 1, 10, (ctx) => dad(ctx, hl(ctx)), () => 'DAD H');
def(0x39, 'DAD', 1, 10, (ctx) => dad(ctx, ctx.sp), () => 'DAD SP');

/* --- MOV block 0x40–0x7F --------------------------------------------- */

for (let code = 0x40; code <= 0x7f; code++) {
  const dst = (code >> 3) & 7;
  const src = code & 7;
  if (dst === 6 && src === 6) continue; // 0x76 = HLT
  const isMem = dst === 6 || src === 6;
  def(
    code, 'MOV', 1, isMem ? 7 : 4,
    (ctx) => wr(ctx, dst, rd(ctx, src)),
    () => `MOV ${REG_NAMES[dst]},${REG_NAMES[src]}`,
  );
}
def(0x76, 'HLT', 1, 5, (ctx) => { ctx.halted = true; }, () => 'HLT');

/* --- ALU register/immediate group ------------------------------------ */

interface AluOp {
  base: number; // opcode = base | src
  name: string;
  apply: (ctx: ExecContext, v: number) => void;
}
const ALU_OPS: AluOp[] = [
  { base: 0x80, name: 'ADD', apply: (ctx, v) => aluAdd(ctx, v, 0) },
  { base: 0x88, name: 'ADC', apply: (ctx, v) => aluAdd(ctx, v, ctx.fCY ? 1 : 0) },
  { base: 0x90, name: 'SUB', apply: (ctx, v) => aluSub(ctx, v, 0, true) },
  { base: 0x98, name: 'SBB', apply: (ctx, v) => aluSub(ctx, v, ctx.fCY ? 1 : 0, true) },
  { base: 0xa0, name: 'ANA', apply: aluAna },
  { base: 0xa8, name: 'XRA', apply: aluXra },
  { base: 0xb0, name: 'ORA', apply: aluOra },
  { base: 0xb8, name: 'CMP', apply: (ctx, v) => aluSub(ctx, v, 0, false) },
];

for (const op of ALU_OPS) {
  for (let src = 0; src < 8; src++) {
    const code = op.base | src;
    def(
      code, op.name, 1, src === 6 ? 7 : 4,
      (ctx) => op.apply(ctx, rd(ctx, src)),
      () => `${op.name} ${REG_NAMES[src]}`,
    );
  }
}

/* --- ALU immediate ---------------------------------------------------- */

def(0xc6, 'ADI', 2, 7, (ctx) => aluAdd(ctx, fetch8(ctx), 0), (b) => `ADI ${hex2(b[1]!)}H`);
def(0xce, 'ACI', 2, 7, (ctx) => aluAdd(ctx, fetch8(ctx), ctx.fCY ? 1 : 0), (b) => `ACI ${hex2(b[1]!)}H`);
def(0xd6, 'SUI', 2, 7, (ctx) => aluSub(ctx, fetch8(ctx), 0, true), (b) => `SUI ${hex2(b[1]!)}H`);
def(0xde, 'SBI', 2, 7, (ctx) => aluSub(ctx, fetch8(ctx), ctx.fCY ? 1 : 0, true), (b) => `SBI ${hex2(b[1]!)}H`);
def(0xe6, 'ANI', 2, 7, (ctx) => aluAna(ctx, fetch8(ctx)), (b) => `ANI ${hex2(b[1]!)}H`);
def(0xee, 'XRI', 2, 7, (ctx) => aluXra(ctx, fetch8(ctx)), (b) => `XRI ${hex2(b[1]!)}H`);
def(0xf6, 'ORI', 2, 7, (ctx) => aluOra(ctx, fetch8(ctx)), (b) => `ORI ${hex2(b[1]!)}H`);
def(0xfe, 'CPI', 2, 7, (ctx) => aluSub(ctx, fetch8(ctx), 0, false), (b) => `CPI ${hex2(b[1]!)}H`);

/* --- Stack operations -------------------------------------------------- */

function pushPsw(ctx: ExecContext): void {
  const f =
    (ctx.fS ? 0x80 : 0) | (ctx.fZ ? 0x40 : 0) | (0x00) | (ctx.fAC ? 0x10 : 0) |
    (0x00) | (ctx.fP ? 0x04 : 0) | 0x02 | (ctx.fCY ? 0x01 : 0);
  ctx.sp = (ctx.sp - 1) & 0xffff;
  ctx.writeMem8(ctx.sp, ctx.a);
  ctx.sp = (ctx.sp - 1) & 0xffff;
  ctx.writeMem8(ctx.sp, f);
}

function popPsw(ctx: ExecContext): void {
  const f = ctx.readMem8(ctx.sp);
  ctx.sp = (ctx.sp + 1) & 0xffff;
  ctx.a = ctx.readMem8(ctx.sp);
  ctx.sp = (ctx.sp + 1) & 0xffff;
  ctx.fS = (f & 0x80) !== 0;
  ctx.fZ = (f & 0x40) !== 0;
  ctx.fAC = (f & 0x10) !== 0;
  ctx.fP = (f & 0x04) !== 0;
  ctx.fCY = (f & 0x01) !== 0;
}

const PUSH_CODES: Array<[number, number, string]> = [
  [0xc5, 0, 'B'], [0xd5, 1, 'D'], [0xe5, 2, 'H'],
];
for (const [code, p, name] of PUSH_CODES) {
  def(code, 'PUSH', 1, 12, (ctx) => push16(ctx, pair(ctx, p)), () => `PUSH ${name}`);
}
def(0xf5, 'PUSH', 1, 12, pushPsw, () => 'PUSH PSW');

const POP_CODES: Array<[number, number, string]> = [
  [0xc1, 0, 'B'], [0xd1, 1, 'D'], [0xe1, 2, 'H'],
];
for (const [code, p, name] of POP_CODES) {
  def(code, 'POP', 1, 10, (ctx) => setPair(ctx, p, pop16(ctx)), () => `POP ${name}`);
}
def(0xf1, 'POP', 1, 10, popPsw, () => 'POP PSW');

def(0xe3, 'XTHL', 1, 16, (ctx) => {
  const spL = ctx.readMem8(ctx.sp);
  const spH = ctx.readMem8((ctx.sp + 1) & 0xffff);
  ctx.writeMem8(ctx.sp, ctx.l);
  ctx.writeMem8((ctx.sp + 1) & 0xffff, ctx.h);
  ctx.l = spL;
  ctx.h = spH;
}, () => 'XTHL');
def(0xf9, 'SPHL', 1, 6, (ctx) => { ctx.sp = hl(ctx); }, () => 'SPHL');
def(0xe9, 'PCHL', 1, 6, (ctx) => { ctx.pc = hl(ctx); }, () => 'PCHL');

/* --- Branches ---------------------------------------------------------- */

def(0xc3, 'JMP', 3, 10, (ctx) => { const a = fetch16(ctx); ctx.pc = a; }, (b) => `JMP ${hex4(b[1]! | (b[2]! << 8))}H`);

for (let cc = 0; cc < 8; cc++) {
  const code = 0xc2 | (cc << 3); // Jcc
  const name = COND_NAMES[cc]!;
  def(
    code, `J${name}`, 3, 7,
    (ctx) => { const a = fetch16(ctx); if (cond(ctx, cc)) ctx.pc = a; },
    (b) => `J${name} ${hex4(b[1]! | (b[2]! << 8))}H`,
    10,
  );
}

def(0xcd, 'CALL', 3, 18, (ctx) => { const a = fetch16(ctx); push16(ctx, ctx.pc); ctx.pc = a; }, (b) => `CALL ${hex4(b[1]! | (b[2]! << 8))}H`);

for (let cc = 0; cc < 8; cc++) {
  const code = 0xc4 | (cc << 3); // Ccc
  const name = COND_NAMES[cc]!;
  def(
    code, `C${name}`, 3, 9,
    (ctx) => { const a = fetch16(ctx); if (cond(ctx, cc)) { push16(ctx, ctx.pc); ctx.pc = a; } },
    (b) => `C${name} ${hex4(b[1]! | (b[2]! << 8))}H`,
    18,
  );
}

def(0xc9, 'RET', 1, 10, (ctx) => { ctx.pc = pop16(ctx); }, () => 'RET');

for (let cc = 0; cc < 8; cc++) {
  const code = 0xc0 | (cc << 3); // Rcc
  const name = COND_NAMES[cc]!;
  def(
    code, `R${name}`, 1, 6,
    (ctx) => { if (cond(ctx, cc)) ctx.pc = pop16(ctx); },
    () => `R${name}`,
    12,
  );
}

for (let n = 0; n < 8; n++) {
  const code = 0xc7 | (n << 3);
  def(
    code, `RST ${n}`, 1, 12,
    (ctx) => { push16(ctx, ctx.pc); ctx.pc = n * 8; },
    () => `RST ${n}`,
  );
}

/* --- I/O and interrupt control ----------------------------------------- */

def(0xdb, 'IN', 2, 10, (ctx) => { ctx.a = ctx.ioIn(fetch8(ctx)); }, (b) => `IN ${hex2(b[1]!)}H`);
def(0xd3, 'OUT', 2, 10, (ctx) => { const p = fetch8(ctx); ctx.ioOut(p, ctx.a); }, (b) => `OUT ${hex2(b[1]!)}H`);
def(0xfb, 'EI', 1, 4, (ctx) => { ctx.eiPending = true; }, () => 'EI');
def(0xf3, 'DI', 1, 4, (ctx) => { ctx.diPending = true; }, () => 'DI');

/* --- Remaining invalid opcodes: 0xCB, 0xD9, 0xDD, 0xED, 0xFD stay null. */

/** Disassemble one instruction at `addr` using `read`. */
export function disassemble(
  addr: number,
  read: (a: number) => number,
): { text: string; size: number; valid: boolean } {
  const op = read(addr);
  const info = OPCODES[op ?? 0];
  if (!info) return { text: `DB ${hex2(op ?? 0)}H  ; invalid opcode`, size: 1, valid: false };
  const bytes: number[] = [];
  for (let i = 0; i < info.size; i++) bytes.push(read((addr + i) & 0xffff));
  return { text: info.dis(bytes), size: info.size, valid: true };
}
