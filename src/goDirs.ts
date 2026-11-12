import { normalizeWinPath } from "./pathTree";
import { join } from 'path';
import { GoExec } from "./goExec";

export async function getGoPackagePaths(goExec: GoExec) {
    const env = await goExec.getEnv();
    const stdLibPath = getStdLibPath(env);
    const modulePath = getModulesPath(env);
    return { stdLibPath, modulePath };
}

export function getStdLibPath(env: Record<string, string>) {
    return getEnvSubPath(env, 'GOROOT', 'src');
}

export function getModulesPath(env: Record<string, string>) {
    return getEnvSubPath(env, 'GOMODCACHE');
}

function getEnvSubPath(env: Record<string, string>, key: string, ...rest: string[]) {
    return normalizeWinPath(join(env[key] ?? '', ...rest));
}
