import { normalizeWinPath } from "./pathTree";
import { join } from 'path';
import { GoExec } from "./goExec";

export function getGoPackagePaths(goExec: GoExec) {
    const env = goExec.getEnv();
    const stdLibPath = getStdLibPath(env);
    const modulePath = getModulesPath(env);
    return { stdLibPath, modulePath };
}

export function getStdLibPath(env: any) {
    const goRoot = env['GOROOT'];
    return normalizeWinPath(join(`${goRoot}`, 'src'));
}

export function getModulesPath(env: any) {
    const goModCache = env['GOMODCACHE'];
    return normalizeWinPath(`${goModCache}`);
}
