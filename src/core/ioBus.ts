/**
 * 8085 I/O address space (256 addresses).
 *
 * The 8085 has a separate I/O map addressed by `IN port` / `OUT port`.
 * Peripherals register an address window [base, base+size). Reads and writes
 * are routed to the owning peripheral. Conflicting registrations are rejected
 * and remembered so the UI/diagnostics can show them clearly.
 */
import type { Peripheral } from './circuit';

export interface IoConflict {
  address: number;
  first: string;
  second: string;
}

export class IoBus {
  /** 256-entry map of address → peripheral (or null). */
  private readonly map: Array<Peripheral | null> = new Array(256).fill(null);
  private readonly conflicts: IoConflict[] = [];

  /** Attempt to register a peripheral; returns false on conflict. */
  register(p: Peripheral): boolean {
    const base = p.baseAddress & 0xff;
    const size = p.addressCount;
    for (let a = base; a < base + size; a++) {
      const addr = a & 0xff;
      const existing = this.map[addr];
      if (existing && existing !== p) {
        this.conflicts.push({
          address: addr,
          first: `${existing.label} (${existing.type})`,
          second: `${p.label} (${p.type})`,
        });
        return false;
      }
    }
    for (let a = base; a < base + size; a++) {
      this.map[a & 0xff] = p;
    }
    return true;
  }

  /** Remove a peripheral from the map (all its addresses). */
  unregister(p: Peripheral): void {
    for (let a = 0; a < 256; a++) {
      if (this.map[a] === p) this.map[a] = null;
    }
  }

  /** Re-register after a base-address change. */
  rebase(p: Peripheral): boolean {
    this.unregister(p);
    return this.register(p);
  }

  /** First free window of `size` consecutive addresses (auto-placement). */
  freeWindow(size: number, preferredStart = 0): number {
    for (let base = preferredStart; base + size <= 256; base++) {
      let free = true;
      for (let a = base; a < base + size; a++) {
        if (this.map[a]) {
          free = false;
          break;
        }
      }
      if (free) return base;
    }
    return 0; // nothing free: caller must deal with the conflict
  }

  getConflicts(): readonly IoConflict[] {
    return this.conflicts;
  }

  clearConflicts(): void {
    this.conflicts.length = 0;
  }

  /** Which addresses a peripheral currently occupies (for the I/O panel). */
  occupiedBy(p: Peripheral): number[] {
    const out: number[] = [];
    for (let a = 0; a < 256; a++) if (this.map[a] === p) out.push(a);
    return out;
  }

  /** Address → owning peripheral name, for the I/O map view. */
  ownerAt(addr: number): Peripheral | null {
    return this.map[addr & 0xff] ?? null;
  }

  read(port: number): number {
    const p = this.map[port & 0xff];
    if (!p) return 0xff; // unconnected bus reads float high (pulled up)
    return p.ioRead(port & 0xff) & 0xff;
  }

  write(port: number, value: number): void {
    const p = this.map[port & 0xff];
    if (!p) return; // writes to unassigned addresses are dropped
    p.ioWrite(port & 0xff, value & 0xff);
  }
}
