/**
 * DIP switch bank: 8 toggle switches driving 8 output pins.
 *
 * The user flips switches in the canvas; each pin drives its wire (typically
 * into a parallel port configured as input). Switch positions are physical
 * state — they survive CPU reset, exactly like a real board.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

const PIN_DEFS: PinDef[] = Array.from({ length: 8 }, (_, i): PinDef => ({
  id: `S${i}`,
  label: `S${i}`,
  dir: 'out',
  group: 'Switches',
}));

export class DipSwitches implements Component {
  readonly id: string;
  readonly type = 'dipSwitches';
  label: string;
  x: number;
  y: number;

  private readonly pins = new Map<string, Pin>();

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'DIP switches';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(): 'out' {
    return 'out';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`DIP switches ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(_pinId: string): void {
    // Outputs are never driven externally; the engine won't call this.
  }

  /** Flip one switch. The store re-propagates the circuit afterwards. */
  toggle(pinId: string): void {
    const p = this.pins.get(pinId);
    if (!p) return;
    p.digital = p.digital ? 0 : 1;
  }

  setSwitch(pinId: string, on: boolean): void {
    const p = this.pins.get(pinId);
    if (p) p.digital = on ? 1 : 0;
  }

  /** 8-bit switch pattern, S0 = bit 0. */
  switchValue(): number {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      if (this.pins.get(`S${i}`)!.digital) v |= 1 << i;
    }
    return v;
  }

  tick(_tstates: number): void {
    // Mechanical — no timing.
  }

  reset(): void {
    // Switches are physical toggles: deliberately NOT cleared on reset.
  }

  getConfig() {
    return { switches: this.switchValue() };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.switches === 'number') {
      for (let i = 0; i < 8; i++) {
        this.pins.get(`S${i}`)!.digital = (((cfg.switches >> i) & 1) as 0 | 1);
      }
    }
  }

  getProperties() {
    return []; // toggled directly on the canvas
  }
}

export const DIP_SWITCH_META: ComponentMeta = {
  type: 'dipSwitches',
  title: 'DIP switches',
  short: '8 toggle switches the user flips',
  about:
    'Eight manual toggle switches, each driving one output pin S0–S7. Wire ' +
    'them to a parallel port configured as input, then IN from that port to ' +
    'read the switch pattern into the accumulator. Switch positions persist ' +
    'across CPU reset, like physical hardware.',
  width: 250,
  height: 300,
  create: (id, x, y) => new DipSwitches(id, x, y),
};
