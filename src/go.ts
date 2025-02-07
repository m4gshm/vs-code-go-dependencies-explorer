import cp from 'child_process';
import { URL } from 'url';

type WorkDir = string |  URL | undefined;

export function getDependencyDirs(workDir: WorkDir = undefined): string[] {
    const strResult = execGo(['list', '-f', '{{.Dir}}', 'all'], workDir);
    const modules = strResult.split('\n').filter(module => module.length > 0);
    return modules;
}

export function getDependencies(workDir: WorkDir): string[] {
    const strResult = execGo(['list', '-m', '-f', '{{.Path}}', 'all'], workDir);
    const modules = strResult.split('\n').filter(module => module.length > 0);
    return modules;
}

export class ModuleInfo {
    constructor(
        public readonly Path: string,
        public readonly Main: boolean,
        public readonly Dir: string,
        public readonly GoMod: string,
        public readonly GoVersion: string,
    ) {
    }
}

export function getModuleInfo(moduleName: string, workDir: WorkDir): ModuleInfo {
    let strResult = execGo(['list', '-m', '--json', `${moduleName}`], workDir);
    var rawJson = JSON.parse(strResult);
    return rawJson as ModuleInfo;

}

function execGo(args: string[], workDir: WorkDir): string {
    return exec(goExecPath(), args, workDir);
}

function goExecPath() {
    return 'go';
}

function exec(command: string, args: string[], workDir: WorkDir): string {
    let strResult: string;
    try {
        const rawResult = cp.execFileSync(command, args, { cwd: workDir });
        strResult = `${rawResult}`;
    } catch (err) {
        if (typeof err === "string") {
            throw Error(`failed to run "${command} ${args}": ${err} cwd: ${workDir}`);
        } else if (err instanceof Error) {
            throw Error(`failed to run "${command} ${args}": ${err.message} cwd: ${workDir}`);
        }
        throw err;
    }
    return strResult;
}
