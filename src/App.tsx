/**
 * MicroLab 8085 — application shell.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────┐
 *   │ toolbar                                       │
 *   ├──────────┬───────────────────────┬────────────┤
 *   │ program  │ circuit canvas        │ palette    │
 *   │ CPU regs │ (wires + components)  │ inspector  │
 *   │ memory   ├───────────────────────┤ I/O map    │
 *   │          │ console               │            │
 *   └──────────┴───────────────────────┴────────────┘
 */
import { useEffect } from 'react';
import { Toolbar } from './components/ui/Toolbar';
import { VSep } from './components/ui/Sep';
import { CodePanel } from './components/ui/CodePanel';
import { RegistersPanel } from './components/ui/RegistersPanel';
import { MemoryPanel } from './components/ui/MemoryPanel';
import { CircuitCanvas } from './components/ui/CircuitCanvas';
import { ConsolePanel } from './components/ui/ConsolePanel';
import { InspectorPanel } from './components/ui/InspectorPanel';
import { IoMapPanel } from './components/ui/IoMapPanel';
import { Palette } from './components/ui/Palette';
import { ExperimentsPanel } from './components/ui/ExperimentsPanel';
import { DiagnosticsPanel } from './components/ui/DiagnosticsPanel';
import { AboutDialog } from './components/ui/AboutDialog';
import { ConfirmDelete } from './components/ui/ConfirmDelete';
import { ScopeDialog } from './components/ui/ScopeDialog';
import { useLab } from './store/labStore';
import { useUi } from './store/uiStore';
// NOTE: Space is handled inside CircuitCanvas (hold = pan, tap = run/pause)
// — not in the global handler below.

export default function App(): React.JSX.Element {
  const runState = useLab((s) => s.runState);
  const colLeftW = useUi((s) => s.colLeftW);
  const colRightW = useUi((s) => s.colRightW);
  const narrow = useUi((s) => s.narrow);
  const drawerLeft = useUi((s) => s.drawerLeft);
  const drawerRight = useUi((s) => s.drawerRight);
  const setNarrow = useUi((s) => s.setNarrow);
  const setDrawer = useUi((s) => s.setDrawer);
  const focusCanvas = useUi((s) => s.focusCanvas);
  const setFocus = useUi((s) => s.setFocus);

  /* Below 1200px the side columns give way to the canvas and live in
     slide-in drawers (spec §40). */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)');
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [setNarrow]);

  /* Assemble once on mount so the editor opens with its machine code,
     memory and entry point populated — not a blank opcode column. */
  useEffect(() => {
    const s = useLab.getState();
    if (s.listing.length === 0 && s.asmErrors.length === 0) s.assemble();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Global keyboard shortcuts (ignored while typing in a field). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

      const s = useLab.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const name = window.prompt('Project name:', 'My lab');
        if (name) s.saveProject(name);
        return;
      }
      if (typing) return; // editor/field keys are the user's

      if (e.key === 'F10') {
        e.preventDefault();
        s.step();
      } else if (e.key.toLowerCase() === 'r') {
        s.resetLab();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedWire) s.disconnectWire(s.selectedWire);
        else if (s.selected) useUi.getState().askDelete(s.selected);
      } else if (e.key === 'Escape') {
        if (useUi.getState().confirmDelete) useUi.getState().dismissDelete();
        else if (useUi.getState().focusCanvas) setFocus(false); // exit focus mode first
        s.cancelWire();
        s.openAbout(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const gridStyle = {
    ...(colLeftW !== null ? { '--col-left-w': `${colLeftW}px` } : {}),
    ...(colRightW !== null ? { '--col-right-w': `${colRightW}px` } : {}),
  } as React.CSSProperties;

  return (
    <div className={`app ${narrow ? 'app-narrow' : ''} ${focusCanvas ? 'app-focus' : ''}`}>
      <Toolbar />
      <div className="main-grid" style={gridStyle}>
        <div
          className={`col-left ${drawerLeft ? 'drawer-open' : ''}`}
          aria-label="Lab panels"
        >
          <CodePanel />
          <RegistersPanel />
          <MemoryPanel />
        </div>
        <VSep side="left" />
        <div className="col-center">
          <div className={`canvas-frame ${runState === 'running' ? 'is-running' : ''}`}>
            <CircuitCanvas />
          </div>
          <ConsolePanel />
        </div>
        <VSep side="right" />
        <div
          className={`col-right ${drawerRight ? 'drawer-open' : ''}`}
          aria-label="Component panels"
        >
          <ExperimentsPanel />
          <Palette />
          <InspectorPanel />
          <IoMapPanel />
          <DiagnosticsPanel />
        </div>
      </div>
      {narrow && (drawerLeft || drawerRight) && (
        <div
          className="drawer-backdrop"
          aria-hidden
          onClick={() => {
            setDrawer('left', false);
            setDrawer('right', false);
          }}
        />
      )}
      <AboutDialog />
      <ConfirmDelete />
      <ScopeDialog />
    </div>
  );
}
