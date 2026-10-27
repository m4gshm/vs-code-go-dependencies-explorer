import { describe, expect, it } from 'vitest';
import { TreeState } from '../treeState';

interface Item {
    id?: string;
    name: string;
}

const item = (id: string, name = id): Item => ({ id, name });

describe('TreeState', () => {

    it('add and element resolve by id', () => {
        const state = new TreeState<Item>();
        state.add(item('a'));

        expect(state.element('a')).toEqual({ id: 'a', name: 'a' });
        expect(state.element('missing')).toBeUndefined();
        expect(state.element(undefined)).toBeUndefined();
    });

    it('element without id is not registered', () => {
        const state = new TreeState<Item>();
        state.add({ name: 'no-id' });

        expect(state.element('no-id')).toBeUndefined();
    });

    it('linkChildren registers children, parents and returns cached children', () => {
        const state = new TreeState<Item>();
        state.add(item('parent'));
        state.linkChildren('parent', [item('c1'), item('c2')]);

        expect(state.childrenOf('parent')!.map(i => i.id)).toEqual(['c1', 'c2']);
        expect(state.parentOf('c1')).toEqual({ id: 'parent', name: 'parent' });
        expect(state.parentOf('c2')?.id).toBe('parent');
    });

    it('childrenOf returns undefined when children were never linked, empty array when linked as empty', () => {
        const state = new TreeState<Item>();
        state.add(item('a'));
        state.linkChildren('b', []);

        expect(state.childrenOf('a')).toBeUndefined();
        expect(state.childrenOf('b')).toEqual([]);
        expect(state.childrenOf(undefined)).toBeUndefined();
    });

    it('deleteDeep removes the subtree only', () => {
        const state = new TreeState<Item>();
        state.add(item('root'));
        state.linkChildren('root', [item('kept'), item('removed')]);
        state.linkChildren('removed', [item('removed-child')]);
        state.onExpand('removed-child');

        state.deleteDeep('removed');

        expect(state.element('removed')).toBeUndefined();
        expect(state.element('removed-child')).toBeUndefined();
        expect(state.childrenOf('removed')).toBeUndefined();
        expect(state.isExpanded('removed-child')).toBe(false);
        expect(state.element('kept')).toBeDefined();
        expect(state.parentOf('kept')?.id).toBe('root');
    });

    it('deleteDeep of unknown id is a no-op', () => {
        const state = new TreeState<Item>();
        state.add(item('a'));

        expect(() => state.deleteDeep('unknown')).not.toThrow();
        expect(state.element('a')).toBeDefined();
    });

    it('expand and collapse track state per id', () => {
        const state = new TreeState<Item>();

        state.onExpand('a');
        expect(state.isExpanded('a')).toBe(true);
        state.onCollapse('a');
        expect(state.isExpanded('a')).toBe(false);
        state.onCollapse('a');
        state.onExpand(undefined);
        state.onCollapse(undefined);
    });

    it('clear resets everything', () => {
        const state = new TreeState<Item>();
        state.add(item('root'));
        state.linkChildren('root', [item('child')]);
        state.onExpand('child');

        state.clear();

        expect(state.element('root')).toBeUndefined();
        expect(state.childrenOf('root')).toBeUndefined();
        expect(state.parentOf('child')).toBeUndefined();
        expect(state.isExpanded('child')).toBe(false);
    });
});
