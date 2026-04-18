import { normalizeWinPath } from "./directory";
import { join } from 'path';
import { GoExec } from "./goExec";

export function getGoDepDirs(goExec: GoExec) {
    const env = goExec.getEnv();
    const stdLibDir = getStdLibDir(env);
    const moduleDirs = getModulesDir(env);
    return { stdLibDir, moduleDirs };
}

export function getStdLibDir(env: any) {
    const goRoot = env['GOROOT'];
    return normalizeWinPath(join(`${goRoot}`, 'src'));
}

export function getModulesDir(env: any) {
    const goModCache = env['GOMODCACHE'];
    return normalizeWinPath(`${goModCache}`);
}
