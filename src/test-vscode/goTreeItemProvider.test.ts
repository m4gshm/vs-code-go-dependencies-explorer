import * as assert from 'assert';
import path, { join } from 'path';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../goExec';
import { GoPackageProvider } from '../goPackageProvider';
import { GoTreeItemProvider } from '../goTreeItemProvider';
import { ROOT_MODULES, ROOT_STD_LIB } from '../goDependenciesFsCommon';

suite('GoTreeItemProvider Test Suite', () => {
    let goExtensionApi: GoExtensionAPI | undefined;
    let goExec: GoExec | undefined;
    let goPackDirProvider: GoPackageProvider | undefined;
    let provider: GoTreeItemProvider | undefined;

    suiteSetup(async () => {
        goExtensionApi = await getGoExtensionAPI();
        if (!goExtensionApi) {
            throw new Error('GoExtensionAPI not found');
        } else {
            goExec = new GoExec(getGoBinPath(goExtensionApi));
            goPackDirProvider = new GoPackageProvider(goExec);
            provider = await GoTreeItemProvider.new(goPackDirProvider);
        }
    });

    test('populated rootDirs', async () => {
        await provider!.refresh();
        const rootDirs = provider!.rootDirs;
        assert.ok(rootDirs);
        assert.ok(Array.isArray(rootDirs));

        assert.ok(rootDirs.length === 3);

        assert.equal('Standard library', rootDirs[0].label);
        assert.equal('External packages', rootDirs[1].label);
    });

    test('findDir returns directory for known path', async () => {
        await provider!.refresh();
        const stdLibPath = provider?.rootDirs[0].id || '';
        const knownPath = join(stdLibPath, 'fmt');
        const dir = provider!.findDir(knownPath);
        assert.strictEqual(dir!!.dir.path, knownPath);
    });

    test('findDir returns undefined for non-existent path', async () => {
        await provider!.refresh();
        const dir = provider!.findDir('/non/existent/path');
        assert.strictEqual(dir, undefined);
    });
});