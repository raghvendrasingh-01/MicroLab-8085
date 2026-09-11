/**
 * Component registry: every placeable hardware type.
 *
 * Adding a new peripheral to MicroLab means writing one file exporting a
 * ComponentMeta and adding a line here. Nothing else in the system changes —
 * not the CPU, not the machine, not the canvas (it renders whatever the
 * registry contains).
 */
import type { ComponentMeta } from '../core/circuit';
import { I8255_META } from './i8255';
import { LED_BANK_META } from './ledBank';
import { DIP_SWITCH_META } from './dipSwitches';
import { SEVEN_SEGMENT_META } from './sevenSegment';
import { KEYPAD_META } from './keypad';
import { LCD_META } from './lcd';
import { ADC0808_META } from './adc0808';
import { POTENTIOMETER_META, TEMP_SENSOR_META, LIGHT_SENSOR_META } from './sensors';
import { DAC0808_META } from './dac0808';
import { OSCILLOSCOPE_META } from './scope';

export const REGISTRY: Record<string, ComponentMeta> = {
  [I8255_META.type]: I8255_META,
  [LED_BANK_META.type]: LED_BANK_META,
  [DIP_SWITCH_META.type]: DIP_SWITCH_META,
  [SEVEN_SEGMENT_META.type]: SEVEN_SEGMENT_META,
  [KEYPAD_META.type]: KEYPAD_META,
  [LCD_META.type]: LCD_META,
  [ADC0808_META.type]: ADC0808_META,
  [POTENTIOMETER_META.type]: POTENTIOMETER_META,
  [TEMP_SENSOR_META.type]: TEMP_SENSOR_META,
  [LIGHT_SENSOR_META.type]: LIGHT_SENSOR_META,
  [DAC0808_META.type]: DAC0808_META,
  [OSCILLOSCOPE_META.type]: OSCILLOSCOPE_META,
};

export function metaFor(type: string): ComponentMeta | undefined {
  return REGISTRY[type];
}

export const ALL_TYPES = Object.keys(REGISTRY);
