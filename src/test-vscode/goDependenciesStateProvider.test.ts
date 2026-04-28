import { join } from 'path';
import * as assert from 'assert';
import { GoExec } from '../goExec';
import { GoPackageProvider } from '../goPackageProvider';
import { getGoBinPath, getGoExtensionAPI } from '../goExtension';
import { GoDependenciesStateProvider } from '../goDependenciesStateProvider';
import { PathElement } from '../pathTree';

suite(typeof GoDependenciesStateProvider + ' Test Suite', () => {

    let provider: GoDependenciesStateProvider | undefined;

    suiteSetup(async () => {
        const goExtensionApi = await getGoExtensionAPI();
        if (!goExtensionApi) {
            throw new Error('GoExtensionAPI not found');
        } else {
            const goExec = new GoExec(getGoBinPath(goExtensionApi));
            const goPackDirProvider = new GoPackageProvider(goExec);
            provider = await GoDependenciesStateProvider.new(goPackDirProvider);
        }
    });

    test('populated rootDirs', async () => {
        await provider!.refresh();
        const rootDirs = provider!.rootDirs;
        assert.ok(rootDirs);
        assert.ok(Array.isArray(rootDirs));

        assert.ok(rootDirs.length === 3);
        for (const dir of rootDirs) {
            assert.ok(dir instanceof PathElement);
        }

        assert.equal('Standard Library', rootDirs[0].name);
        assert.equal('External Packages', rootDirs[1].name);
    });

    test('findDir returns directory for known path', async () => {
        await provider!.refresh();
        const stdLibPath = provider?.rootDirs[0].path || '';
        const knownPath = join(stdLibPath, 'fmt');
        const dir = provider!.findDir(knownPath);
        assert.strictEqual(dir!!.path, knownPath);
    });

    test('findDir returns undefined for non-existent path', async () => {
        await provider!.refresh();
        const dir = provider!.findDir('/non/existent/path');
        assert.strictEqual(dir, undefined);
    });

    test('findDir returns same element', async () => {
        await provider!.refresh();
        const rootDirs = provider!.rootDirs;
        assert.ok(rootDirs.length > 0);
        const element = rootDirs[0];
        const treeItem = provider?.findDir(element.path);
        assert.strictEqual(treeItem, element);
    });

});