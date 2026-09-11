/**
 * Core types shared by the simulation engine.
 *
 * MicroLab 8085 is organized as:
 *   CPU → System Bus → Memory (64 K) + I/O Bus (256 addresses) → Peripherals
 *   Peripherals ↔ Pins ↔ Wires (connections) ↔ Components (LEDs, sensors, …)
 *
 * Nothing in this file imports anything else — it is the bottom of the
 * dependency graph.
 */

/** A single digital/analog signal state on a pin. */
export interface PinState {
  /** 0 or 1 for digital pins; undefined for analog-only pins. */
  digital: 0 | 1;
  /** Analog value in volts when the pin carries an analog signal. */
  analog?: number;
}

/** Effective direction of a pin, used by the wiring engine. */
export type PinDir = 'in' | 'out' | 'io';

/** Static definition of a pin (identity); runtime value lives in the component. */
export interface PinDef {
  /** Stable pin id, unique within a component (e.g. 'PA3', 'D0', 'EN'). */
  id: string;
  /** Human-readable label shown on the circuit canvas. */
  label: string;
  /** Nominal direction. 'io' pins resolve to in/out dynamically (e.g. 8255 ports). */
  dir: PinDir;
  /** Optional grouping label for canvas layout (e.g. 'Port A', 'Data'). */
  group?: string;
}

/** A wire between two pins of two components. */
export interface Connection {
  id: string;
  /** Component id of the first endpoint. */
  fromComponent: string;
  /** Pin id within the first component. */
  fromPin: string;
  /** Component id of the second endpoint. */
  toComponent: string;
  /** Pin id within the second component. */
  toPin: string;
}

/** Console severity levels for the lab console panel. */
export type ConsoleKind = 'info' | 'warn' | 'error' | 'success';

/** One console line entry. */
export interface ConsoleEntry {
  id: number;
  kind: ConsoleKind;
  text: string;
  /** Wall-clock ms timestamp. */
  at: number;
  /** Source line this entry refers to (assembly errors) — makes the
      console entry clickable to navigate the editor. */
  line?: number;
}
