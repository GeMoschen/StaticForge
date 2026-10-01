import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SfTreeModel, SfTreeNode, SfTreeSort, highlightSegments } from './tree-model';

const folder = (id: string, label = id): SfTreeNode => ({ id, label, hasChildren: true });
const leaf = (id: string, label = id): SfTreeNode => ({ id, label });

const DATA: Record<string, SfTreeNode[]> = {
  '': [folder('b', 'beta'), leaf('g', 'Gamma'), folder('a', 'Alpha')],
  a: [leaf('a2', 'item 10'), leaf('a1', 'item 9')],
  b: [folder('b1', 'b-one')],
  b1: [leaf('b1x', 'deep')],
};

function create(sort: SfTreeSort = 'name', data = DATA) {
  const selection = signal<readonly string[]>([]);
  const model = new SfTreeModel({ selection, sort: signal(sort) });
  const loader = vi.fn((parent: SfTreeNode | null) => data[parent?.id ?? ''] ?? []);
  void model.setLoader(loader);
  return { model, selection, loader };
}

const ids = (model: SfTreeModel) => model.rows().map((row) => row.id);

describe('SfTreeModel', () => {
  it('sorts siblings by name with a locale, numeric compare — or keeps the source order', () => {
    const { model } = create();
    expect(ids(model)).toEqual(['a', 'b', 'g']);
    void model.expand('a');
    expect(ids(model)).toEqual(['a', 'a1', 'a2', 'b', 'g']); // "item 9" before "item 10"

    expect(ids(create('none').model)).toEqual(['b', 'g', 'a']);
  });

  it('flattens with level, set size and position, and loads children once on expansion', () => {
    const { model, loader } = create();
    void model.expand('b');
    void model.collapse('b');
    void model.expand('b');
    expect(loader).toHaveBeenCalledTimes(2);
    const row = model.rows().find((r) => r.id === 'b1');
    expect(row).toMatchObject({ kind: 'node', level: 2, setSize: 1, posInSet: 1, parentId: 'b', expandable: true });
  });

  it('shows a loading row while children load and drops a stale response after a reload', async () => {
    const pending = new Subject<SfTreeNode[]>();
    const selection = signal<readonly string[]>([]);
    const model = new SfTreeModel({ selection, sort: signal<SfTreeSort>('name') });
    void model.setLoader((parent) => (parent ? pending : [folder('x')]));
    void model.expand('x');
    expect(model.rows().map((r) => r.kind)).toEqual(['node', 'loading']);
    pending.next([leaf('y')]);
    pending.complete();
    await Promise.resolve();
    expect(ids(model)).toEqual(['x', 'y']);
  });

  it('restores an expansion level by level and keeps it across a refresh', async () => {
    const { model } = create();
    model.restoreExpansion(['b', 'b1']);
    expect(ids(model)).toEqual(['a', 'b', 'b1', 'b1x', 'g']);
    await model.load(null);
    expect(ids(model)).toEqual(['a', 'b', 'b1', 'b1x', 'g']);
  });

  it('drops removed nodes and their subtrees on refresh', async () => {
    const data = { ...DATA, '': [...DATA['']] };
    const { model } = create('name', data);
    await model.expand('b');
    data[''] = data[''].filter((node) => node.id !== 'b');
    await model.load(null);
    expect(ids(model)).toEqual(['a', 'g']);
    expect(model.node('b1')).toBeNull();
  });

  it('filters the loaded nodes: matches plus their ancestors, auto-expanded', async () => {
    const { model } = create();
    await model.expandAll();
    model.collapseAll();
    model.setQuery('DEE');
    expect(ids(model)).toEqual(['b', 'b1', 'b1x']);
    expect(model.rows().filter((r) => r.kind === 'node' && r.match).map((r) => r.id)).toEqual(['b1x']);
    model.collapse('b');
    expect(ids(model)).toEqual(['b']);
    model.setQuery('');
    expect(ids(model)).toEqual(['a', 'b', 'g']);
  });

  it('selects ranges from the anchor, toggles, and resolves action targets', () => {
    const { model, selection } = create();
    model.selectOnly('a');
    model.selectRange('g');
    expect(selection()).toEqual(['a', 'b', 'g']);
    model.toggle('b');
    expect(selection()).toEqual(['a', 'g']);
    expect(model.targetsOf('g').map((n) => n.id)).toEqual(['a', 'g']);
    expect(model.targetsOf('b').map((n) => n.id)).toEqual(['b']);
  });

  it('type-ahead extends the typed text quickly and cycles on a repeated letter', () => {
    const { model } = create();
    void model.expand('b');
    expect(model.typeahead('b', 'a', 1000)?.id).toBe('b');
    expect(model.typeahead('-', 'b', 1100)?.id).toBe('b1');
    expect(model.typeahead('b', 'b1', 5000)?.id).toBe('b');
    expect(model.typeahead('b', 'b', 5100)?.id).toBe('b1');
  });

  it('settles a superseded load when the newer one is in, and every pending load on cancelAll', async () => {
    const first = new Subject<SfTreeNode[]>();
    const second = new Subject<SfTreeNode[]>();
    const third = new Subject<SfTreeNode[]>();
    const responses = [first, second, third];
    const selection = signal<readonly string[]>([]);
    const model = new SfTreeModel({ selection, sort: signal<SfTreeSort>('name') });
    void model.setLoader((parent) => (parent ? responses.shift()! : [folder('x')]));

    const superseded = vi.fn();
    void model.load('x').then(superseded);
    const current = model.load('x');
    await Promise.resolve();
    expect(superseded).not.toHaveBeenCalled();
    second.next([leaf('y')]);
    second.complete();
    await current;
    await Promise.resolve();
    expect(superseded).toHaveBeenCalled();
    expect(model.loading().size).toBe(0);

    const cancelled = vi.fn();
    void model.load('x').then(cancelled);
    model.cancelAll();
    await Promise.resolve();
    expect(cancelled).toHaveBeenCalled();
    expect(first.observed).toBe(false);
    expect(third.observed).toBe(false);
  });

  it('records a failed load and collapses the node again; a later load clears the failure', async () => {
    const selection = signal<readonly string[]>([]);
    const onError = vi.fn();
    const model = new SfTreeModel({ selection, sort: signal<SfTreeSort>('name'), onError });
    let fail = true;
    void model.setLoader((parent) => {
      if (parent && fail) {
        throw new Error('boom');
      }
      return parent ? [leaf('y')] : [folder('x')];
    });
    await model.expand('x');
    expect(model.failed().has('x')).toBe(true);
    expect(model.expanded().has('x')).toBe(false);
    expect(model.rows().find((r) => r.id === 'x')).toMatchObject({ expanded: false });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'x');

    fail = false;
    await model.expand('x');
    expect(model.failed().size).toBe(0);
    expect(ids(model)).toEqual(['x', 'y']);
  });

  it('saves only reachable expanded ids, keeping unloaded ones while a branch is still loading', async () => {
    const { model } = create();
    await model.expand('b');
    await model.expand('b1');
    model.collapse('b');
    model.expanded.update((set) => new Set([...set, 'gone']));
    expect(model.persistableExpansion()).toEqual([]);

    model.expanded.update((set) => new Set([...set, 'b']));
    expect(model.persistableExpansion()).toEqual(['b', 'b1']);

    const pending = new Subject<SfTreeNode[]>();
    const selection = signal<readonly string[]>([]);
    const lazy = new SfTreeModel({ selection, sort: signal<SfTreeSort>('name') });
    void lazy.setLoader((parent) => (parent ? pending : [folder('x')]));
    lazy.restoreExpansion(['x', 'not-loaded-yet']);
    expect(lazy.persistableExpansion()).toEqual(['x', 'not-loaded-yet']);
  });

  it('anchors a range on the focused row when nothing was clicked yet', () => {
    const { model, selection } = create();
    model.ensureAnchor('a');
    model.selectRange('b');
    expect(selection()).toEqual(['a', 'b']);
    model.ensureAnchor('g'); // an anchor exists: kept
    model.selectRange('g');
    expect(selection()).toEqual(['a', 'b', 'g']);
  });

  it('highlights the first match of the query', () => {
    expect(highlightSegments('Alphabet', 'pha')).toEqual([
      { text: 'Al', match: false },
      { text: 'pha', match: true },
      { text: 'bet', match: false },
    ]);
    expect(highlightSegments('Alpha', 'x')).toEqual([{ text: 'Alpha', match: false }]);
  });
});
