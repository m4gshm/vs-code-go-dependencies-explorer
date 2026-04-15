import { normalizeWinPath } from "./directory";
import { join } from 'path';

export function getStdLibDir(env: any) {
    const goRoot = env['GOROOT'];
    return normalizeWinPath(join(`${goRoot}`, 'src'));
}

export function getExtPackagesDir(env: any) {
    const goModCache = env['GOMODCACHE'];
    return normalizeWinPath(`${goModCache}`);
}
