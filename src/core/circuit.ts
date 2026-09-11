/**
 * Component and Peripheral interfaces.
 *
 * EVERY piece of virtual hardware in MicroLab implements `Component`.
 * I/O-mapped devices additionally implement `Peripheral` (8255, ADC when
 * memory-mapped, …). The CPU never imports any concrete peripheral — it only
 * sees the I/O bus. Adding a new peripheral therefore requires zero changes
 * to the CPU or the machine.
 */
import type { Connection, PinDef, PinDir } from './types';

export type { Connection, PinDef, PinDir, PinState } from './types';

/** Runtime state of one pin. */
export interface Pin extends PinDef {
  digital: 0 | 1;
  analog?: number;
}

/** Serializable configuration of a component (inspector edits this). */
export interface ComponentConfig {
  [key: string]: string | number | boolean;
}

/** Property descriptor for the inspector panel. */
export interface PropertyDescriptor {
  key: string;
  label: string;
  kind: 'number' | 'select' | 'text' | 'boolean';
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  /** Changing this property may need a bus re-registration. */
  affectsAddressing?: boolean;
}

export interface Component {
  /** Unique instance id within a circuit. */
  readonly id: string;
  /** Registry type key, e.g. 'i8255', 'ledBank'. */
  readonly type: string;
  /** User-visible label. */
  label: string;
  /** Canvas position. */
  x: number;
  y: number;

  /** Pin definitions in stable order (canvas renders pins from this). */
  getPinDefs(): PinDef[];
  /** Resolve the effective direction of a pin right now ('io' → 'in'/'out'). */
  getPinDir(pinId: string): PinDir;
  /** Read a pin value. */
  getPin(pinId: string): Pin;
  /**
   * The circuit engine calls this when an external driver changes one of this
   * component's input pins. Components must NOT re-propagate from here — the
   * engine owns propagation.
   */
  onPinChange(pinId: string): void;

  /** Advance the component's internal time by n CPU T-states. */
  tick(tstates: number): void;
  reset(): void;
  /** Serializable configuration for project save/load. */
  getConfig(): ComponentConfig;
  setConfig(cfg: ComponentConfig): void;
  /** Inspector schema. */
  getProperties(): PropertyDescriptor[];

  /**
   * Components whose card the user can resize on the canvas report their
   * current display size here (falls back to the registry default).
   */
  getDisplaySize?(): { width: number; height: number };
  /** Apply a new display size (clamped by the component). */
  resizeTo?(width: number, height: number): void;
}

/** A component that also occupies I/O addresses (IN/OUT reachable). */
export interface Peripheral extends Component {
  /** First I/O address of the window. */
  baseAddress: number;
  /** Number of consecutive addresses occupied. */
  readonly addressCount: number;
  /** CPU executed `IN addr` on one of our addresses. */
  ioRead(addr: number): number;
  /** CPU executed `OUT addr,value` on one of our addresses. */
  ioWrite(addr: number, value: number): void;
  /** Human-readable description of each address in the window. */
  describeAddress(offset: number): string;
}

/** Extra info every component type exposes for tooltips / Lab Mode. */
export interface ComponentMeta {
  type: string;
  title: string;
  short: string;
  /** Longer educational description shown in Lab Mode. */
  about: string;
  /** Canvas footprint. */
  width: number;
  height: number;
  /** Creates a fresh instance. */
  create: (id: string, x: number, y: number) => Component;
}

export function isPeripheral(c: Component): c is Peripheral {
  return (
    'baseAddress' in c &&
    'addressCount' in c &&
    'ioRead' in c &&
    'ioWrite' in c
  );
}

/** A full circuit: components + wires. Owns signal propagation. */
export class Circuit {
  readonly components = new Map<string, Component>();
  readonly connections: Connection[] = [];
  private nextConnId = 1;

  add(c: Component): void {
    this.components.set(c.id, c);
  }

  remove(id: string): void {
    this.components.delete(id);
    // Drop dangling wires.
    for (let i = this.connections.length - 1; i >= 0; i--) {
      const w = this.connections[i]!;
      if (w.fromComponent === id || w.toComponent === id) {
        this.connections.splice(i, 1);
      }
    }
  }

  get(id: string): Component | undefined {
    return this.components.get(id);
  }

  /** Move a component to the top of the render order (Map insertion order). */
  bringToFront(id: string): void {
    const c = this.components.get(id);
    if (!c || this.components.size < 2) return;
    this.components.delete(id);
    this.components.set(id, c);
  }

  /** Move a component below all others. */
  sendToBack(id: string): void {
    const c = this.components.get(id);
    if (!c || this.components.size < 2) return;
    const rest = [...this.components.entries()].filter(([k]) => k !== id);
    this.components.clear();
    this.components.set(id, c);
    for (const [k, v] of rest) this.components.set(k, v);
  }

  connect(fromComponent: string, fromPin: string, toComponent: string, toPin: string): Connection | null {
    const a = this.components.get(fromComponent);
    const b = this.components.get(toComponent);
    if (!a || !b) return null;
    const pa = a.getPinDefs().find((p) => p.id === fromPin);
    const pb = b.getPinDefs().find((p) => p.id === toPin);
    if (!pa || !pb) return null;
    // No duplicate wires.
    const dup = this.connections.some(
      (w) =>
        (w.fromComponent === fromComponent && w.fromPin === fromPin && w.toComponent === toComponent && w.toPin === toPin) ||
        (w.fromComponent === toComponent && w.fromPin === toPin && w.toComponent === fromComponent && w.toPin === fromPin),
    );
    if (dup) return null;
    const conn: Connection = {
      id: `w${this.nextConnId++}`,
      fromComponent,
      fromPin,
      toComponent,
      toPin,
    };
    this.connections.push(conn);
    this.propagate();
    return conn;
  }

  disconnect(connId: string): void {
    const i = this.connections.findIndex((w) => w.id === connId);
    if (i >= 0) this.connections.splice(i, 1);
  }

  /**
   * Propagate signals across all wires until stable (bounded to guard
   * against feedback loops). For each wire the engine finds the driving
   * side (the endpoint whose effective pin direction is 'out') and copies
   * its value to the other endpoint, notifying the receiving component.
   *
   * A wire with NO driver (both ends inputs — e.g. an 8255 port that was
   * just switched from output to input) is pulled low: both pins read 0.
   * This models a quiet net so LEDs go dark instead of freezing their last
   * driven value.
   */
  propagate(): void {
    const MAX_PASSES = 8;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let anyChange = false;
      for (const w of this.connections) {
        const a = this.components.get(w.fromComponent);
        const b = this.components.get(w.toComponent);
        if (!a || !b) continue;
        const pa = a.getPin(w.fromPin);
        const pb = b.getPin(w.toPin);
        if (!pa || !pb) continue;
        const aDrives = effectiveDir(a, w.fromPin) === 'out';
        const bDrives = effectiveDir(b, w.toPin) === 'out';
        if (aDrives === bDrives) {
          if (
            !aDrives &&
            (pa.digital !== 0 || pb.digital !== 0 || pa.analog !== undefined || pb.analog !== undefined)
          ) {
            pa.digital = 0;
            pa.analog = undefined;
            pb.digital = 0;
            pb.analog = undefined;
            a.onPinChange(w.fromPin);
            b.onPinChange(w.toPin);
            anyChange = true;
          }
          continue; // in-in pulled low above; two drivers: bus contention, do nothing
        }
        const src = aDrives ? pa : pb;
        const dstComp = aDrives ? b : a;
        const dst = aDrives ? pb : pa;
        const dstId = aDrives ? w.toPin : w.fromPin;
        if (dst.digital !== src.digital || dst.analog !== src.analog) {
          dst.digital = src.digital;
          dst.analog = src.analog;
          dstComp.onPinChange(dstId);
          anyChange = true;
        }
      }
      if (!anyChange) return;
    }
    // Unstable feedback loop after MAX_PASSES: leave values as-is; the
    // diagnostics panel can report oscillating nets if this ever matters.
  }

  /** Snapshot every component's public state for the UI (type-tagged). */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, c] of this.components) {
      out[id] = { type: c.type, ...c.getConfig(), __pins: pinSnapshot(c) };
    }
    return out;
  }
}

function pinSnapshot(c: Component): Record<string, { digital: 0 | 1; analog?: number }> {
  const out: Record<string, { digital: 0 | 1; analog?: number }> = {};
  for (const def of c.getPinDefs()) {
    const p = c.getPin(def.id);
    out[def.id] = { digital: p.digital, analog: p.analog };
  }
  return out;
}

function effectiveDir(c: Component, pinId: string): PinDir {
  const d = c.getPinDir(pinId);
  return d; // 'in' | 'out' | 'io' — 'io' is never a driver
}
