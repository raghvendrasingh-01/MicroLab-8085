/**
 * Panel: the shared collapsible shell for every side/console panel.
 *
 * The header carries the title, an optional `extra` slot (action buttons),
 * and a − / + toggle. Clicking the header also toggles — but clicks on
 * buttons inside (Assemble, Clear, …) are left alone. Collapse state is
 * persisted per panel id in the UI store.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useUi } from '../../store/uiStore';

export function Panel(props: {
  id: string;
  title: string;
  extra?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}): React.JSX.Element {
  const { id, title, extra, className, style, children } = props;
  const collapsed = useUi((s) => s.collapsed[id] ?? false);
  const togglePanel = useUi((s) => s.togglePanel);

  return (
    <section
      className={`panel ${className ?? ''} ${collapsed ? 'panel-collapsed' : ''}`}
      data-panel={id}
      style={style}
    >
      <div
        className="panel-title panel-title-toggle"
        title={collapsed ? `Show ${title}` : `Hide ${title}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a, input, select')) return;
          togglePanel(id);
        }}
      >
        <span className="panel-name">{title}</span>
        <span className="panel-extra">{extra}</span>
        <button
          type="button"
          className="panel-toggle"
          aria-label={collapsed ? `Show ${title}` : `Hide ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            togglePanel(id);
          }}
        >
          {collapsed ? '+' : '−'}
        </button>
      </div>
      {!collapsed && children}
    </section>
  );
}
