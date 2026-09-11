/**
 * Machine-level project instantiation: rebuild a circuit, I/O map and
 * component configs from a ProjectFile — no UI state involved.
 *
 * Shared by the lab store (open / import / experiments) and by tests, so the
 * thing a test exercises is exactly the thing the UI loads.
 */
import type { Machine } from './system/machine';
import { isPeripheral, type Component, type Peripheral } from './core/circuit';
import { metaFor } from './components/registry';
import type { ProjectFile } from './store/labStore';

export interface InstantiateResult {
  /** False when any component type was unknown. */
  ok: boolean;
  /** Number of wires successfully made. */
  wires: number;
  errors: string[];
  warnings: string[];
  /** Created components by project index (null where the type was unknown). */
  byIndex: (Component | null)[];
}

let projectSeq = 0;

const hex2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');

/** Clear the machine's circuit and rebuild it from `file`. */
export function instantiateProject(machine: Machine, file: ProjectFile): InstantiateResult {
  // Wipe everything from the previous bench.
  for (const id of [...machine.circuit.components.keys()]) machine.removeComponent(id);
  machine.io.clearConflicts();
  machine.breakpoints.clear();

  const errors: string[] = [];
  const warnings: string[] = [];
  const byIndex: (Component | null)[] = [];

  for (const spec of file.components) {
    const meta = metaFor(spec.type);
    if (!meta) {
      errors.push(`Project references unknown component type "${spec.type}" — skipped.`);
      byIndex.push(null);
      continue;
    }
    const id = `${spec.type}#${projectSeq++}`;
    const c = meta.create(id, spec.x, spec.y);
    c.label = spec.label;
    c.setConfig(spec.config);
    byIndex.push(c);
    if (isPeripheral(c)) {
      const p = c as Peripheral;
      if (!machine.io.register(p)) {
        const free = machine.io.freeWindow(p.addressCount);
        p.baseAddress = free;
        machine.io.register(p);
        warnings.push(`${p.label}: saved address conflicts — placed at ${hex2(free)}H.`);
      }
    }
    machine.circuit.add(c);
  }

  let wires = 0;
  let failed = 0;
  for (const w of file.connections) {
    const a = byIndex[w.fromIndex];
    const b = byIndex[w.toIndex];
    if (!a || !b) continue;
    if (machine.circuit.connect(a.id, w.fromPin, b.id, w.toPin)) wires++;
    else failed++;
  }
  if (failed > 0) {
    warnings.push(
      `${failed} connection${failed === 1 ? '' : 's'} could not be made ` +
        '(unknown pin, duplicate wire, or output-to-output conflict).',
    );
  }
  machine.circuit.propagate();
  machine.reset(true); // keep memory, restore PC

  return { ok: errors.length === 0, wires, errors, warnings, byIndex };
}
