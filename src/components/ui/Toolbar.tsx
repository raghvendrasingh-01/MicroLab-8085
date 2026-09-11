/**
 * Toolbar: program flow controls, speed, and project management.
 */
import { useEffect, useRef, useState } from 'react';
import { useLab } from '../../store/labStore';
import { useUi } from '../../store/uiStore';

export function Toolbar(): React.JSX.Element {
  const runState = useLab((s) => s.runState);
  const speed = useLab((s) => s.speed);
  const run = useLab((s) => s.run);
  const pause = useLab((s) => s.pause);
  const step = useLab((s) => s.step);
  const resetLab = useLab((s) => s.resetLab);
  const newProject = useLab((s) => s.newProject);
  const assemble = useLab((s) => s.assemble);
  const setSpeed = useLab((s) => s.setSpeed);
  const saveProject = useLab((s) => s.saveProject);
  const loadSavedProject = useLab((s) => s.loadSavedProject);
  const deleteSavedProject = useLab((s) => s.deleteSavedProject);
  const listSavedProjects = useLab((s) => s.listSavedProjects);
  const exportProject = useLab((s) => s.exportProject);
  const importProject = useLab((s) => s.importProject);

  const [projectsOpen, setProjectsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const narrow = useUi((s) => s.narrow);
  const drawerLeft = useUi((s) => s.drawerLeft);
  const drawerRight = useUi((s) => s.drawerRight);
  const setDrawer = useUi((s) => s.setDrawer);
  const focusCanvas = useUi((s) => s.focusCanvas);
  const setFocus = useUi((s) => s.setFocus);

  const onRunPause = () => (runState === 'running' ? pause() : run());

  const onExport = () => {
    const blob = new Blob([exportProject()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'microlab-project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (f: File) => {
    const text = await f.text();
    importProject(text);
  };

  const projects = projectsOpen ? listSavedProjects() : [];

  /* Ctrl+O opens the project menu (ignored while typing — spec §17). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'o') return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      e.preventDefault();
      setProjectsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* The menu closes on outside click or Escape, like the canvas context menu. */
  useEffect(() => {
    if (!projectsOpen) return;
    const close = () => setProjectsOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.projects-menu')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [projectsOpen]);

  return (
    <div className="toolbar">
      <span className="brand">MicroLab <b>8085</b></span>

      {narrow && (
        <>
          <button
            type="button"
            className={`btn btn-small drawer-toggle ${drawerLeft ? 'btn-active' : ''}`}
            onClick={() => setDrawer('left', !drawerLeft)}
            title="Show lab panels (program, CPU, memory)"
          >
            ◧ Lab
          </button>
          <button
            type="button"
            className={`btn btn-small drawer-toggle ${drawerRight ? 'btn-active' : ''}`}
            onClick={() => setDrawer('right', !drawerRight)}
            title="Show component panels (experiments, palette, inspector)"
          >
            Parts ◨
          </button>
        </>
      )}

      <button type="button" className="btn" onClick={() => assemble()} title="Assemble and load (Ctrl+Enter)">
        Assemble
      </button>
      <button
        type="button"
        className={`btn btn-primary ${runState === 'running' ? 'btn-active' : ''}`}
        onClick={onRunPause}
        title="Run / pause (Space)"
      >
        {runState === 'running' ? '⏸ Pause' : '▶ Run'}
      </button>
      <button type="button" className="btn" onClick={() => step()} title="Single step (F10)">
        ⏭ Step
      </button>
      <button type="button" className="btn" onClick={() => resetLab()} title="Reset CPU + peripherals (R)">
        ↺ Reset
      </button>
      <button
        type="button"
        className={`btn ${focusCanvas ? 'btn-active' : ''}`}
        onClick={() => setFocus(!focusCanvas)}
        title="Focus canvas — hide the side panels (Esc to exit)"
      >
        {focusCanvas ? '⤡ Exit focus' : '⤢ Focus'}
      </button>

      <label className="speed-label" title="Simulation speed (instructions per animation frame)">
        Speed
        <select value={speed} onChange={(e) => setSpeed(e.target.value as never)}>
          <option value="slow">Slow</option>
          <option value="medium">Medium</option>
          <option value="fast">Fast</option>
          <option value="max">Max</option>
        </select>
      </label>

      <span className={`run-badge run-${runState}`} title={`CPU is ${runState}`}>
        <span className="run-dot" aria-hidden />
        {runState}
      </span>

      <div className="toolbar-spacer" />

      <div className="projects-menu">
        <button type="button" className="btn" onClick={() => setProjectsOpen((o) => !o)}>
          Projects ▾
        </button>
        {projectsOpen && (
          <div className="menu-pop" onMouseLeave={() => setProjectsOpen(false)}>
            <button
              type="button"
              onClick={() => {
                newProject();
                setProjectsOpen(false);
              }}
            >
              ✦ New Project
            </button>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Project name:', 'My lab');
                if (name) saveProject(name);
                setProjectsOpen(false);
              }}
            >
              💾 Save to browser…
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              📥 Import JSON…
            </button>
            <button type="button" onClick={onExport}>
              📤 Export JSON
            </button>
            {projects.length > 0 && <div className="menu-sep" />}
            {projects.map((p) => (
              <div key={p.id} className="menu-row">
                <button type="button" className="menu-load" onClick={() => { loadSavedProject(p.id); setProjectsOpen(false); }}>
                  {p.name}
                </button>
                <button
                  type="button"
                  className="menu-del"
                  title="Delete project"
                  onClick={() => deleteSavedProject(p.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImportFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
