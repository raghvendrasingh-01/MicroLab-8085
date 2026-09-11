/**
 * Drag separators for resizable layout regions.
 *
 * VSep — between a side column and the canvas: drags the column width
 *        (clamped), double-click resets to the CSS default (null).
 * HSep — editor bottom edge / console top edge: drags the region height.
 *
 * Sizes live in the persisted UI store; while a drag is in progress a
 * `resizing-v` / `resizing-h` class on <body> pins the cursor and disables
 * text selection so the drag feels solid.
 */
import { useUi } from '../../store/uiStore';

const COL_CLAMPS = {
  left: { min: 260, max: 560 },
  right: { min: 240, max: 440 },
} as const;

export function VSep(props: { side: 'left' | 'right' }): React.JSX.Element {
  const { side } = props;
  const setColumnW = useUi((s) => s.setColumnW);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const grid = e.currentTarget.parentElement;
    const target = grid?.querySelector(side === 'left' ? '.col-left' : '.col-right');
    if (!target) return;
    const startX = e.clientX;
    const startW = target.getBoundingClientRect().width;
    const { min, max } = COL_CLAMPS[side];
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = side === 'left' ? startW + dx : startW - dx;
      setColumnW(side, Math.round(Math.max(min, Math.min(max, w))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-v');
    };
    document.body.classList.add('resizing-v');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={`vsep vsep-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} column`}
      title="Drag to resize — double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setColumnW(side, null)}
    />
  );
}

export function HSep(props: {
  /** Current height of the region (px) at drag start. */
  getStart: () => number;
  /** Apply the new height (null = reset to CSS default). */
  setH: (h: number | null) => void;
  min: number;
  max: number;
  /** Which way the region grows as the pointer moves. */
  dir: 'down' | 'up';
  label: string;
}): React.JSX.Element {
  const { getStart, setH, min, max, dir, label } = props;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = getStart();
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const h = dir === 'down' ? startH + dy : startH - dy;
      setH(Math.round(Math.max(min, Math.min(max, h))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-h');
    };
    document.body.classList.add('resizing-h');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className="hsep"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title="Drag to resize — double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setH(null)}
    />
  );
}
