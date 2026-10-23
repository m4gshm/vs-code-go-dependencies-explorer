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

  test('listPackageDirs returns array', async () => {
    const dirs = await goExec!.listPackageDirs();
    assert.ok(Array.isArray(dirs));
    assert.ok(dirs.length >= 0);
  });

  test('listPackageDirs with workDir and excludeWorkDir false', async () => {
    const dirs = await goExec!.listPackageDirs(workDir, false);
    assert.ok(Array.isArray(dirs));
    const normalizedWorkDir = normalizeWinPath(workDir);
    assert.ok(dirs.some(dir => normalizeWinPath(dir) === normalizedWorkDir));
  });

  test('listAllPackageDirs with multiple workDirs', async () => {
    const dirs = await goExec!.listAllPackageDirs([workDir, workDir2]);
    assert.ok(Array.isArray(dirs));
    assert.ok(dirs.length >= 0);
  });

  test('getModules returns modules', async () => {
    const modules = await goExec!.getModules(undefined, workDir);
    assert.ok(Array.isArray(modules));
    const stubModule = modules.find(m => m.path === 'stub');
    assert.ok(stubModule, 'stub module not found');
    assert.ok(stubModule!.dir.length > 0);
    assert.ok(typeof stubModule!.replaced === 'boolean');
  });

  test('getModules with specific module name', async () => {
    const modules = await goExec!.getModules('stub', workDir);
    assert.ok(Array.isArray(modules));
    assert.strictEqual(modules.length, 1);
    assert.strictEqual(modules[0].path, 'stub');
  });

  test('getEnv returns expected keys', async () => {
    const env = await goExec!.getEnv();
    assert.ok(env.GOROOT, 'GOROOT missing');
    assert.ok(env.GOPATH, 'GOPATH missing');
    assert.ok(env.GOMODCACHE, 'GOMODCACHE missing');
  });
});