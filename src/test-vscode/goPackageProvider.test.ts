import * as assert from 'assert';
import { join } from 'path';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../goExec';
import { GoPackageProvider } from '../goPackageProvider';
import { normalizeWinPath } from '../pathTree';

suite('GoPackageProvider Test Suite', () => {
    let goExtensionApi: GoExtensionAPI | undefined;
    let goExec: GoExec | undefined;
    let provider: GoPackageProvider | undefined;

    suiteSetup(async () => {
        goExtensionApi = await getGoExtensionAPI();
        if (!goExtensionApi) {
            throw new Error('GoExtensionAPI not found');
        } else {
            goExec = new GoExec(getGoBinPath(goExtensionApi));
            provider = new GoPackageProvider(goExec);
        }
    });

    test('getDependencyDirs returns stdLibPath and modulePath', () => {
        const dirs = provider!.getPackagePaths();
        assert.ok(dirs);

        // stdLibPath should be under GOROOT/src
        const env = goExec!.getEnv();
        const expectedStdLibDir = normalizeWinPath(join(`${env['GOROOT']}`, 'src'));
        assert.strictEqual(dirs.stdLibPath, expectedStdLibDir);
        // modulePath should be GOMODCACHE
        const expectedModuleDirs = normalizeWinPath(`${env['GOMODCACHE']}`);
        assert.strictEqual(dirs.modulePath, expectedModuleDirs);
    });

    test('getGoPackages returns tuple with stdlib and external packages', async () => {
        const [stdlib, external] = await provider!.getPackages();
        assert.ok(stdlib);
        assert.ok(external);
    });

    test('onRequestPackages event fires when getGoPackages is called', async () => {
        let eventFired = false;
        let eventData: any = null;
        const disposable = provider!.onRequestPackages((data) => {
            eventFired = true;
            eventData = data;
        });
        // Trigger event
        await provider!.getPackages();
        assert.strictEqual(eventFired, true);
        assert.ok(eventData);
        assert.strictEqual(eventData.length, 2); // [GoStdLibDirs, GoPackageDirs]
        disposable.dispose();
    });
});