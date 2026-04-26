import * as assert from 'assert';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../goExec';
import { GoPackageProvider } from '../goPackageProvider';
import { GoDependenciesStateProvider } from '../goDependenciesStateProvider';
import { GoTreeDataProvider } from '../treeView';

suite('GoTreeDataProvider Test Suite', () => {
    let provider: GoTreeDataProvider | undefined;

    suiteSetup(async () => {
        const goExtensionApi = await getGoExtensionAPI();
        if (!goExtensionApi) {
            throw new Error('GoExtensionAPI not found');
        } else {
            const goExec = new GoExec(getGoBinPath(goExtensionApi));
            const goPackDirProvider = new GoPackageProvider(goExec);
            const goDependenciesStateProvider = await GoDependenciesStateProvider.new(goPackDirProvider);
            provider = new GoTreeDataProvider(goDependenciesStateProvider);
        }
    });

    test('getChildren with undefined element returns root directories', async () => {
        await provider!.refresh();
        const children = await provider!.getChildren();
        assert.ok(children);
        assert.ok(Array.isArray(children));
        assert.ok(children.length === 3);
        assert.strictEqual('Standard Library', children[0].label);
        assert.strictEqual('External Packages', children[1].label);
    });

    test('getChildren with GoDirItem returns subdirectories and files', async () => {
        await provider!.refresh();
        const rootDirs = await provider!.getChildren();
        const rootDir = rootDirs[0];
        const children = await provider!.getChildren(rootDir);
        assert.ok(Array.isArray(children));
    });

    test('getParent returns parent directory for known path', async () => {
        await provider!.refresh();
        // Find a directory that has a parent (e.g., a subdirectory of stdlib)
        const rootDirs = await provider!.getChildren();
        const rootDir = rootDirs[0];
        const children = await provider!.getChildren(rootDir);
        if (children.length > 0) {
            const child = children[0];
            const parent = await provider!.getParent(child);
            // Parent should be the rootDir
            assert.strictEqual(parent?.id, rootDir.id);
        }
        // If no children, test is inconclusive but not a failure
    });

    test('getParent returns undefined for root directory', async () => {
        await provider!.refresh();
        const rootDirs = await provider!.getChildren();
        const rootDir = rootDirs[0];
        const parent = await provider!.getParent(rootDir);
        assert.strictEqual(parent, undefined);
    });
});