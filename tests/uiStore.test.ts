/**
 * UI preference store: collapse flags and dragged sizes must round-trip
 * through localStorage, and a reset must clear them (null = CSS default).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Minimal localStorage stand-in (tests run in a bare node environment). */
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('uiStore persistence', () => {
  beforeEach(async () => {
    const storage = new MemStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    // zustand create() already ran at import; reset module state fresh.
    vi.resetModules();
    await import('../src/store/uiStore');
  });

  it('persists collapsed flags and restores them on load', async () => {
    const { useUi } = await import('../src/store/uiStore');
    useUi.getState().togglePanel('cpu');
    useUi.getState().togglePanel('cpu');
    useUi.getState().togglePanel('memory');
    const raw = localStorage.getItem('microlab-ui-v1');
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    expect(saved.collapsed).toEqual({ cpu: false, memory: true });

    // A fresh store (simulated reload) reads the same values back.
    vi.resetModules();
    const again = await import('../src/store/uiStore');
    expect(again.useUi.getState().collapsed).toEqual({ cpu: false, memory: true });
  });

  it('stores dragged sizes and resetLayout clears them to CSS defaults', async () => {
    const { useUi } = await import('../src/store/uiStore');
    useUi.getState().setColumnW('left', 480);
    useUi.getState().setColumnW('right', 300);
    useUi.getState().setEditorH(420);
    useUi.getState().setConsoleH(240);
    const s = useUi.getState();
    expect(s.colLeftW).toBe(480);
    expect(s.colRightW).toBe(300);
    expect(s.editorH).toBe(420);
    expect(s.consoleH).toBe(240);

    useUi.getState().resetLayout();
    const r = useUi.getState();
    expect(r.colLeftW).toBeNull();
    expect(r.colRightW).toBeNull();
    expect(r.editorH).toBeNull();
    expect(r.consoleH).toBeNull();
    expect(r.collapsed).toEqual({});
  });

  it('null column width means "never dragged" and survives a reload as null', async () => {
    const { useUi } = await import('../src/store/uiStore');
    useUi.getState().setColumnW('left', 500);
    useUi.getState().setColumnW('left', null);
    vi.resetModules();
    const again = await import('../src/store/uiStore');
    expect(again.useUi.getState().colLeftW).toBeNull();
  });

  it('leaving narrow mode closes any open drawer', async () => {
    const { useUi } = await import('../src/store/uiStore');
    useUi.getState().setNarrow(true);
    useUi.getState().setDrawer('left', true);
    useUi.getState().setDrawer('right', true);
    expect(useUi.getState().drawerLeft).toBe(true);
    useUi.getState().setNarrow(false);
    expect(useUi.getState().drawerLeft).toBe(false);
    expect(useUi.getState().drawerRight).toBe(false);
  });
});
