/**
 * LED bank: 8 discrete LEDs driven by 8 input pins.
 *
 * Purely passive — it never drives a wire, only displays. An LED lights when
 * its pin is high (or low, if `activeLow` — many trainer kits wire LEDs to Vcc
 * through the port, so the bit must be 0 to light them).
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

const PIN_DEFS: PinDef[] = Array.from({ length: 8 }, (_, i): PinDef => ({
  id: `D${i}`,
  label: `D${i}`,
  dir: 'in',
  group: 'Data in',
}));

export class LedBank implements Component {
  readonly id: string;
  readonly type = 'ledBank';
  label: string;
  x: number;
  y: number;
  activeLow = false;

  private readonly pins = new Map<string, Pin>();

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'LED bank';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(): 'in' {
    return 'in';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`LED bank ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(_pinId: string): void {
    // Display-only; the canvas reads pin states each render.
  }

  /** True when LED n is lit. */
  lit(n: number): boolean {
    const pin = this.pins.get(`D${n}`)!;
    return this.activeLow ? pin.digital === 0 : pin.digital === 1;
  }

  /** 8-bit pattern of lit LEDs, D0 = bit 0. For tests and the card display. */
  litValue(): number {
    let v = 0;
    for (let i = 0; i < 8; i++) if (this.lit(i)) v |= 1 << i;
    return v;
  }

  tick(_tstates: number): void {
    // No internal timing.
  }

  reset(): void {
    // LEDs go dark when the driving port resets; nothing to do here.
  }

  getConfig() {
    return { activeLow: this.activeLow };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.activeLow === 'boolean') this.activeLow = cfg.activeLow;
  }

  getProperties() {
    return [
      {
        key: 'activeLow',
        label: 'Active low (LED lights on 0)',
        kind: 'boolean' as const,
      },
    ];
  }
}

export const LED_BANK_META: ComponentMeta = {
  type: 'ledBank',
  title: 'LED bank',
  short: '8 LEDs, one per data pin',
  about:
    'Eight LEDs with individual input pins D0–D7. Wire a parallel port ' +
    '(e.g. 8255 Port A) to the data pins, configure the port as output, and ' +
    'OUT a byte to display its bits. By default an LED lights when its pin ' +
    'is 1; enable "active low" to model boards where the LED conducts when ' +
    'the port sinks current (bit = 0 lights the LED).',
  width: 250,
  height: 300,
  create: (id, x, y) => new LedBank(id, x, y),
};
