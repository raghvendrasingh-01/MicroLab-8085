/**
 * Oscilloscope: 4-channel waveform viewer.
 *
 * Each channel is a wireable input pin (CH1–CH4) — you probe a signal by
 * wiring it, exactly like clipping a scope lead on a bench. The scope keeps
 * its own time base in CPU T-states (advanced through tick()) and records a
 * sample whenever a wired pin changes, via onPinChange. Digital nets draw as
 * square waves; nets that carry an analog value (sensors, DAC output) draw
 * as a voltage trace — the channel auto-detects from the samples.
 *
 * Documented simplifications:
 *  - Time is T-states of the CPU, not wall-clock seconds.
 *  - No trigger, hold-off, or measurement cursors — samples are recorded on
 *    value change and rendered over a sliding T-state window.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

/** Number of probe channels. */
export const SCOPE_CHANNELS = 4;
/** Per-channel sample cap (oldest are dropped) — bounds memory on long runs. */
export const MAX_SCOPE_SAMPLES = 4096;

/** One recorded signal value at a point in (T-state) time. */
export interface ScopeSample {
  /** T-states since the last reset. */
  t: number;
  /** Logic level of the net at this instant. */
  digital: 0 | 1;
  /** Volts if the net carried an analog value, else null. */
  analog: number | null;
}

const PIN_DEFS: PinDef[] = Array.from({ length: SCOPE_CHANNELS }, (_, i): PinDef => ({
  id: `CH${i + 1}`,
  label: `CH${i + 1}`,
  dir: 'in',
  group: 'Probes',
}));

export class Oscilloscope implements Component {
  readonly id: string;
  readonly type = 'scope';
  label: string;
  x: number;
  y: number;

  /** Display window width in T-states (inspector-adjustable). */
  windowTstates = 20000;
  /** Card display size — drag the corner grip to change (§37). */
  displayW = 370;
  displayH = 320;
  /** Which channels are drawn (index 0 = CH1). */
  readonly chVisible: boolean[] = [true, true, true, true];

  private readonly pins = new Map<string, Pin>();
  private time = 0;
  private readonly samples: ScopeSample[][] = Array.from(
    { length: SCOPE_CHANNELS },
    () => [] as ScopeSample[],
  );

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'Oscilloscope';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(_pinId: string): 'in' {
    return 'in';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`Oscilloscope ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(pinId: string): void {
    const m = /^CH([1-4])$/.exec(pinId);
    if (!m) return;
    const arr = this.samples[Number(m[1]) - 1]!;
    const p = this.pins.get(pinId)!;
    const s: ScopeSample = { t: this.time, digital: p.digital, analog: p.analog ?? null };
    const last = arr[arr.length - 1];
    if (last && last.digital === s.digital && last.analog === s.analog) return; // coalesce
    arr.push(s);
    if (arr.length > MAX_SCOPE_SAMPLES) arr.splice(0, arr.length - MAX_SCOPE_SAMPLES);
  }

  /* ---------------- views for the body / tests ---------------- */

  /** Samples of channel `ch` (1-based), oldest first. */
  getChannel(ch: number): readonly ScopeSample[] {
    return this.samples[ch - 1] ?? [];
  }

  /** Scope time base right now, in T-states since the last reset. */
  now(): number {
    return this.time;
  }

  /** True when channel `ch` has ever carried an analog value. */
  channelIsAnalog(ch: number): boolean {
    return this.getChannel(ch).some((s) => s.analog !== null);
  }

  /* ---------------- lifecycle ---------------- */

  tick(tstates: number): void {
    this.time += tstates;
  }

  reset(): void {
    // A fresh run deserves a fresh trace — the display is cleared so the
    // new program's waveforms don't stack on the previous one's.
    this.time = 0;
    for (const arr of this.samples) arr.length = 0;
  }

  getDisplaySize(): { width: number; height: number } {
    return { width: this.displayW, height: this.displayH };
  }

  resizeTo(width: number, height: number): void {
    this.displayW = Math.max(370, Math.min(1000, Math.round(width)));
    this.displayH = Math.max(320, Math.min(800, Math.round(height)));
  }

  getConfig() {
    return {
      windowTstates: this.windowTstates,
      displayW: this.displayW,
      displayH: this.displayH,
      ch1: this.chVisible[0] ?? true, ch2: this.chVisible[1] ?? true,
      ch3: this.chVisible[2] ?? true, ch4: this.chVisible[3] ?? true,
    };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.windowTstates === 'number') {
      this.windowTstates = Math.max(1000, Math.min(10_000_000, Math.round(cfg.windowTstates)));
    }
    if (typeof cfg.displayW === 'number') {
      this.displayW = Math.max(370, Math.min(1000, Math.round(cfg.displayW)));
    }
    if (typeof cfg.displayH === 'number') {
      this.displayH = Math.max(320, Math.min(800, Math.round(cfg.displayH)));
    }
    for (let ch = 1; ch <= SCOPE_CHANNELS; ch++) {
      const key = `ch${ch}` as 'ch1' | 'ch2' | 'ch3' | 'ch4';
      if (typeof cfg[key] === 'boolean') this.chVisible[ch - 1] = cfg[key] as boolean;
    }
  }

  getProperties() {
    return [
      {
        key: 'windowTstates',
        label: 'Window (T-states)',
        kind: 'number' as const,
        min: 1000,
        max: 10_000_000,
      },
    ];
  }
}

export const OSCILLOSCOPE_META: ComponentMeta = {
  type: 'scope',
  title: 'Oscilloscope',
  short: '4-channel waveform viewer',
  about:
    'A 4-channel waveform viewer. Wire any signal to CH1–CH4 to watch it over ' +
    'time: 8255 port pins, ADC START/EOC, switch contacts, sensor outputs, or ' +
    'the DAC analog output. Digital nets draw as square waves; nets carrying ' +
    'a voltage (sensors, DAC OUT) draw as an analog trace — detection is ' +
    'automatic. The time base is CPU T-states (2 MHz ≈ 1 T-state = 0.5 µs): ' +
    'at the default 20,000-T window you see the last ~10 ms of activity. ' +
    'Widen or narrow the window in the inspector. The trace clears on Reset.',
  width: 370,
  height: 320,
  create: (id, x, y) => new Oscilloscope(id, x, y),
};
