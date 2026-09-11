/**
 * Analog sensors: potentiometer, LM35-style temperature, LDR light sensor.
 *
 * Each drives ONE analog output pin whose voltage follows a user-adjustable
 * level (knob/slider). The circuit engine propagates `analog` volts along
 * wires, so an ADC wired to the output digitizes exactly what the body
 * shows. Sensor settings are physical state — they survive CPU reset.
 *
 * Documented simplification: power/ground pins are implied; only the signal
 * pin is modeled.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

/** Shared shape: one analog out pin driven from a level in [0, maxLevel]. */
export abstract class AnalogSensor implements Component {
  readonly id: string;
  abstract readonly type: string;
  label: string;
  x: number;
  y: number;

  /** Unit shown next to the level ('%', '°C', …). */
  abstract readonly unit: string;
  /** Highest level the slider/inspector accepts. */
  abstract readonly maxLevel: number;
  /** Inspector label for the level property. */
  abstract readonly levelLabel: string;

  private levelValue = 0;
  private readonly pin: Pin;

  protected constructor(id: string, x: number, y: number, label: string) {
    this.id = id;
    this.label = label;
    this.x = x;
    this.y = y;
    const def: PinDef = { id: 'out', label: 'OUT', dir: 'out' };
    this.pin = { ...def, digital: 0 };
  }

  /** Voltage (V) produced at a given level. */
  protected abstract voltageFor(level: number): number;

  getPinDefs(): PinDef[] {
    return [{ id: 'out', label: 'OUT', dir: 'out' }];
  }

  getPinDir(): 'out' {
    return 'out';
  }

  getPin(pinId: string): Pin {
    if (pinId !== 'out') throw new Error(`${this.label}: unknown pin ${pinId}`);
    return this.pin;
  }

  onPinChange(_pinId: string): void {
    // Outputs are never driven externally; the engine won't call this.
  }

  getLevel(): number {
    return this.levelValue;
  }

  /** Set the sensing level (clamped to range) and re-drive the pin. */
  setLevel(n: number): void {
    this.levelValue = Math.max(0, Math.min(this.maxLevel, Math.round(n)));
    this.drive();
  }

  /** Output voltage right now, in volts. */
  volts(): number {
    return this.voltageFor(this.levelValue);
  }

  private drive(): void {
    const v = this.volts();
    this.pin.analog = v;
    this.pin.digital = v >= 2.5 ? 1 : 0; // live coloring on the wire
  }

  tick(_tstates: number): void {
    // Static sensing — no timing.
  }

  reset(): void {
    // A knob/ambient condition is physical: keep it, just re-drive.
    this.drive();
  }

  getConfig() {
    return { level: this.levelValue };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.level === 'number') this.setLevel(cfg.level);
  }

  getProperties() {
    return [{ key: 'level', label: this.levelLabel, kind: 'number' as const, min: 0, max: this.maxLevel }];
  }
}

/** 10 kΩ potentiometer as a 0–5 V divider. */
export class Potentiometer extends AnalogSensor {
  readonly type = 'potentiometer';
  readonly unit = '%';
  readonly maxLevel = 100;
  readonly levelLabel = 'Position (%)';

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 'Potentiometer');
  }

  protected voltageFor(level: number): number {
    return (level / 100) * 5;
  }
}

/** LM35-style sensor: 10 mV per °C. */
export class TempSensor extends AnalogSensor {
  readonly type = 'tempSensor';
  readonly unit = '°C';
  readonly maxLevel = 150;
  readonly levelLabel = 'Temperature (°C)';

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 'LM35 sensor');
  }

  protected voltageFor(level: number): number {
    return level * 0.01;
  }
}

/**
 * CdS LDR + 10 kΩ divider to 5 V: resistance falls (roughly logarithmically)
 * with light, so the node voltage RISES with light — 1 MΩ dark (~0.05 V) to
 * ~100 Ω bright (~4.95 V), passing 2.5 V around half brightness.
 */
export class LightSensor extends AnalogSensor {
  readonly type = 'lightSensor';
  readonly unit = '%';
  readonly maxLevel = 100;
  readonly levelLabel = 'Light level (%)';

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 'Light sensor');
  }

  protected voltageFor(level: number): number {
    const ldr = 1e6 * Math.pow(10, -level / 25); // 1 MΩ dark → 100 Ω bright
    return (5 * 10000) / (ldr + 10000);
  }
}

export const POTENTIOMETER_META: ComponentMeta = {
  type: 'potentiometer',
  title: 'Potentiometer',
  short: 'Adjustable 0–5 V knob',
  about:
    'A 10 kΩ potentiometer wired as a voltage divider between 0 V and 5 V. ' +
    'Drag the slider: the OUT pin carries level% of 5 V. Wire it to an ADC ' +
    'analog input to digitize the position, or use it as a manual test ' +
    'voltage. Power pins are implied — only the signal pin is modeled.',
  width: 210,
  height: 140,
  create: (id, x, y) => new Potentiometer(id, x, y),
};

export const TEMP_SENSOR_META: ComponentMeta = {
  type: 'tempSensor',
  title: 'LM35 sensor',
  short: 'Temperature sensor, 10 mV/°C',
  about:
    'An LM35-style analog temperature sensor: the OUT pin carries 10 mV per ' +
    '°C (0 °C → 0 V, 100 °C → 1.00 V). Tip: set the ADC Vref+ to 2.56 V and ' +
    'the converted byte reads the temperature directly in °C ' +
    '(V/2.56 × 256 = V × 100 = temp).',
  width: 210,
  height: 140,
  create: (id, x, y) => new TempSensor(id, x, y),
};

export const LIGHT_SENSOR_META: ComponentMeta = {
  type: 'lightSensor',
  title: 'Light sensor',
  short: 'LDR — light level to voltage',
  about:
    'A CdS light-dependent resistor in a divider with 10 kΩ: more light → ' +
    'lower LDR resistance → higher voltage (roughly 0.05 V in the dark, ' +
    '2.5 V at half brightness, 4.95 V in bright light — a log response, ' +
    'like a real LDR). Wire OUT to an ADC channel and digitize the light ' +
    'level.',
  width: 210,
  height: 140,
  create: (id, x, y) => new LightSensor(id, x, y),
};
