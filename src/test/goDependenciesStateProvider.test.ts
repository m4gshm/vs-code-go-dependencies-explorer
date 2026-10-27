import * as assert from 'assert';
import { join } from 'path';
import { suite, test } from 'vitest';
import { GoDependenciesStateProvider } from '../goDependenciesStateProvider';
import { GoModuleTree, GoPackageProvider, GoStdLibTree } from '../goPackageProvider';
import { PathElement, PathTreeBuilder } from '../pathTree';

const normalize = (p: string) => join(p);

interface FakeModule {
    dir: string;
    path: string;
    replaced: boolean;
    version?: string;
}

function stdLib(rootDir: string, pkgDirs: string[]): GoStdLibTree {
    const root = PathTreeBuilder.create(pkgDirs, rootDir)!.toDirectory();
    return { root };
}

function modules(ofDirs: FakeModule[], replacedDirs: FakeModule[]): GoModuleTree {
    const dirs = ofDirs.map(m => m.dir);
    const replaced = replacedDirs.map(m => m.dir);
    const root = PathTreeBuilder.create(dirs)?.toDirectory();
    const rootReplaced = PathTreeBuilder.create(replaced)?.toDirectory();
    const versions = new Map(ofDirs.concat(replacedDirs)
        .filter(m => m.version !== undefined)
        .map(m => [normalize(m.dir), m.version as string]));
    return { root, rootReplaced, versions, updates: new Map() };
}

class FakePackageProvider {
    private readonly stdLib: () => GoStdLibTree;
    private readonly mds: () => GoModuleTree;

    constructor(stdLib: () => GoStdLibTree, mds: () => GoModuleTree) {
        this.stdLib = stdLib;
        this.mds = mds;
    }

    async getPackages(): Promise<[GoStdLibTree, GoModuleTree]> {
        return [this.stdLib(), this.mds()];
    }
}

async function provider(stdLib: () => GoStdLibTree, mds: () => GoModuleTree): Promise<GoDependenciesStateProvider> {
    const fake = new FakePackageProvider(stdLib, mds) as unknown as GoPackageProvider;
    return await GoDependenciesStateProvider.new(fake);
}

suite('GoDependenciesStateProvider unit', () => {

    test('rootDirs contains standard lib and modules roots', async () => {
        let calls = 0;
        const p = await provider(
            () => (calls++, stdLib(normalize('/root'), [normalize('/root/pkg/app')])),
            () => modules([{ dir: normalize('/mod/lib'), path: 'lib', replaced: false }], []),
        );

        const roots = p.rootDirs;
        assert.strictEqual(roots.length, 2);
        assert.strictEqual(roots[0].name, 'Standard Library');
        assert.strictEqual(roots[1].name, 'External Packages');
        assert.strictEqual(calls, 1, 'rootDirs must not trigger an extra package recalculation');
    });

    test('rootDirs omits missing external modules root', async () => {
        const p = await provider(
            () => stdLib(normalize('/root'), [normalize('/root/pkg/app')]),
            () => ({ root: undefined, rootReplaced: undefined, versions: new Map(), updates: new Map() }),
        );

        assert.deepStrictEqual(p.rootDirs.map((d: PathElement) => d.name), ['Standard Library']);
    });

    test('findDir resolves dirs from stdlib, modules and replaced modules', async () => {
        const p = await provider(
            () => stdLib(normalize('/root'), [normalize('/root/pkg/app')]),
            () => modules(
                [{ dir: normalize('/mod/lib'), path: 'lib', replaced: false }],
                [{ dir: normalize('/mod/replaced'), path: 'r', replaced: true }],
            ),
        );

        assert.ok(p.findDir(normalize('/root/pkg/app')));
        assert.ok(p.findDir(normalize('/mod/lib')));
        assert.ok(p.findDir(normalize('/mod/replaced')));
        assert.strictEqual(p.findDir('/unknown'), undefined);
    });

    test('refresh with calcChanges reports added and removed dirs', async () => {
        let mds = modules(
            [{ dir: normalize('/mod/old'), path: 'old', replaced: false }],
            [{ dir: normalize('/mod/oldrep'), path: 'oldrep', replaced: true }],
        );
        const p = await provider(
            () => stdLib(normalize('/root'), [normalize('/root/pkg/app')]),
            () => mds,
        );

        mds = modules([{ dir: normalize('/mod/new'), path: 'new', replaced: false }], []);
        const changes = await p.refresh(true);

        assert.ok(changes);
        assert.deepStrictEqual(changes.addedModuleDir!.map((d: PathElement) => d.path), [normalize('/mod/new')]);
        assert.deepStrictEqual(changes.removedModuleDirs!.map((d: PathElement) => d.path), [normalize('/mod/old')]);
        assert.deepStrictEqual(changes.addedReplaced!.map((d: PathElement) => d.path), []);
        assert.deepStrictEqual(changes.removedReplaced!.map((d: PathElement) => d.path), [normalize('/mod/oldrep')]);
    });

    test('refresh without calcChanges updates state silently', async () => {
        let mds = modules([{ dir: normalize('/mod/new'), path: 'new', replaced: false }], []);
        const p = await provider(() => stdLib(normalize('/root'), [normalize('/root/pkg/app')]), () => mds);
        mds = modules([{ dir: normalize('/mod/other'), path: 'other', replaced: false }], []);
        const changes = await p.refresh();

        assert.strictEqual(changes, undefined);
        assert.ok(p.findDir(normalize('/mod/other')));
        assert.strictEqual(p.findDir(normalize('/mod/new')), undefined);
    });
    test('versionOf resolves module version for module root and its top-level packages', async () => {
        const p = await provider(
            () => stdLib(normalize('/root'), [normalize('/root/pkg/app')]),
            () => modules([{ dir: normalize('/mod/lib'), path: 'lib', replaced: false, version: 'v1.2.3' }], []),
        );

        assert.strictEqual(p.versionOf(normalize('/mod/lib')), 'v1.2.3');
        assert.strictEqual(p.versionOf(normalize('/mod/lib/sub')), 'v1.2.3', 'top-level package of a module without root package inherits the version');
        assert.strictEqual(p.versionOf(normalize('/mod/lib/sub/deep')), undefined, 'deep packages do not show the version');
        assert.strictEqual(p.versionOf(normalize('/root')), undefined);
    });

    test('dirs lists all known directories of every root', async () => {
        const p = await provider(
            () => stdLib(normalize('/root'), [normalize('/root/pkg/app')]),
            () => modules([{ dir: normalize('/mod/lib'), path: 'lib', replaced: false }],
                [{ dir: normalize('/mod/replaced'), path: 'r', replaced: true }]),
        );

        const paths = p.dirs.map((d: PathElement) => d.path).sort();
        assert.deepStrictEqual(paths, [
            normalize('/mod/lib'),
            normalize('/mod/replaced'),
            normalize('/root'),
            normalize('/root/pkg'),
            normalize('/root/pkg/app'),
        ].sort());
    });

});
