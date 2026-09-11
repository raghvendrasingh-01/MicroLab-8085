/**
 * 8085 two-pass assembler.
 *
 * Pass 1: parse lines, build the symbol table, compute each line's size
 *         (expression evaluation uses dummy values for not-yet-defined
 *         labels — sizing must not fail on forward references).
 * Pass 2: emit bytes and resolve labels; all diagnostics are recorded here.
 *
 * Syntax supported:
 *   - labels:  `LABEL:` or a bare `LABEL` at line start (both common styles)
 *   - comments: `;` or `//` to end of line
 *   - numbers: `2000H`, `0x2000`, `2000`/`2000D`, `01010101B`, `'A'`
 *   - directives: ORG, DB, DW, EQU, END (optional)
 *   - all documented 8085 mnemonics (see src/cpu/isa.ts)
 *
 * Every failure produces a line-numbered AsmError; nothing is silently ignored.
 */
import { COND_NAMES, REG_NAMES } from '../cpu/isa';

export interface AsmError {
  line: number;
  message: string;
}

export interface ListingEntry {
  /** 1-based source line number. */
  line: number;
  /** Address of the first emitted byte (null for non-emitting lines). */
  addr: number | null;
  bytes: number[];
  text: string;
}

export interface AsmResult {
  ok: boolean;
  errors: AsmError[];
  /** Emitted segments: start address + bytes. */
  segments: Array<{ start: number; bytes: number[] }>;
  entry: number | null;
  symbols: Record<string, number>;
  listing: ListingEntry[];
}

interface ParsedLine {
  lineNo: number;
  label: string | null;
  mnemonic: string | null;
  operands: string[];
  raw: string;
}

const REG_CODE: Record<string, number> = {
  B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, M: 6, A: 7,
};
const PAIR_CODE: Record<string, number> = { B: 0, D: 1, H: 2, SP: 3 };
const COND_CODE: Record<string, number> = {};
COND_NAMES.forEach((n, i) => { COND_CODE[n] = i; });

const SIMPLE_ENCODINGS: Record<string, number> = {
  NOP: 0x00, HLT: 0x76, RIM: 0x20, SIM: 0x30,
  RLC: 0x07, RRC: 0x0f, RAL: 0x17, RAR: 0x1f,
  DAA: 0x27, CMA: 0x2f, STC: 0x37, CMC: 0x3f,
  XCHG: 0xeb, XTHL: 0xe3, SPHL: 0xf9, PCHL: 0xe9,
  EI: 0xfb, DI: 0xf3, RET: 0xc9,
};

const ALU_REG_MNEMONICS = new Set(['ADD', 'ADC', 'SUB', 'SBB', 'ANA', 'XRA', 'ORA', 'CMP']);
const ALU_REG_BASE: Record<string, number> = {
  ADD: 0x80, ADC: 0x88, SUB: 0x90, SBB: 0x98,
  ANA: 0xa0, XRA: 0xa8, ORA: 0xb0, CMP: 0xb8,
};
const IMM_BASE: Record<string, number> = {
  ADI: 0xc6, ACI: 0xce, SUI: 0xd6, SBI: 0xde,
  ANI: 0xe6, XRI: 0xee, ORI: 0xf6, CPI: 0xfe,
};
const DIRECT_BASE: Record<string, number> = {
  LDA: 0x3a, STA: 0x32, LHLD: 0x2a, SHLD: 0x22, JMP: 0xc3, CALL: 0xcd,
};
const DIRECTIVES = new Set(['ORG', 'DB', 'DW', 'EQU', 'END', 'DS']);

const ALL_MNEMONICS: string[] = [
  ...Object.keys(SIMPLE_ENCODINGS),
  ...ALU_REG_MNEMONICS,
  ...Object.keys(IMM_BASE),
  'MOV', 'MVI', 'LXI', 'LDA', 'STA', 'LHLD', 'SHLD', 'LDAX', 'STAX',
  'INX', 'DCX', 'DAD', 'INR', 'DCR', 'PUSH', 'POP', 'RST', 'IN', 'OUT',
  'JMP', 'CALL',
  ...COND_NAMES.map((n) => `J${n}`),
  ...COND_NAMES.map((n) => `C${n}`),
  ...COND_NAMES.map((n) => `R${n}`),
];

function fmt(v: number): string {
  return v.toString(16).toUpperCase();
}

export class Assembler {
  private readonly errors: AsmError[] = [];
  private readonly symbols = new Map<string, number>();
  private readonly lines: ParsedLine[] = [];
  private readonly listing: ListingEntry[] = [];
  private entry: number | null = null;
  private passNum: 1 | 2 = 1;

  assemble(source: string): AsmResult {
    // The store reuses one Assembler instance across edits — reset the
    // accumulated state so a second assembly doesn't append to the first.
    this.errors.length = 0;
    this.symbols.clear();
    this.lines.length = 0;
    this.listing.length = 0;
    this.entry = null;
    this.parse(source);
    this.pass1();
    const segments = this.pass2();
    return {
      ok: this.errors.length === 0,
      errors: [...this.errors],
      segments,
      entry: this.entry,
      symbols: Object.fromEntries(this.symbols),
      listing: this.listing,
    };
  }

  private fail(lineNo: number, message: string): void {
    // Pass-1 encode calls use dummy expression values; their diagnostics
    // would be duplicated (or spurious). Record only during pass 2.
    if (this.passNum === 2) this.errors.push({ line: lineNo, message });
  }

  /* ---------------- parsing ---------------- */

  private parse(source: string): void {
    const rawLines = source.split(/\r?\n/);
    rawLines.forEach((raw, i) => {
      const lineNo = i + 1;
      let s = raw;

      const semi = s.indexOf(';');
      if (semi >= 0) s = s.slice(0, semi);
      const slash = s.indexOf('//');
      if (slash >= 0) s = s.slice(0, slash);
      s = s.trim();

      if (!s) {
        this.lines.push({ lineNo, label: null, mnemonic: null, operands: [], raw });
        return;
      }

      let label: string | null = null;

      // `LABEL:` form.
      const colonMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(s);
      if (colonMatch && !this.isInstructionWord(colonMatch[1]!)) {
        label = colonMatch[1]!;
        s = colonMatch[2]!;
      }

      // Bare label alone on a line (or followed by an instruction).
      if (s) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/.exec(s);
        if (m && !this.isInstructionWord(m[1]!)) {
          label = m[1]!;
          s = m[2]!;
        } else {
          const alone = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(s);
          if (alone && !this.isInstructionWord(alone[1]!)) {
            label = alone[1]!;
            s = '';
          }
        }
      }

      let mnemonic: string | null = null;
      let operandStr = '';
      if (s) {
        const instr = /^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(s);
        if (instr) {
          mnemonic = instr[1]!.toUpperCase();
          operandStr = instr[2] ?? '';
        } else {
          this.errors.push({ line: lineNo, message: `Cannot parse line: "${raw.trim()}"` });
          this.lines.push({ lineNo, label, mnemonic: null, operands: [], raw });
          return;
        }
      }

      const operands = splitOperands(operandStr);
      this.lines.push({ lineNo, label, mnemonic, operands, raw });
    });
  }

  private isInstructionWord(word: string): boolean {
    const w = word.toUpperCase();
    return ALL_MNEMONICS.includes(w) || DIRECTIVES.has(w);
  }

  /* ---------------- directive processing (shared by both passes) ----- */

  /**
   * Handle ORG/EQU/END. Returns:
   *   'handled'  — line fully processed (no bytes)
   *   'bytes'    — not a directive in this set
   */
  private processDirective(ln: ParsedLine, pc: number): { kind: 'handled'; pc: number } | { kind: 'bytes' } {
    const mn = ln.mnemonic!;
    if (mn === 'ORG') {
      if (ln.operands.length !== 1) {
        this.fail(ln.lineNo, 'ORG expects exactly one address.');
        return { kind: 'handled', pc };
      }
      const v = this.evalExpr(ln.operands[0]!, ln.lineNo, 16);
      if (v === null) return { kind: 'handled', pc };
      if (v < 0 || v > 0xffff) {
        this.fail(ln.lineNo, `ORG address ${fmt(v)}H is outside the 64K address space.`);
        return { kind: 'handled', pc };
      }
      if (this.passNum === 1 && this.entry === null) this.entry = v;
      return { kind: 'handled', pc: v };
    }
    if (mn === 'EQU') {
      if (!ln.label) {
        this.fail(ln.lineNo, 'EQU requires a label on the same line.');
      } else if (ln.operands.length === 1) {
        const v = this.evalExpr(ln.operands[0]!, ln.lineNo, 16);
        if (v !== null) this.symbols.set(ln.label.toUpperCase(), v);
        // pass 1: label gets a placeholder so later forward references size
        else this.symbols.set(ln.label.toUpperCase(), 0);
      } else {
        this.fail(ln.lineNo, 'EQU expects exactly one value.');
      }
      return { kind: 'handled', pc };
    }
    if (mn === 'END') {
      if (ln.operands.length === 1) {
        const v = this.evalExpr(ln.operands[0]!, ln.lineNo, 16);
        if (v !== null) this.entry = v;
      }
      return { kind: 'handled', pc };
    }
    return { kind: 'bytes' };
  }

  /* ---------------- pass 1: labels + addresses ---------------- */

  private pass1(): void {
    // pass2() leaves passNum at 2 and the store reuses this instance across
    // assemblies — reset it, or pass 1 runs with pass-2 semantics: the ORG
    // entry rule skips itself and pass-1 diagnostics stop being suppressed.
    this.passNum = 1;
    let pc = 0x0000;
    for (const ln of this.lines) {
      if (ln.label) {
        const key = ln.label.toUpperCase();
        if (this.symbols.has(key)) {
          // Note: EQU overwrites its own line's label legitimately — that
          // happens inside processDirective below, after this check, and
          // redefinition there is detected by the same has() test only on
          // later lines.
          this.errors.push({ line: ln.lineNo, message: `Duplicate label "${ln.label}".` });
        } else {
          this.symbols.set(key, pc);
        }
      }
      if (!ln.mnemonic) continue;

      const d = this.processDirective(ln, pc);
      if (d.kind === 'handled') {
        pc = d.pc;
        continue;
      }

      const size = this.lineSize(ln.mnemonic, ln.operands, ln.lineNo);
      pc = (pc + size) & 0xffff;
    }
  }

  private lineSize(mn: string, ops: string[], lineNo: number): number {
    switch (mn) {
      case 'DB':
        return this.dbSize(ops, lineNo);
      case 'DW':
        return ops.length * 2;
      case 'DS': {
        if (ops.length !== 1) return 0;
        const v = this.evalExpr(ops[0]!, lineNo, 16);
        return v ?? 0;
      }
      default:
        return this.encode(mn, ops, lineNo).length;
    }
  }

  /* ---------------- pass 2: emit ---------------- */

  private pass2(): Array<{ start: number; bytes: number[] }> {
    this.passNum = 2;
    const segments: Array<{ start: number; bytes: number[] }> = [];
    let cur: { start: number; bytes: number[] } | null = null;
    let pc = 0x0000;

    const emit = (byte: number): void => {
      if (!cur) {
        cur = { start: pc, bytes: [] };
        segments.push(cur);
      }
      cur.bytes.push(byte & 0xff);
      pc = (pc + 1) & 0xffff;
    };

    for (const ln of this.lines) {
      const startAddr = pc;
      let emittedThisLine = 0;

      if (!ln.mnemonic) {
        this.listing.push({ line: ln.lineNo, addr: null, bytes: [], text: ln.raw.trim() });
        continue;
      }
      const mn = ln.mnemonic;

      const d = this.processDirective(ln, pc);
      if (d.kind === 'handled') {
        pc = d.pc;
        cur = null; // ORG breaks the contiguous segment
        this.listing.push({ line: ln.lineNo, addr: null, bytes: [], text: ln.raw.trim() });
        continue;
      }

      switch (mn) {
        case 'DB':
          for (const op of ln.operands) {
            for (const b of this.dbBytes(op, ln.lineNo)) { emit(b); emittedThisLine++; }
          }
          break;
        case 'DW':
          for (const op of ln.operands) {
            const v = this.evalExpr(op, ln.lineNo, 16);
            if (v === null) continue;
            if (v < 0 || v > 0xffff) {
              this.fail(ln.lineNo, `DW value ${fmt(v)}H does not fit in 16 bits.`);
              continue;
            }
            emit(v & 0xff);
            emit((v >> 8) & 0xff);
            emittedThisLine += 2;
          }
          break;
        case 'DS': {
          const v = this.evalExpr(ln.operands[0] ?? '0', ln.lineNo, 16);
          if (v !== null && v > 0) {
            for (let i = 0; i < v; i++) { emit(0); emittedThisLine++; }
          }
          break;
        }
        default:
          for (const b of this.encode(mn, ln.operands, ln.lineNo)) { emit(b); emittedThisLine++; }
      }

      const lastSeg = segments[segments.length - 1];
      const bytes =
        emittedThisLine > 0 && lastSeg
          ? lastSeg.bytes.slice(lastSeg.bytes.length - emittedThisLine)
          : [];
      this.listing.push({
        line: ln.lineNo,
        addr: emittedThisLine > 0 ? startAddr : null,
        bytes,
        text: ln.raw.trim(),
      });
    }

    return segments.filter((s) => s.bytes.length > 0);
  }

  /* ---------------- expression evaluation ---------------- */

  /** Evaluate an operand expression: number or label. */
  private evalExpr(text: string, lineNo: number, _bits: 8 | 16): number | null {
    const t = text.trim().toUpperCase();
    if (!t) {
      this.fail(lineNo, 'Missing operand.');
      return null;
    }

    // Character literal.
    const ch = /^'([^'])'$/.exec(text.trim());
    if (ch) return ch[1]!.charCodeAt(0) & 0xff;

    const num = parseNumber(t);
    if (num !== null) return num;

    if (this.symbols.has(t)) return this.symbols.get(t)!;
    if (this.passNum === 1) return 0; // dummy: sizing must tolerate forward refs
    this.fail(lineNo, `Undefined symbol "${text.trim()}".`);
    return null;
  }

  /* ---------------- DB helpers ---------------- */

  private dbBytes(op: string, lineNo: number): number[] {
    const t = op.trim();
    const str = /^"([^"]*)"$/.exec(t) || /^'([^']{2,})'$/.exec(t);
    if (str) return Array.from(str[1]!, (c) => c.charCodeAt(0) & 0xff);
    const v = this.evalExpr(t, lineNo, 8);
    if (v === null) return [];
    if (v < 0 || v > 0xff) {
      this.fail(lineNo, `DB value ${fmt(v)}H does not fit in a byte.`);
      return [];
    }
    return [v];
  }

  private dbSize(ops: string[], lineNo: number): number {
    let n = 0;
    for (const op of ops) {
      const t = op.trim();
      const str = /^"([^"]*)"$/.exec(t) || /^'([^']{2,})'$/.exec(t);
      if (str) n += str[1]!.length;
      else if (this.evalExpr(t, lineNo, 8) !== null) n += 1;
    }
    return n;
  }

  /* ---------------- encoding ---------------- */

  private encode(mn: string, ops: string[], lineNo: number): number[] {
    const E = (msg: string): number[] => {
      this.fail(lineNo, msg);
      return [];
    };

    if (ops.length === 0) {
      const simple = SIMPLE_ENCODINGS[mn];
      if (simple !== undefined) return [simple];
      if (mn === 'RST') return E('RST requires a vector number 0–7.');
      // A mnemonic that exists nowhere in the ISA table is unknown.
      if (!ALL_MNEMONICS.includes(mn)) return E(`Unknown instruction or directive "${mn}".`);
      return E(`Instruction "${mn}" requires operands.`);
    }

    switch (mn) {
      case 'MOV': {
        if (ops.length !== 2) return E('MOV requires two register operands.');
        const d = this.reg(ops[0]!, lineNo);
        const s = this.reg(ops[1]!, lineNo);
        if (d === null || s === null) return [];
        if (d === 6 && s === 6) return E('MOV M,M is not a valid instruction (that opcode is HLT).');
        return [0x40 | (d << 3) | s];
      }
      case 'MVI': {
        if (ops.length !== 2) return E('MVI requires a register and an 8-bit value.');
        const r = this.reg(ops[0]!, lineNo);
        const v = this.evalExpr(ops[1]!, lineNo, 8);
        if (r === null || v === null) return [];
        if (v < 0 || v > 0xff) return E(`Value ${fmt(v)}H does not fit in 8 bits.`);
        return [0x06 | (r << 3), v];
      }
      case 'LXI': {
        if (ops.length !== 2) return E('LXI requires a register pair and a 16-bit value.');
        const p = this.pair(ops[0]!, lineNo);
        const v = this.evalExpr(ops[1]!, lineNo, 16);
        if (p === null || v === null) return [];
        if (v < 0 || v > 0xffff) return E(`Value ${fmt(v)}H does not fit in 16 bits.`);
        return [0x01 | (p << 4), v & 0xff, (v >> 8) & 0xff];
      }
      case 'LDA': case 'STA': case 'LHLD': case 'SHLD':
      case 'JMP': case 'CALL': {
        if (ops.length !== 1) return E(`${mn} requires exactly one 16-bit address.`);
        const v = this.evalExpr(ops[0]!, lineNo, 16);
        if (v === null) return [];
        if (v < 0 || v > 0xffff) return E(`Address ${fmt(v)}H does not fit in 16 bits.`);
        return [DIRECT_BASE[mn]!, v & 0xff, (v >> 8) & 0xff];
      }
      case 'LDAX': case 'STAX': {
        if (ops.length !== 1) return E(`${mn} requires a register pair (B or D).`);
        const p = this.pair(ops[0]!, lineNo);
        if (p === null) return [];
        if (p !== 0 && p !== 1) return E(`${mn} only supports the B or D pair.`);
        return [(mn === 'LDAX' ? 0x0a : 0x02) + p * 0x10];
      }
      case 'INX': case 'DCX': case 'DAD': {
        if (ops.length !== 1) return E(`${mn} requires a register pair.`);
        const p = this.pair(ops[0]!, lineNo);
        if (p === null) return [];
        const base = mn === 'INX' ? 0x03 : mn === 'DCX' ? 0x0b : 0x09;
        return [base | (p << 4)];
      }
      case 'INR': case 'DCR': {
        if (ops.length !== 1) return E(`${mn} requires one register operand.`);
        const r = this.reg(ops[0]!, lineNo);
        if (r === null) return [];
        return [(mn === 'INR' ? 0x04 : 0x05) | (r << 3)];
      }
      case 'PUSH': case 'POP': {
        if (ops.length !== 1) return E(`${mn} requires a register pair or PSW.`);
        const t = ops[0]!.trim().toUpperCase();
        if (t === 'PSW') return [mn === 'PUSH' ? 0xf5 : 0xf1];
        const p = this.pair(t, lineNo);
        if (p === null) return [];
        if (p === 3) return E(`${mn} SP is not valid; use PUSH PSW / POP PSW for the flags.`);
        return [(mn === 'PUSH' ? 0xc5 : 0xc1) | (p << 4)];
      }
      case 'RST': {
        if (ops.length !== 1) return E('RST requires a vector number 0–7.');
        const v = this.evalExpr(ops[0]!, lineNo, 8);
        if (v === null) return [];
        if (v < 0 || v > 7) return E('RST vector must be 0–7.');
        return [0xc7 | (v << 3)];
      }
      case 'IN': case 'OUT': {
        if (ops.length !== 1) return E(`${mn} requires one 8-bit I/O address.`);
        const v = this.evalExpr(ops[0]!, lineNo, 8);
        if (v === null) return [];
        if (v < 0 || v > 0xff) return E(`I/O address ${fmt(v)}H is not an 8-bit port address.`);
        return [mn === 'IN' ? 0xdb : 0xd3, v];
      }
      case 'ADI': case 'ACI': case 'SUI': case 'SBI':
      case 'ANI': case 'XRI': case 'ORI': case 'CPI': {
        if (ops.length !== 1) return E(`${mn} requires one 8-bit value.`);
        const v = this.evalExpr(ops[0]!, lineNo, 8);
        if (v === null) return [];
        if (v < 0 || v > 0xff) return E(`Value ${fmt(v)}H does not fit in 8 bits.`);
        return [IMM_BASE[mn]!, v];
      }
      default: {
        // Register ALU ops.
        if (ops.length === 1 && ALU_REG_MNEMONICS.has(mn)) {
          const r = this.reg(ops[0]!, lineNo);
          if (r === null) return [];
          return [ALU_REG_BASE[mn]! | r];
        }
        // Jcc / Ccc with address, Rcc without.
        const kind = mn[0];
        const condName = mn.slice(1);
        if (COND_CODE[condName] !== undefined && (kind === 'J' || kind === 'C' || kind === 'R')) {
          const cc = COND_CODE[condName]!;
          if (kind === 'R') {
            if (ops.length > 0) return E(`${mn} takes no operand.`);
            return [0xc0 | (cc << 3)];
          }
          if (ops.length !== 1) return E(`${mn} requires one 16-bit address.`);
          const v = this.evalExpr(ops[0]!, lineNo, 16);
          if (v === null) return [];
          if (v < 0 || v > 0xffff) return E(`Address ${fmt(v)}H does not fit in 16 bits.`);
          const base = kind === 'J' ? 0xc2 : 0xc4;
          return [base | (cc << 3), v & 0xff, (v >> 8) & 0xff];
        }
        return E(`Unknown instruction or directive "${mn}".`);
      }
    }
  }

  private reg(text: string, lineNo: number): number | null {
    const t = text.trim().toUpperCase();
    const r = REG_CODE[t];
    if (r === undefined) {
      this.fail(lineNo, `"${text.trim()}" is not a register (expected one of ${REG_NAMES.join(', ')}).`);
      return null;
    }
    return r;
  }

  private pair(text: string, lineNo: number): number | null {
    const t = text.trim().toUpperCase();
    const p = PAIR_CODE[t];
    if (p === undefined) {
      this.fail(lineNo, `"${text.trim()}" is not a register pair (expected B, D, H or SP).`);
      return null;
    }
    return p;
  }
}

function splitOperands(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of s) {
    if (inQuote) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((o) => o.trim()).filter((o) => o !== '');
}

function parseNumber(t: string): number | null {
  if (/^[0-9A-F]+H$/.test(t)) return parseInt(t.slice(0, -1), 16);
  if (/^0X[0-9A-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^[01]+B$/.test(t)) return parseInt(t.slice(0, -1), 2);
  if (/^[0-9]+D?$/.test(t)) return parseInt(t.replace(/D$/, ''), 10);
  return null;
}
