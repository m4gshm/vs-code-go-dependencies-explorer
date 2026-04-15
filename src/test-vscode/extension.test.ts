import * as assert from 'assert';
import { join } from 'path';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../go';
import { getExtPackagesDir, getStdLibDir } from '../goEnv';
import { normalizeWinPath } from '../directory';

suite('GoExec Test Suite', () => {
  let goExtensionApi: GoExtensionAPI | undefined;
  let goExec: GoExec | undefined;
  let goEnv: any;

  suiteSetup(async () => {
    goExtensionApi = await getGoExtensionAPI();
    if (!goExtensionApi) {
      throw new Error('GoExtensionAPI not found');
    } else {
      goExec = new GoExec(getGoBinPath(goExtensionApi));
      goEnv = await goExec.getEnv();
    }
    // const extension = vscode.extensions.getExtension('m4gshm.vs-code-go-dependencies-explorer');
    // if (extension) {
    //   context = await extension.activate();
    // } else {
    //   throw new Error('Extension not found');
    // }
  });

  test('stdLibDir test', async () => {
    const stdLibDir = getStdLibDir(goEnv);
    const expected = normalizeWinPath(join(`${goEnv['GOROOT']}`, 'src'));
    assert.strictEqual(expected, stdLibDir);
  });

  test('extPackagesDir test', async () => {
    const extPackagesDir = getExtPackagesDir(goEnv);
    const expected = normalizeWinPath(`${goEnv['GOMODCACHE']}`);
    assert.strictEqual(expected, extPackagesDir);
  });
});