/**
 * The circuit canvas: pannable, zoomable viewport over draggable component
 * cards, clickable pins, and wires whose color reflects the live signal.
 *
 * Viewport model: the svg fills its container; a single <g class="world">
 * carries translate(x,y) scale(s). Pan = middle-drag, hold-Space + drag, or
 * drag on empty canvas (a plain click still deselects). Zoom = Ctrl+wheel at
 * the cursor; plain wheel pans. "Fit" frames the components' bounding box.
 * The view persists in the UI store; project loads auto-refit (viewEpoch).
 *
 * Space doubles as Run/Pause when tapped (no drag, quick release) — the
 * discrimination lives here, not in App's global handler.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { machine, useLab } from '../../store/labStore';
import { metaFor } from '../registry';
import { bodyFor } from './bodies';
import { layoutOf, sizeOf, PIN_R } from './geometry';
import { useUi, type CanvasView } from '../../store/uiStore';
import type { Component, PinDef } from '../../core/circuit';

const GRID = 24;

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
/** Screen px of breathing room around the circuit when fitting. */
const FIT_PAD = 60;
/** Pointer travel (px) before a background press counts as a pan-drag. */
const DRAG_THRESHOLD = 3;

interface DragState {
  id: string;
  dx: number;
  dy: number;
}

interface PanState {
  startX: number;
  startY: number;
  vx: number;
  vy: number;
}

export function CircuitCanvas(): React.JSX.Element {
  const version = useLab((s) => s.version);
  const selected = useLab((s) => s.selected);
  const selectedWire = useLab((s) => s.selectedWire);
  const pendingWire = useLab((s) => s.pendingWire);
  const clickPin = useLab((s) => s.clickPin);
  const cancelWire = useLab((s) => s.cancelWire);
  const select = useLab((s) => s.select);
  const selectWire = useLab((s) => s.selectWire);
  const moveComponent = useLab((s) => s.moveComponent);
  const resizeComponent = useLab((s) => s.resizeComponent);
  const interact = useLab((s) => s.interact);
  const viewEpoch = useLab((s) => s.viewEpoch);
  const focusCanvas = useUi((s) => s.focusCanvas);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  /* ---------------- view (pan/zoom) ---------------- */

  const [view, setView] = useState<CanvasView>(
    () => useUi.getState().canvasView ?? { x: 24, y: 24, scale: 1 },
  );
  const viewRef = useRef(view);
  /** Apply a view everywhere at once: ref (handlers), state (render), store (persist). */
  const setV = useCallback((v: CanvasView) => {
    viewRef.current = v;
    setView(v);
    useUi.getState().setCanvasView(v);
  }, []);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw < 40 || ch < 40) return;
    const comps = [...machine.circuit.components.values()];
    if (comps.length === 0) {
      setV({ x: 24, y: 24, scale: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of comps) {
      const meta = metaFor(c.type);
      const size = meta ? sizeOf(c, meta) : { width: 200, height: 160 };
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + size.width);
      maxY = Math.max(maxY, c.y + size.height);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.max(MIN_SCALE, Math.min((cw - FIT_PAD * 2) / bw, (ch - FIT_PAD * 2) / bh, 1));
    setV({
      x: (cw - bw * scale) / 2 - minX * scale,
      y: (ch - bh * scale) / 2 - minY * scale,
      scale,
    });
  }, [setV]);

  /** Zoom by `factor`, keeping the world point under (px, py) fixed. */
  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const v = viewRef.current;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const k = scale / v.scale;
      setV({ x: px - (px - v.x) * k, y: py - (py - v.y) * k, scale });
    },
    [setV],
  );

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const el = containerRef.current;
      if (!el) return;
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, dir > 0 ? 1.25 : 0.8);
    },
    [zoomAt],
  );

  /* ---- pan gesture (shared by middle-drag, Space+drag, background drag) ---- */

  const [pan, setPan] = useState<PanState | null>(null);
  const spaceRef = useRef({ held: false, downAt: 0, dragged: false });
  const [spaceHeld, setSpaceHeld] = useState(false);

  const startPan = useCallback((clientX: number, clientY: number) => {
    const p = { startX: clientX, startY: clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    setPan(p);
    // A pan that actually moves cancels Space's tap-to-run interpretation.
    spaceRef.current.dragged = true;
  }, []);

  useEffect(() => {
    if (!pan) return;
    const onMove = (e: PointerEvent) => {
      setV({ ...viewRef.current, x: pan.vx + (e.clientX - pan.startX), y: pan.vy + (e.clientY - pan.startY) });
    };
    const onUp = () => setPan(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pan, setV]);

  /* ---- Space: hold = pan modifier, tap = run/pause ---- */

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      e.preventDefault();
      if (!e.repeat) {
        spaceRef.current = { held: true, downAt: performance.now(), dragged: false };
        setSpaceHeld(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceRef.current.held) return;
      spaceRef.current.held = false;
      setSpaceHeld(false);
      const quickTap = performance.now() - spaceRef.current.downAt < 400 && !spaceRef.current.dragged;
      if (quickTap) {
        const s = useLab.getState();
        if (s.runState === 'running') s.pause();
        else s.run();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  /* ---- wheel: Ctrl/Cmd = zoom at cursor, plain = pan (native listener so
         preventDefault works against passive defaults) ---- */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(px, py, Math.exp(-e.deltaY * 0.0022));
      } else {
        const v = viewRef.current;
        setV({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, setV]);

  /* ---- auto-fit: first mount without a stored view, every project load,
         entering focus mode, and after a layout reset ---- */

  const epochRef = useRef<number | null>(null);
  useEffect(() => {
    if (epochRef.current === null) {
      epochRef.current = viewEpoch;
      if (useUi.getState().canvasView === null) fitView();
      return;
    }
    if (epochRef.current !== viewEpoch) {
      epochRef.current = viewEpoch;
      fitView();
    }
  }, [viewEpoch, fitView]);

  useEffect(() => {
    if (focusCanvas) fitView();
  }, [focusCanvas, fitView]);

  useEffect(
    () =>
      useUi.subscribe((state, prev) => {
        if (state.canvasView === null && prev.canvasView !== null) fitView();
      }),
    [fitView],
  );

  /* ---------------- world geometry ---------------- */

  const components = useMemo(
    () => [...machine.circuit.components.values()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  // While a card is dragged it renders last, so it floats above overlaps.
  // Mere selection does NOT hoist — "Send to back" must be honored.
  const ordered = useMemo(() => {
    const top = drag?.id ?? null;
    if (!top) return components;
    return [...components.filter((c) => c.id !== top), ...components.filter((c) => c.id === top)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, drag]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  }, []);

  /* ---- dragging cards ---- */
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      // No world-bounds clamp: the grid follows the view, so the canvas is
      // unbounded in every direction.
      moveComponent(drag.id, p.x - drag.dx, p.y - drag.dy);
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, moveComponent, toWorld]);

  /* ---- resizing resizable cards (oscilloscope) ---- */
  const onResizeStart = useCallback(
    (e: React.PointerEvent, c: Component) => {
      if (e.button !== 0) return; // middle/right keep their pan/menu behavior
      e.stopPropagation();
      e.preventDefault();
      if (!c.resizeTo || !c.getDisplaySize) return;
      const s0 = c.getDisplaySize();
      const startX = e.clientX;
      const startY = e.clientY;
      const move = (ev: PointerEvent) => {
        const k = viewRef.current.scale;
        resizeComponent(c.id, s0.width + (ev.clientX - startX) / k, s0.height + (ev.clientY - startY) / k);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing-v');
      };
      document.body.classList.add('resizing-v');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [resizeComponent],
  );

  const pinPos = useCallback(
    (componentId: string, pinId: string): { x: number; y: number } | null => {
      const c = machine.circuit.get(componentId);
      if (!c) return null;
      const meta = metaFor(c.type);
      if (!meta) return null;
      const layout = layoutOf(c, meta);
      const p = layout.pins.get(pinId);
      if (!p) return null;
      return { x: c.x + p.x, y: c.y + p.y };
    },
    [],
  );

  const wireValue = useCallback(
    (fromComponent: string, fromPin: string, toComponent: string, toPin: string): 0 | 1 | null => {
      const a = machine.circuit.get(fromComponent);
      const b = machine.circuit.get(toComponent);
      if (!a || !b) return null;
      const aDrives = a.getPinDir(fromPin) === 'out';
      const bDrives = b.getPinDir(toPin) === 'out';
      if (aDrives === bDrives) return null; // undriven or contention
      const driver = aDrives ? a : b;
      const pin = aDrives ? fromPin : toPin;
      return driver.getPin(pin).digital;
    },
    [],
  );

  /* ---- pending-wire cursor line ---- */
  const onSvgMouseMove = (e: React.MouseEvent) => {
    if (!pendingWire) return;
    setMouse(toWorld(e.clientX, e.clientY));
  };

  const pendingFrom = pendingWire ? pinPos(pendingWire.componentId, pendingWire.pinId) : null;

  /* ---- right-click context menu ---- */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Keep the menu inside the canvas whatever the pointer position.
    const x = Math.min(e.clientX - r.left, Math.max(0, r.width - 176));
    const y = Math.min(e.clientY - r.top, Math.max(0, r.height - 176));
    select(id);
    setMenu({ x, y, id });
  };

  // Any pointer press outside the menu closes it; Escape too.
  useEffect(() => {
    if (!menu) return;
    const close = (e?: PointerEvent) => {
      // Clicks on the menu itself must survive to become item clicks.
      if (e && (e.target as Element | null)?.closest?.('.ctx-menu')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(null);
      }
    };
    window.addEventListener('pointerdown', close, { capture: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true });
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  /** Select + open the inspector's rename field. */
  const renameComponent = (id: string) => {
    select(id);
    useUi.getState().setCollapsed('inspector', false);
    // Wait for the (possibly collapsed) inspector to render its field.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-panel="inspector"] input');
      input?.focus();
      input?.select();
    });
  };

  /* ---- background press: click deselects, drag pans; middle always pans ---- */
  const [bgPress, setBgPress] = useState<{ x: number; y: number } | null>(null);
  // Whether the press turned into a pan-drag — a ref, so pointerup (which may
  // fire before the state update lands) sees the truth.
  const bgMovedRef = useRef(false);
  useEffect(() => {
    if (!bgPress) return;
    const onMove = (e: PointerEvent) => {
      if (!bgMovedRef.current && Math.hypot(e.clientX - bgPress.x, e.clientY - bgPress.y) > DRAG_THRESHOLD) {
        bgMovedRef.current = true;
        startPan(e.clientX, e.clientY);
      }
    };
    const onUp = () => {
      if (!bgMovedRef.current) {
        select(null);
        cancelWire();
      }
      bgMovedRef.current = false;
      setBgPress(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [bgPress, startPan, select, cancelWire]);

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.button === 1 || spaceHeld) {
      e.preventDefault();
      startPan(e.clientX, e.clientY);
    } else if (e.button === 0) {
      bgMovedRef.current = false;
      setBgPress({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <div
      className={`canvas-wrap ${spaceHeld ? 'space-pan' : ''} ${pan ? 'panning' : ''}`}
      ref={containerRef}
      onMouseLeave={() => setMouse(null)}
    >
      <svg
        ref={svgRef}
        className="circuit-svg"
        width="100%"
        height="100%"
        onMouseMove={onSvgMouseMove}
        onPointerDown={onBackgroundPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--grid-dot)" />
          </pattern>
        </defs>

        <g className="world" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {/* document background + grid — covers whatever is currently
              visible (computed in world coords), so the world is effectively
              unbounded. Snapped to the grid pitch so dots don't crawl. */}
          {(() => {
            const cw = containerRef.current?.clientWidth ?? 800;
            const ch = containerRef.current?.clientHeight ?? 600;
            const snapDown = (v: number) => Math.floor(v / GRID) * GRID;
            const snapUp = (v: number) => Math.ceil(v / GRID) * GRID;
            // Pad a full screen in each direction: the SVG clips to its own
            // bounds so over-covering is free, and it keeps the grid covering
            // the viewport through container resizes that don't move the view.
            const x0 = snapDown(-view.x / view.scale) - cw / view.scale;
            const y0 = snapDown(-view.y / view.scale) - ch / view.scale;
            const x1 = snapUp((cw - view.x) / view.scale) + cw / view.scale;
            const y1 = snapUp((ch - view.y) / view.scale) + ch / view.scale;
            return (
              <rect
                className="world-bg"
                x={x0}
                y={y0}
                width={x1 - x0}
                height={y1 - y0}
                fill="url(#grid)"
                onPointerDown={onBackgroundPointerDown}
              />
            );
          })()}

          {/* wires (below cards) */}
          <g>
            {machine.circuit.connections.map((w) => {
              const a = pinPos(w.fromComponent, w.fromPin);
              const b = pinPos(w.toComponent, w.toPin);
              if (!a || !b) return null;
              const value = wireValue(w.fromComponent, w.fromPin, w.toComponent, w.toPin);
              const cls =
                w.id === selectedWire
                  ? 'wire selected'
                  : value === null
                    ? 'wire undriven'
                    : value
                      ? 'wire hi'
                      : 'wire lo';
              const bend = Math.max(30, Math.min(120, Math.abs(b.x - a.x) / 2));
              const d = `M ${a.x} ${a.y} C ${a.x + (b.x > a.x ? bend : -bend)} ${a.y}, ${
                b.x - (b.x > a.x ? bend : -bend)
              } ${b.y}, ${b.x} ${b.y}`;
              const la = machine.circuit.get(w.fromComponent);
              const lb = machine.circuit.get(w.toComponent);
              const state = value === null ? 'undriven' : value ? 'high (1)' : 'low (0)';
              return (
                <g key={w.id} className="wire-g" onClick={(e) => { e.stopPropagation(); selectWire(w.id); }}>
                  <title>
                    {`${la?.label ?? '?'} . ${w.fromPin}  →  ${lb?.label ?? '?'} . ${w.toPin}  —  ${state} (click to select, Delete to remove)`}
                  </title>
                  {/* hit band kept ~24px wide on screen regardless of zoom */}
                  <path className="wire-hit" d={d} strokeWidth={24 / view.scale} />
                  <path className={cls} d={d} />
                </g>
              );
            })}
          </g>

          {/* pending wire preview */}
          {pendingFrom && mouse && (
            <line
              className="wire-pending"
              x1={pendingFrom.x}
              y1={pendingFrom.y}
              x2={mouse.x}
              y2={mouse.y}
            />
          )}

          {/* component cards — selected/dragged renders last (on top) */}
          {ordered.map((c) => (
            <ComponentCard
              key={c.id}
              component={c}
              version={version}
              scale={view.scale}
              isSelected={selected === c.id}
              isPendingSource={pendingWire?.componentId === c.id}
              onCardPointerDown={(e) => {
                if (spaceHeld || e.button === 1) {
                  e.preventDefault();
                  startPan(e.clientX, e.clientY);
                  return;
                }
                if (e.button !== 0) return;
                // Drags start on the card chrome; pins, the ⓘ dot and the
                // interactive body own their pointer events.
                if ((e.target as Element).closest('.pin-g, .card-info, .card-body')) return;
                const p = toWorld(e.clientX, e.clientY);
                setDrag({ id: c.id, dx: p.x - c.x, dy: p.y - c.y });
                select(c.id);
              }}
              onContextMenu={(e) => openMenu(e, c.id)}
              onPinClick={(pinId, e) => clickPin(c.id, pinId, e.shiftKey)}
              onInfo={() => useLab.getState().openAbout(c.type)}
              onInteract={(componentId, arg) => interact(componentId, arg)}
              onResizeStart={onResizeStart}
            />
          ))}
        </g>
      </svg>

      {pendingWire && (
        <div className="canvas-hint-overlay">
          Wiring: click a destination pin — shift-click wires an 8-bit bus. Click the source pin to cancel.
        </div>
      )}

      <div className="canvas-controls">
        <button type="button" onClick={() => zoomStep(-1)} title="Zoom out">
          −
        </button>
        <span className="zoom-pct">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomStep(1)} title="Zoom in">
          +
        </button>
        <button type="button" className="fit-btn" onClick={fitView} title="Fit the whole circuit in view">
          ⤢ Fit
        </button>
      </div>

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          {[
            { label: '⚙ Configure / inspect', run: () => select(menu.id) },
            { label: '✎ Rename', run: () => renameComponent(menu.id) },
            { label: '⧉ Duplicate', run: () => useLab.getState().duplicateComponent(menu.id) },
            { label: '⬆ Bring to front', run: () => useLab.getState().raiseComponent(menu.id, 'front') },
            { label: '⬇ Send to back', run: () => useLab.getState().raiseComponent(menu.id, 'back') },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              className="ctx-item"
              onClick={() => {
                setMenu(null);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="ctx-item ctx-danger"
            onClick={() => {
              setMenu(null);
              useUi.getState().askDelete(menu.id);
            }}
          >
            🗑 Delete…
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface CardProps {
  component: Component;
  version: number;
  scale: number;
  isSelected: boolean;
  isPendingSource: boolean;
  onCardPointerDown: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPinClick: (pinId: string, e: React.MouseEvent) => void;
  onInfo: () => void;
  onInteract: (componentId: string, pinId: string) => void;
  onResizeStart: (e: React.PointerEvent, c: Component) => void;
}

function ComponentCard({
  component: c,
  version,
  scale,
  isSelected,
  isPendingSource,
  onCardPointerDown,
  onContextMenu,
  onPinClick,
  onInfo,
  onInteract,
  onResizeStart,
}: CardProps): React.JSX.Element {
  const pendingWire = useLab((s) => s.pendingWire);
  const meta = metaFor(c.type);
  if (!meta) return <g />;
  const layout = layoutOf(c, meta);
  const Body = bodyFor(c.type);
  const defs = c.getPinDefs();

  return (
    <g
      transform={`translate(${c.x}, ${c.y})`}
      className={`card ${isSelected ? 'card-selected' : ''} ${isPendingSource ? 'card-pending' : ''}`}
      onPointerDown={onCardPointerDown}
      onContextMenu={onContextMenu}
    >
      {/* card body (drag handle) */}
      <rect
        className="card-rect"
        width={layout.width}
        height={layout.height}
        rx={8}
      />
      <rect
        className="card-header"
        width={layout.width}
        height={26}
        rx={8}
      />
      <text className="card-title" x={10} y={17}>
        {c.label}
      </text>
      <g className="card-info" transform={`translate(${layout.width - 17}, 6)`} onClick={onInfo}>
        <title>{`About ${meta.title}`}</title>
        <circle r={8} className="info-dot" />
        <text x={0} y={3.5} className="info-i">i</text>
        {/* hit target ~24px on screen regardless of zoom */}
        <circle r={12 / scale} fill="transparent" />
      </g>

      {/* group captions */}
      {layout.captions.map((cap) => (
        <text
          key={`${cap.side}-${cap.name}`}
          x={cap.x}
          y={cap.y}
          className={`group-caption ${cap.side === 'right' ? 'text-right' : ''}`}
        >
          {cap.name}
        </text>
      ))}

      {/* pins */}
      {defs.map((d: PinDef) => {
        const pos = layout.pins.get(d.id);
        if (!pos) return null;
        const dir = c.getPinDir(d.id);
        const digital = c.getPin(d.id).digital;
        const isPending = isPendingSource && pendingWire?.pinId === d.id;
        return (
          <g
            key={d.id}
            className="pin-g"
            onClick={(e) => { e.stopPropagation(); onPinClick(d.id, e); }}
          >
            <title>
              {`${d.label} — ${dir === 'out' ? 'output' : 'input'}, now ${digital ? 'high (1)' : 'low (0)'}${isPending ? ' (wiring from here)' : ''}`}
            </title>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={PIN_R}
              className={`pin pin-${dir} ${digital ? 'pin-hi' : 'pin-lo'} ${isPending ? 'pin-pending' : ''}`}
            />
            <text
              x={pos.side === 'left' ? 12 : -12}
              y={pos.y + 4}
              className={`pin-label ${pos.side === 'right' ? 'text-right' : ''}`}
            >
              {d.label}
            </text>
            {/* invisible hit target, ~24px on screen regardless of zoom */}
            <circle cx={pos.x} cy={pos.y} r={12 / scale} fill="transparent" />
          </g>
        );
      })}

      {/* type-specific body */}
      <foreignObject className="card-body" x={64} y={30} width={layout.width - 128} height={layout.height - 40}>
        <Body component={c} version={version} onInteract={onInteract} />
      </foreignObject>

      {/* corner resize grip for resizable cards (oscilloscope) */}
      {c.getDisplaySize && (
        <g className="resize-h" onPointerDown={(e) => onResizeStart(e, c)}>
          <title>Drag to resize</title>
          <path
            className="resize-grip"
            d={`M ${layout.width - 15} ${layout.height - 5} L ${layout.width - 5} ${layout.height - 15} M ${layout.width - 15} ${layout.height - 11} L ${layout.width - 11} ${layout.height - 15}`}
          />
          <circle cx={layout.width - 10} cy={layout.height - 10} r={11 / scale} fill="transparent" />
        </g>
      )}
    </g>
  );
}
