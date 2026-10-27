import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { GoDirNode, GoTreeModel, TreeSource, ReadDir } from '../treeModel';
import { PathElement } from '../pathTree';
import type { RemovedAddedDirs } from '../goDependenciesStateProvider';

interface FakeDir {
    name: string;
    dirs?: FakeDir[];
    files?: string[];
}

function pathElement(dir: FakeDir, parentPath = ''): PathElement {
    const fullPath = join(parentPath, dir.name);
    const children = (dir.dirs ?? []).map(sub => pathElement(sub, fullPath));
    return new PathElement(dir.name, fullPath, children, (dir.files?.length ?? 0) > 0);
}

class FakeSource implements TreeSource {
    private readonly dirs = new Map<string, PathElement>();

    constructor(
        private readonly roots: PathElement[],
        public refreshCalls: { calcChanges: boolean; useCache: boolean }[] = [],
    ) {
        for (const root of roots) {
            for (const dir of flat(root)) {
                this.dirs.set(dir.path, dir);
            }
        }
    }

    rootDirs() {
        return this.roots;
    }

    findDir(path: string) {
        return this.dirs.get(path);
    }

    versionOf(path: string) {
        return path.includes('lib') ? 'v1.0.0' : undefined;
    }

    async refreshTree(calcChanges: boolean, useCache: boolean): Promise<RemovedAddedDirs | undefined> {
        this.refreshCalls.push({ calcChanges, useCache });
        return undefined;
    }
}

function flat(dir: PathElement): PathElement[] {
    return [dir, ...dir.children.flatMap(flat)];
}

const readDirOf = (tree: FakeDir): ReadDir => {
    const index = new Map<string, FakeDir>();
    const walk = (dir: FakeDir, parentPath: string) => {
        const fullPath = join(parentPath, dir.name);
        index.set(fullPath, dir);
        (dir.dirs ?? []).forEach(sub => walk(sub, fullPath));
    };
    walk(tree, '');
    return async dirPath => {
        const dir = index.get(dirPath);
        if (!dir) {
            throw new Error(`no such dir ${dirPath}`);
        }
        return [
            ...(dir.dirs ?? []).map(sub => ({ name: sub.name, isDirectory: true })),
            ...(dir.files ?? []).map(name => ({ name, isDirectory: false })),
        ];
    };
};

const tree: FakeDir = {
    name: 'root',
    dirs: [
        {
            name: 'lib',
            files: ['a.go', 'a_test.go'],
            dirs: [{ name: 'sub', files: ['b.go'] }],
        },
        { name: 'empty' },
    ],
    files: ['main.go'],
};

const rootElement = pathElement(tree);

describe('GoTreeModel', () => {

    it('returns root dirs as dir nodes', async () => {
        const model = new GoTreeModel(new FakeSource([rootElement]), readDirOf(tree));

        const children = await model.getChildren();

        expect(children).toHaveLength(1);
        expect(children[0]).toBeInstanceOf(GoDirNode);
        expect(children[0].id).toBe(rootElement.path);
    });

    it('caches root nodes between getChildren calls', async () => {
        const model = new GoTreeModel(new FakeSource([rootElement]), readDirOf(tree));

        const first = await model.getChildren();
        const second = await model.getChildren();

        expect(first[0]).toBe(second[0]);
    });

    it('initChildren lists subdirs before files and caches them', async () => {
        const model = new GoTreeModel(new FakeSource([rootElement]), readDirOf(tree));
        const [root] = await model.getChildren();

        const children = await model.getChildren(root);
        const again = await model.getChildren(root);

        expect(children.map(c => c.label)).toEqual(['lib', 'empty', 'main.go']);
        expect(again.map(c => c.id)).toEqual(children.map(c => c.id));
        expect(again[0]).toBe(children[0]);
    });

    it('dir without exposeFiles lists only subdirs', async () => {
        const model = new GoTreeModel(new FakeSource([rootElement]), readDirOf(tree));
        const [root] = await model.getChildren();
        const [, empty] = await model.getChildren(root);

        const children = await model.getChildren(empty as any);

        expect(children).toEqual([]);
    });

    it('getTreeItem registers node and applies expand state and version description', async () => {
        const model = new GoTreeModel(new FakeSource([rootElement]), readDirOf(tree));
        const [root] = await model.getChildren();

        const applied = model.getTreeItem(root) as any;
        expect(applied.isExpanded).toBe(false);
        expect(applied.description).toBeUndefined();

        model.onExpand(root);
        const expanded = model.getTreeItem(root) as any;
        expect(expanded.isExpanded).toBe(true);
        expect(expanded).toBe(root);

        await model.getChildren(root);
        const lib = (await model.getChildren(root)).find(c => c.label === 'lib')!;
        const libApplied = model.getTreeItem(lib) as any;
        expect(libApplied.description).toBe('v1.0.0');
    });

    it('getParent resolves parent of a file via linked children', async () => {
        const model = new GoTreeModel(new FakeSource([rootElement]), readDirOf(tree));
        const [root] = await model.getChildren();
        const children = await model.getChildren(root);
        const lib = children.find(c => c.label === 'lib')!;
        const libChildren = await model.getChildren(lib as any);
        const file = libChildren.find(c => c.label === 'a.go')!;

        const parent = await model.getParent(file as any);

        expect(parent?.id).toBe((lib as any).id);
    });

    it('getParentOf materializes unrendered ancestors from findDir', async () => {
        const source = new FakeSource([rootElement]);
        const model = new GoTreeModel(source, readDirOf(tree));
        const subPath = join(rootElement.path, 'lib', 'sub', 'b.go');

        const parent = await model.getParentOf(subPath);

        expect(parent?.id).toBe(join(rootElement.path, 'lib', 'sub'));
        expect(source.findDir(join(rootElement.path, 'lib', 'sub'))).toBeDefined();
    });

    it('refresh without force requests diff with cache, with force full rescan', async () => {
        const source = new FakeSource([rootElement]);
        const model = new GoTreeModel(source, readDirOf(tree));

        await model.refresh(false);
        await model.refresh(true);

        expect(source.refreshCalls).toEqual([
            { calcChanges: true, useCache: true },
            { calcChanges: false, useCache: false },
        ]);
    });

    it('refresh honors disabled cache', async () => {
        const source = new FakeSource([rootElement]);
        const model = new GoTreeModel(source, readDirOf(tree));

        await model.refresh(false, false);

        expect(source.refreshCalls).toEqual([{ calcChanges: true, useCache: false }]);
    });

    it('refresh applies removed dirs from diff', async () => {
        class RemovingSource extends FakeSource {
            async refreshTree(calcChanges: boolean, useCache: boolean) {
                await super.refreshTree(calcChanges, useCache);
                return calcChanges ? {
                    removedStdDirs: [], addedStdDirs: [],
                    removedModuleDirs: [new PathElement('lib', join(rootElement.path, 'lib'), [])],
                    addedModuleDir: [], removedReplaced: [], addedReplaced: [],
                } : undefined;
            }
        }
        const model = new GoTreeModel(new RemovingSource([rootElement]), readDirOf(tree));
        const [root] = await model.getChildren();
        const children = await model.getChildren(root);
        const lib = children.find(c => c.label === 'lib')!;
        await model.getChildren(lib as any);

        await model.refresh(false);

        expect(model.elementById((lib as any).id)).toBeUndefined();
        const rootChildren = await model.getChildren(root);
        expect(rootChildren.map(c => c.label)).toEqual(['empty', 'main.go']);
    });
});
