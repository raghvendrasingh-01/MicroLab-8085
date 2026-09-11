/**
 * 64 KB simulated memory.
 *
 * Flat RAM for the full address space. The 8085 trainer-kit convention of
 * placing user programs at 2000H is only a convention — every address is
 * readable and writable. Writes are tracked so the UI can highlight recently
 * changed cells.
 */
export class Memory {
  private readonly ram = new Uint8Array(0x10000);
  /** Addresses written since the last `takeChanged()` call. */
  private readonly changed = new Set<number>();

  read(addr: number): number {
    return this.ram[addr & 0xffff] ?? 0;
  }

  write(addr: number, value: number): void {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (this.ram[a] !== v) this.changed.add(a);
    this.ram[a] = v;
  }

  /** Bulk load without marking cells as changed (program loading). */
  load(startAddr: number, bytes: ArrayLike<number>): number {
    for (let i = 0; i < bytes.length; i++) {
      this.ram[(startAddr + i) & 0xffff] = bytes[i]! & 0xff;
    }
    return startAddr + bytes.length;
  }

  /** Drain the set of changed addresses since the last call. */
  takeChanged(): Set<number> {
    const c = this.changed;
    const out = new Set(c);
    c.clear();
    return out;
  }

  clear(): void {
    this.ram.fill(0);
    this.changed.clear();
  }
}
