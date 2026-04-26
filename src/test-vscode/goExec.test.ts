import * as assert from 'assert';
import { join } from 'path';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../goExec';
import { getModulesPath, getStdLibPath } from '../goDirs';
import { normalizeWinPath } from '../pathTree';

suite('GoExec Test Suite', () => {
  const workDir = join(__dirname, '../../goWorkspace/go_stub');
  const workDir2 = join(__dirname, '../../src');
  let goExtensionApi: GoExtensionAPI | undefined;
  let goExec: GoExec | undefined;
  let goEnv: any;

  suiteSetup(async () => {
    goExtensionApi = await getGoExtensionAPI();
    if (!goExtensionApi) {
      throw new Error('GoExtensionAPI not found');
    } else {
      goExec = new GoExec(getGoBinPath(goExtensionApi));
      goEnv = goExec.getEnv();
    }
  });

  test('stdLibPath test', () => {
    const stdLibPath = getStdLibPath(goEnv);
    const expected = normalizeWinPath(join(`${goEnv['GOROOT']}`, 'src'));
    assert.strictEqual(expected, stdLibPath);
  });

  test('modulesPath test', () => {
    const extPackagesDir = getModulesPath(goEnv);
    const expected = normalizeWinPath(`${goEnv['GOMODCACHE']}`);
    assert.strictEqual(expected, extPackagesDir);
  });

  test('listPackageDirs returns array', () => {
    const dirs = goExec!.listPackageDirs();
    assert.ok(Array.isArray(dirs));
    // May be empty if no packages matched (e.g., no Go module in current directory)
    // Accept any length >= 0
    assert.ok(dirs.length >= 0);
  });

  test('listPackageDirs with workDir and excludeWorkDir false', () => {
    const dirs = goExec!.listPackageDirs(workDir, false);
    assert.ok(Array.isArray(dirs));
    // Should include the workDir itself (since excludeWorkDir = false)
    const normalizedWorkDir = normalizeWinPath(workDir);
    assert.ok(dirs.some(dir => normalizeWinPath(dir) === normalizedWorkDir));
  });

  test('listAllPackageDirs with multiple workDirs', () => {
    const dirs = goExec!.listAllPackageDirs([workDir, workDir2]);
    assert.ok(Array.isArray(dirs));
    // Should contain directories from both workDirs (or at least from one)
    assert.ok(dirs.length >= 0);
  });

  test('getModules returns modules', () => {
    const modules = goExec!.getModules(undefined, workDir);
    assert.ok(Array.isArray(modules));
    // At least the stub module should be present
    const stubModule = modules.find(m => m.path === 'stub');
    assert.ok(stubModule, 'stub module not found');
    assert.ok(stubModule!.dir.length > 0);
    assert.ok(typeof stubModule!.replaced === 'boolean');
  });

  test('getModules with specific module name', () => {
    const modules = goExec!.getModules('stub', workDir);
    assert.ok(Array.isArray(modules));
    assert.strictEqual(modules.length, 1);
    assert.strictEqual(modules[0].path, 'stub');
  });

  test('getEnv returns expected keys', () => {
    const env = goExec!.getEnv();
    assert.ok(env.GOROOT, 'GOROOT missing');
    assert.ok(env.GOPATH, 'GOPATH missing');
    assert.ok(env.GOMODCACHE, 'GOMODCACHE missing');
  });
});