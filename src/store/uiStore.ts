/**
 * UI preference store: layout state the user changes with the mouse and
 * expects to find again next session — collapsed panels, dragged column
 * widths, editor/console heights. Persisted to localStorage as one blob.
 *
 * A null width/height means "user never dragged it" — the CSS default (and
 * the responsive media queries) applies. Setting a value pins it.
 */
import { create } from 'zustand';

const KEY = 'microlab-ui-v1';

export interface CanvasView {
  /** Screen-space translation of the circuit world, in container px. */
  x: number;
  y: number;
  /** Zoom factor (1 = 100%). */
  scale: number;
}

export interface UiPrefs {
  collapsed: Record<string, boolean>;
  colLeftW: number | null;
  colRightW: number | null;
  editorH: number | null;
  consoleH: number | null;
  /** null = never set: the canvas auto-fits the circuit on mount. */
  canvasView: CanvasView | null;
  /** Per-line machine-code column in the editor. */
  showOpcodes: boolean;
}

const DEFAULTS: UiPrefs = {
  collapsed: {},
  colLeftW: null,
  colRightW: null,
  editorH: null,
  consoleH: null,
  canvasView: null,
  showOpcodes: true,
};

function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      collapsed: p.collapsed && typeof p.collapsed === 'object' ? p.collapsed : {},
      colLeftW: numOrNull(p.colLeftW),
      colRightW: numOrNull(p.colRightW),
      editorH: numOrNull(p.editorH),
      consoleH: numOrNull(p.consoleH),
      canvasView:
        p.canvasView && typeof p.canvasView === 'object' &&
        Number.isFinite(p.canvasView.scale) && p.canvasView.scale > 0
          ? { x: Number(p.canvasView.x) || 0, y: Number(p.canvasView.y) || 0, scale: p.canvasView.scale }
          : null,
      showOpcodes: typeof p.showOpcodes === 'boolean' ? p.showOpcodes : true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function savePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode / storage full — prefs just won't persist */
  }
}

interface UiState extends UiPrefs {
  /* transient viewport state — deliberately not persisted */
  narrow: boolean; // viewport < 1200px: side columns become drawers
  drawerLeft: boolean;
  drawerRight: boolean;
  focusCanvas: boolean; // Focus mode: side panels hidden, canvas maximized
  /** Component deletion awaiting confirmation (context menu / Delete key). */
  confirmDelete: { id: string } | null;
  /** Oscilloscope shown in the expanded overlay (§37). */
  expandedScope: string | null;

  togglePanel: (id: string) => void;
  setCollapsed: (id: string, collapsed: boolean) => void;
  setColumnW: (side: 'left' | 'right', w: number | null) => void;
  setEditorH: (h: number | null) => void;
  setConsoleH: (h: number | null) => void;
  setNarrow: (narrow: boolean) => void;
  setDrawer: (side: 'left' | 'right', open: boolean) => void;
  setCanvasView: (v: CanvasView | null) => void;
  setFocus: (on: boolean) => void;
  toggleOpcodes: () => void;
  askDelete: (id: string) => void;
  dismissDelete: () => void;
  setExpandedScope: (id: string | null) => void;
  resetLayout: () => void;
}

function persist(get: () => UiState): void {
  const { collapsed, colLeftW, colRightW, editorH, consoleH, canvasView, showOpcodes } = get();
  savePrefs({ collapsed, colLeftW, colRightW, editorH, consoleH, canvasView, showOpcodes });
}

export const useUi = create<UiState>((set, get) => ({
  ...loadPrefs(),
  narrow: false,
  drawerLeft: false,
  drawerRight: false,
  focusCanvas: false,
  confirmDelete: null,
  expandedScope: null,

  togglePanel: (id) => {
    set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
    persist(get);
  },

  setCollapsed: (id, collapsed) => {
    set((s) => ({ collapsed: { ...s.collapsed, [id]: collapsed } }));
    persist(get);
  },

  setColumnW: (side, w) => {
    set(side === 'left' ? { colLeftW: w } : { colRightW: w });
    persist(get);
  },

  setEditorH: (h) => {
    set({ editorH: h });
    persist(get);
  },

  setConsoleH: (h) => {
    set({ consoleH: h });
    persist(get);
  },

  setNarrow: (narrow) => {
    // Leaving narrow mode closes any open drawer so a stale open flag
    // can't pop the drawer back out on re-entry.
    set(narrow ? { narrow } : { narrow, drawerLeft: false, drawerRight: false });
  },

  setDrawer: (side, open) => {
    set(side === 'left' ? { drawerLeft: open } : { drawerRight: open });
  },

  setCanvasView: (v) => {
    set({ canvasView: v });
    persist(get);
  },

  setFocus: (on) => {
    set({ focusCanvas: on });
  },

  toggleOpcodes: () => {
    set((s) => ({ showOpcodes: !s.showOpcodes }));
    persist(get);
  },

  askDelete: (id) => {
    set({ confirmDelete: { id } });
  },
  setExpandedScope: (id) => {
    set({ expandedScope: id });
  },

  dismissDelete: () => {
    set({ confirmDelete: null });
  },

  resetLayout: () => {
    set({ ...DEFAULTS, collapsed: {} });
    persist(get);
  },
}));
