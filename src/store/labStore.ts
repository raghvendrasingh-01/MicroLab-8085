/**
 * The lab store: the single bridge between the simulation (Machine) and React.
 *
 * The Machine is a mutable class instance held at module scope — React never
 * stores it in state. Instead every mutation bumps a `version` counter; panels
 * read live values from the machine on each render and re-render when the
 * version changes. This keeps the simulation fast (no state copying) and the
 * UI honest (it can only ever display what the simulation actually holds).
 */
import { create } from 'zustand';
import { Assembler, type AsmError, type ListingEntry } from '../asm/assembler';
import { Machine } from '../system/machine';
import { isPeripheral, type Peripheral } from '../core/circuit';
import { metaFor } from '../components/registry';
import { instantiateProject } from '../projectLoad';
import { experimentById } from '../experiments';
import type { ConsoleEntry, ConsoleKind } from '../core/types';

export type SpeedSetting = 'slow' | 'medium' | 'fast' | 'max';

/** Instructions per animation frame. `max` is time-budgeted instead. */
const SPEED_BUDGET: Record<SpeedSetting, number> = {
  slow: 1,
  medium: 40,
  fast: 2500,
  max: Number.POSITIVE_INFINITY,
};

export interface SavedProjectMeta {
  id: string;
  name: string;
  at: number;
}

export interface ProjectFile {
  format: 'microlab-8085-project';
  version: 1;
  name: string;
  source: string;
  components: Array<{
    type: string;
    label: string;
    x: number;
    y: number;
    config: Record<string, string | number | boolean>;
  }>;
  connections: Array<{
    fromIndex: number;
    fromPin: string;
    toIndex: number;
    toPin: string;
  }>;
}

const PROJECTS_KEY = 'microlab.projects';
const PROJECT_KEY = (id: string) => `microlab.project.${id}`;

/** Starter source shown on first launch. */
const DEFAULT_SOURCE = `; MicroLab 8085 — write your program here.
; Example: light alternating LEDs on Port A of the 8255 at 80H.

        ORG 2000H
        MVI A, 80H      ; control word: all ports output
        OUT 83H
        MVI A, 55H      ; 01010101 pattern
        OUT 80H
        HLT
`;

/** The one and only machine instance for this session. */
export const machine = new Machine();
const assembler = new Assembler();

let consoleSeq = 1;
let componentSeq = 1;
/** Peripherals that already warned about unsupported 8255 modes this session. */
const warnedComponents = new Set<string>();

export interface LabState {
  /** Bumped after every simulation mutation — panels re-render on change. */
  version: number;
  runState: Machine['runState'];
  /** Assembly editor content. */
  source: string;
  asmErrors: readonly AsmError[];
  asmOk: boolean;
  listing: readonly ListingEntry[];
  /** Source that produced the currently loaded program ('' = none). */
  loadedFrom: string;
  console: readonly ConsoleEntry[];
  speed: SpeedSetting;
  selected: string | null;
  selectedWire: string | null;
  pendingWire: { componentId: string; pinId: string } | null;
  memoryBase: number;
  /** Component type whose Lab Mode (about) dialog is open. */
  aboutType: string | null;

  // --- program flow ---
  setSource(text: string): void;
  assemble(): boolean;
  run(): void;
  pause(): void;
  step(): void;
  resetLab(): void;
  newProject(): void;
  setSpeed(s: SpeedSetting): void;
  drainMachineErrors(): void;

  // --- circuit editing ---
  addComponent(type: string, x?: number, y?: number): void;
  removeComponent(id: string): void;
  /** Clone a component (type, config, offset position) and select the copy. */
  duplicateComponent(id: string): void;
  /** Reorder: 'front' renders above, 'back' below all others. */
  raiseComponent(id: string, where: 'front' | 'back'): void;
  resizeComponent(id: string, width: number, height: number): void;
  select(id: string | null): void;
  selectWire(id: string | null): void;
  moveComponent(id: string, x: number, y: number): void;
  clickPin(componentId: string, pinId: string, shift: boolean): void;
  cancelWire(): void;
  disconnectWire(connId: string): void;
  /** Canvas interaction: switch toggles, key presses. Routed by type. */
  interact(componentId: string, arg: string): void;
  setProp(componentId: string, key: string, value: string | number | boolean): void;
  setLabel(componentId: string, label: string): void;

  // --- panels ---
  setMemoryBase(base: number): void;
  /** Source line the user is correlating with memory (editor ↔ bytes). */
  focusLine: number | null;
  setFocusLine(line: number | null): void;
  openAbout(type: string | null): void;
  log(kind: ConsoleKind, text: string): void;
  clearConsole(): void;

  // --- breakpoints ---
  toggleBreakpoint(addr: number): void;

  // --- projects ---
  /** id of the loaded prebuilt experiment, if any (drives the panel). */
  activeExperiment: string | null;
  /** Bumped whenever a project/experiment loads — the canvas refits. */
  viewEpoch: number;
  loadExperiment(id: string): void;
  serializeProject(name: string): ProjectFile;
  loadProjectFile(file: ProjectFile): void;
  saveProject(name: string): boolean;
  loadSavedProject(id: string): boolean;
  deleteSavedProject(id: string): void;
  listSavedProjects(): SavedProjectMeta[];
  exportProject(): string;
  importProject(json: string): boolean;
}

export const useLab = create<LabState>((set, get) => {
  const bump = (patch: Partial<LabState> = {}) => set({ version: get().version + 1, ...patch });

  const log = (kind: ConsoleKind, text: string, line?: number) => {
    const entry: ConsoleEntry = { id: consoleSeq++, kind, text, at: Date.now(), ...(line !== undefined ? { line } : {}) };
    const next = [...get().console, entry];
    if (next.length > 300) next.splice(0, next.length - 300);
    set({ console: next });
  };

  /** Surface machine errors + peripheral mode warnings into the console. */
  const drainMachineErrors = () => {
    for (const e of machine.errors) log('error', e.message);
    machine.errors = [];
    for (const c of machine.circuit.components.values()) {
      const w = (c as { lastWarning?: string | null }).lastWarning;
      if (w && !warnedComponents.has(c.id)) {
        warnedComponents.add(c.id);
        log('warn', w);
      }
    }
  };

  const assemble = (): boolean => {
    const src = get().source;
    const r = assembler.assemble(src);
    set({ asmErrors: r.errors, asmOk: r.ok, listing: r.listing });
    if (!r.ok) {
      const first = r.errors[0];
      log('error', `Assembly failed: ${first ? `line ${first.line}: ${first.message}` : 'unknown error'}`, first?.line);
      return false;
    }
    machine.loadProgram(r.segments, r.entry);
    set({ loadedFrom: src });
    const bytes = r.segments.reduce((n, s) => n + s.bytes.length, 0);
    log(
      'success',
      `Assembled ${bytes} byte${bytes === 1 ? '' : 's'} at ${hex4(r.entry ?? 0)}H (${r.segments.length} segment${r.segments.length === 1 ? '' : 's'}), program loaded.`,
    );
    bump();
    return true;
  };

  /** Assemble if the editor changed since the last successful load. */
  const ensureLoaded = (): boolean => {
    if (get().loadedFrom !== get().source || machine.entryPoint === null) return assemble();
    return true;
  };

  return {
    version: 0,
    runState: 'stopped',
    source: DEFAULT_SOURCE,
    asmErrors: [],
    asmOk: true,
    listing: [],
    loadedFrom: '',
    console: [
      { id: consoleSeq++, kind: 'info', text: 'MicroLab 8085 ready. Place components, wire them, assemble and run.', at: Date.now() },
    ],
    speed: 'fast',
    selected: null,
    selectedWire: null,
    pendingWire: null,
    memoryBase: 0x2000,
    focusLine: null,
    aboutType: null,
    activeExperiment: null,
    viewEpoch: 0,

    setSource: (text) => set({ source: text }),

    assemble,

    run: () => {
      if (!ensureLoaded()) return;
      if (machine.runState === 'halted') {
        log('info', 'Program halted — resetting before run.');
        machine.reset(true);
      }
      if (machine.runState === 'paused' || machine.runState === 'stopped') {
        machine.runState = 'running';
      }
      warnedComponents.clear();
      set({ runState: machine.runState });
      bump();
      startRunLoop();
    },

    pause: () => {
      if (machine.runState === 'running') machine.runState = 'paused';
      set({ runState: machine.runState });
      bump();
    },

    step: () => {
      if (!ensureLoaded()) return;
      if (machine.runState === 'halted') {
        log('info', 'Program halted — resetting before stepping.');
        machine.reset(true);
      }
      machine.runState = 'running';
      machine.stepInstruction();
      machine.runState = machine.cpu.halted ? 'halted' : 'paused';
      drainMachineErrors();
      set({ runState: machine.runState });
      bump();
    },

    resetLab: () => {
      stopRunLoop();
      machine.reset(true);
      warnedComponents.clear();
      drainMachineErrors();
      set({ runState: 'stopped', pendingWire: null });
      log('info', 'Lab reset (memory and program kept; CPU and peripherals re-initialized).');
      bump();
    },

    setSpeed: (s) => set({ speed: s }),

    drainMachineErrors,

    addComponent: (type, x, y) => {
      const meta = metaFor(type);
      if (!meta) {
        log('error', `Unknown component type "${type}".`);
        return;
      }
      // Auto-place on the first free spot of a coarse grid so new parts
      // never bury existing cards (explicit x/y from experiments still win).
      const [px, py] =
        x !== undefined && y !== undefined
          ? [x, y]
          : findFreeSpot(meta.width, meta.height);
      const id = `${type}#${componentSeq++}`;
      const c = meta.create(id, px, py);
      if (isPeripheral(c)) {
        const p = c as Peripheral;
        machine.circuit.add(c);
        if (!machine.io.register(p)) {
          const free = machine.io.freeWindow(p.addressCount);
          const old = p.baseAddress;
          p.baseAddress = free;
          machine.io.register(p);
          log(
            'warn',
            `${p.label}: base ${hex2(old)}H conflicts with another device — placed at ${hex2(free)}H instead. Change the base address in the inspector.`,
          );
        }
      } else {
        machine.circuit.add(c);
      }
      machine.circuit.propagate();
      log('info', `Added ${meta.title} (${c.label}).`);
      bump({ selected: id, selectedWire: null });
    },

    removeComponent: (id) => {
      const c = machine.circuit.get(id);
      if (!c) return;
      machine.removeComponent(id);
      warnedComponents.delete(id);
      const pw = get().pendingWire;
      bump({
        selected: get().selected === id ? null : get().selected,
        pendingWire: pw && pw.componentId === id ? null : pw,
      });
      log('info', `Removed ${c.label}.`);
    },

    duplicateComponent: (id) => {
      const src = machine.circuit.get(id);
      const meta = src ? metaFor(src.type) : null;
      if (!src || !meta) return;
      const nid = `${src.type}#${componentSeq++}`;
      const copy = meta.create(nid, src.x + 28, src.y + 28);
      copy.label = `${src.label} (copy)`;
      copy.setConfig(src.getConfig());
      if (isPeripheral(copy)) {
        const p = copy as Peripheral;
        machine.circuit.add(p);
        if (!machine.io.register(p)) {
          // Same base as the original is taken — take the next free window.
          p.baseAddress = machine.io.freeWindow(p.addressCount);
          machine.io.register(p);
          log('warn', `${p.label}: base address in use — placed at ${hex2(p.baseAddress)}H.`);
        }
      } else {
        machine.circuit.add(copy);
      }
      machine.circuit.propagate();
      log('info', `Duplicated ${src.label} → ${copy.label}.`);
      bump({ selected: nid, selectedWire: null });
    },

    raiseComponent: (id, where) => {
      if (where === 'front') machine.circuit.bringToFront(id);
      else machine.circuit.sendToBack(id);
      bump();
    },

    resizeComponent: (id, width, height) => {
      const c = machine.circuit.get(id);
      if (!c?.resizeTo) return;
      c.resizeTo(width, height);
      bump();
    },

    select: (id) => bump({ selected: id, selectedWire: null }),    selectWire: (id) => bump({ selectedWire: id, selected: null }),

    moveComponent: (id, x, y) => {
      const c = machine.circuit.get(id);
      if (!c) return;
      c.x = x;
      c.y = y;
      bump();
    },

    clickPin: (componentId, pinId, shift) => {
      const target = machine.circuit.get(componentId);
      if (!target) return;
      const pw = get().pendingWire;
      if (!pw) {
        set({ pendingWire: { componentId, pinId } });
        return;
      }
      if (pw.componentId === componentId && pw.pinId === pinId) {
        set({ pendingWire: null }); // same pin: cancel
        return;
      }
      const source = machine.circuit.get(pw.componentId);
      if (!source) {
        set({ pendingWire: null });
        return;
      }
      const dirA = source.getPinDir(pw.pinId);
      const dirB = target.getPinDir(pinId);
      if (dirA === 'out' && dirB === 'out') {
        log('error', `Cannot wire ${source.label}.${pw.pinId} to ${target.label}.${pinId}: both pins are outputs (bus contention).`);
        set({ pendingWire: null });
        return;
      }
      if (dirA === 'in' && dirB === 'in') {
        log('info', `Wire ${source.label}.${pw.pinId} → ${target.label}.${pinId} has no driver yet — connect an output pin to one end.`);
      }

      // Shift-click on numbered pins (PA0, D3, …) wires a whole 8-bit bus.
      const aIdx = trailingIndex(pw.pinId);
      const bIdx = trailingIndex(pinId);
      if (shift && aIdx !== null && bIdx !== null) {
        const aPrefix = pw.pinId.slice(0, -String(aIdx).length);
        const bPrefix = pinId.slice(0, -String(bIdx).length);
        let wired = 0;
        for (let i = 0; i < 8; i++) {
          const fromPin = `${aPrefix}${i}`;
          const toPin = `${bPrefix}${i}`;
          if (
            source.getPinDefs().some((d) => d.id === fromPin) &&
            target.getPinDefs().some((d) => d.id === toPin)
          ) {
            if (machine.circuit.connect(pw.componentId, fromPin, componentId, toPin)) wired++;
          }
        }
        if (wired > 0) {
          log('success', `Wired ${wired}-bit bus ${aPrefix}* → ${bPrefix}*.`);
          machine.circuit.propagate();
          set({ pendingWire: null });
          bump();
          return;
        }
        // fall through to single-wire connect if the pattern didn't match
      }

      const conn = machine.circuit.connect(pw.componentId, pw.pinId, componentId, pinId);
      if (conn) {
        log('success', `Wired ${source.label}.${pw.pinId} → ${target.label}.${pinId}.`);
      } else {
        log('warn', `Wire ${source.label}.${pw.pinId} → ${target.label}.${pinId} already exists.`);
      }
      set({ pendingWire: null });
      bump();
    },

    cancelWire: () => set({ pendingWire: null }),

    disconnectWire: (connId) => {
      const w = machine.circuit.connections.find((c) => c.id === connId);
      machine.circuit.disconnect(connId);
      machine.circuit.propagate();
      if (w) log('info', `Removed wire ${w.fromPin} → ${w.toPin}.`);
      bump({ selectedWire: null });
    },

    interact: (componentId, arg) => {
      const c = machine.circuit.get(componentId);
      if (!c) return;
      if (c.type === 'dipSwitches') {
        (c as unknown as { toggle(pinId: string): void }).toggle(arg);
      } else if (c.type === 'keypad') {
        const m = /^(\d+),(\d+)$/.exec(arg);
        if (m) {
          const r = Number(m[1]);
          const col = Number(m[2]);
          (c as unknown as { toggle(key: number): void }).toggle(r * 4 + col);
        }
      } else if (
        c.type === 'potentiometer' ||
        c.type === 'tempSensor' ||
        c.type === 'lightSensor'
      ) {
        const n = Number(arg);
        if (!Number.isNaN(n)) (c as unknown as { setLevel(level: number): void }).setLevel(n);
      } else if (c.type === 'scope') {
        // 'ch1'..'ch4' — toggle which channels the scope draws.
        const m = /^ch([1-4])$/.exec(arg);
        if (!m) return;
        const sc = c as unknown as { chVisible: boolean[] };
        const i = Number(m[1]) - 1;
        sc.chVisible[i] = !(sc.chVisible[i] ?? true);
      } else {
        return;
      }
      machine.circuit.propagate();
      bump();
    },

    setProp: (componentId, key, value) => {
      const c = machine.circuit.get(componentId);
      if (!c) return;
      if (isPeripheral(c) && key === 'baseAddress' && typeof value === 'number') {
        const p = c as Peripheral;
        const old = p.baseAddress;
        p.baseAddress = value & 0xff;
        if (!machine.io.rebase(p)) {
          p.baseAddress = old;
          machine.io.rebase(p);
          log('error', `Address ${hex2(value)}H is already taken — ${p.label} stays at ${hex2(old)}H.`);
          bump();
          return;
        }
        log('success', `${p.label} now based at ${hex2(p.baseAddress)}H.`);
        bump();
        return;
      }
      c.setConfig({ [key]: value });
      machine.circuit.propagate();
      bump();
    },

    setLabel: (componentId, label) => {
      const c = machine.circuit.get(componentId);
      if (!c || !label.trim()) return;
      c.label = label.trim();
      bump();
    },

    setMemoryBase: (base) => set({ memoryBase: base & 0xff00 }),

    setFocusLine: (line) => set({ focusLine: line }),

    openAbout: (type) => set({ aboutType: type }),

    log,

    clearConsole: () => set({ console: [] }),

    toggleBreakpoint: (addr) => {
      if (machine.breakpoints.has(addr)) machine.breakpoints.delete(addr);
      else machine.breakpoints.add(addr);
      bump();
    },

    /* ---------------- projects ---------------- */

    serializeProject: (name) => {
      const comps = [...machine.circuit.components.values()];
      const indexOf = new Map(comps.map((c, i) => [c.id, i]));
      return {
        format: 'microlab-8085-project',
        version: 1,
        name,
        source: get().source,
        components: comps.map((c) => ({
          type: c.type,
          label: c.label,
          x: c.x,
          y: c.y,
          config: c.getConfig(),
        })),
        connections: machine.circuit.connections.map((w) => ({
          fromIndex: indexOf.get(w.fromComponent) ?? -1,
          fromPin: w.fromPin,
          toIndex: indexOf.get(w.toComponent) ?? -1,
          toPin: w.toPin,
        })),
      };
    },

    loadProjectFile: (file) => {
      stopRunLoop();
      warnedComponents.clear();
      const r = instantiateProject(machine, file);
      for (const e of r.errors) log('error', e);
      for (const w of r.warnings) log('warn', w);

      set({
        source: file.source,
        asmErrors: [],
        asmOk: true,
        listing: [],
        loadedFrom: '',
        selected: null,
        selectedWire: null,
        pendingWire: null,
        runState: 'stopped',
        activeExperiment: null,
        viewEpoch: get().viewEpoch + 1,
      });
      log(
        r.ok ? 'success' : 'error',
        `Loaded project "${file.name}" (${file.components.length} components, ${r.wires} wires).`,
      );
      assemble();
      bump();
    },

    loadExperiment: (id) => {
      const exp = experimentById(id);
      if (!exp) {
        log('error', `Unknown experiment "${id}".`);
        return;
      }
      get().loadProjectFile(exp.project);
      set({ activeExperiment: id });
      log('info', exp.explanation);
      log('info', `Expected result: ${exp.expected}`);
    },

    newProject: () => {
      get().clearConsole();
      get().loadProjectFile({
        format: 'microlab-8085-project',
        version: 1,
        name: 'Untitled lab',
        source: DEFAULT_SOURCE,
        components: [],
        connections: [],
      });
      log('info', 'New project — empty circuit, starter program loaded.');
    },

    saveProject: (name) => {
      try {
        const file = get().serializeProject(name);
        const existing = readProjects();
        const id = `p${Date.now().toString(36)}`;
        window.localStorage.setItem(PROJECT_KEY(id), JSON.stringify(file));
        window.localStorage.setItem(
          PROJECTS_KEY,
          JSON.stringify([...existing, { id, name, at: Date.now() }]),
        );
        log('success', `Project "${name}" saved.`);
        return true;
      } catch {
        log('error', 'Saving failed — browser storage unavailable or full.');
        return false;
      }
    },

    loadSavedProject: (id) => {
      try {
        const raw = window.localStorage.getItem(PROJECT_KEY(id));
        if (!raw) {
          log('error', 'Project not found.');
          return false;
        }
        const file = JSON.parse(raw) as ProjectFile;
        if (file.format !== 'microlab-8085-project') {
          log('error', 'Not a MicroLab project.');
          return false;
        }
        get().loadProjectFile(file);
        return true;
      } catch {
        log('error', 'Could not read project (corrupted data).');
        return false;
      }
    },

    deleteSavedProject: (id) => {
      try {
        window.localStorage.removeItem(PROJECT_KEY(id));
        window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(readProjects().filter((p) => p.id !== id)));
        log('info', 'Project deleted.');
      } catch {
        log('error', 'Could not delete project.');
      }
    },

    listSavedProjects: () => {
      try {
        return readProjects();
      } catch {
        return [];
      }
    },

    exportProject: () => JSON.stringify(get().serializeProject('MicroLab 8085 project'), null, 2),

    importProject: (json) => {
      try {
        const file = JSON.parse(json) as ProjectFile;
        if (file.format !== 'microlab-8085-project' || !Array.isArray(file.components)) {
          log('error', 'Not a MicroLab 8085 project file.');
          return false;
        }
        get().loadProjectFile(file);
        return true;
      } catch {
        log('error', 'Could not parse the file as JSON.');
        return false;
      }
    },
  };

  function readProjects(): SavedProjectMeta[] {
    try {
      const raw = window.localStorage.getItem(PROJECTS_KEY);
      const parsed = raw ? (JSON.parse(raw) as SavedProjectMeta[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
});

/* ---------------- run loop ---------------- */

let rafId: number | null = null;

function startRunLoop(): void {
  if (rafId !== null) return;
  const frame = () => {
    rafId = null;
    const state = useLab.getState();
    const stillRunning = machine.runState === 'running';
    if (!stillRunning) {
      useLab.setState({ runState: machine.runState });
      return;
    }
    const budget = SPEED_BUDGET[state.speed];
    if (Number.isFinite(budget)) {
      machine.runBatch(budget);
    } else {
      // 'max': keep the browser responsive — budget wall-clock time.
      const deadline = performance.now() + 10;
      do {
        machine.runBatch(20_000);
      } while (machine.runState === 'running' && performance.now() < deadline);
    }
    state.drainMachineErrors();
    if (machine.runState === 'halted') {
      useLab.getState().log('success', `Program halted after ${machine.totalInstructions} instructions (${machine.totalTstates} T-states).`);
    }
    useLab.setState({ version: useLab.getState().version + 1, runState: machine.runState });
    if (machine.runState === 'running') rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
}

function stopRunLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/* ---------------- helpers ---------------- */

function trailingIndex(pinId: string): number | null {
  const m = /(\d+)$/.exec(pinId);
  return m ? Number(m[1]) : null;
}

/** First grid position whose rectangle misses every existing component. */
function findFreeSpot(width: number, height: number): [number, number] {
  const SLACK_X = 48; // wires route around cards; keep a margin
  const SLACK_Y = 36;
  for (let gy = 40; gy + height < 1360; gy += 340) {
    for (let gx = 40; gx + width < 2160; gx += 380) {
      const busy = [...machine.circuit.components.values()].some((c) => {
        const m = metaFor(c.type);
        const w = (m?.width ?? 240) + SLACK_X;
        const h = (m?.height ?? 220) + SLACK_Y;
        return gx < c.x + w && gx + width + SLACK_X > c.x && gy < c.y + h && gy + height + SLACK_Y > c.y;
      });
      if (!busy) return [gx, gy];
    }
  }
  return [60 + (machine.circuit.components.size % 8) * 40, 40];
}

export function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export function hex4(v: number): string {
  return (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

