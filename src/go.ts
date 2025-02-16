import cp from 'child_process';
import { Uri } from 'vscode';
import { URL } from 'url';
import * as util from 'util';

export type WorkDir = string | URL | undefined;

export class GoExec {
    private readonly _goPath: string;
    public get goPath(): string {
        return this._goPath;
    }

    constructor(goPath: string) {
        this._goPath = goPath;
    }

    public async getAllDependencyDirs(fileDirs: string[]): Promise<string[]> {
        return Promise.resolve(fileDirs).then(fileDirs =>
            Promise.all(fileDirs.map(fd => this.getDependencyDirs(fd)
                .then(dirs => dirs.filter(dir => !dir.startsWith(fd)))))
                .then(ww => ww.flatMap(s => s)));
    }

    public async getDependencyDirs(workDir: WorkDir = undefined) {
        const execResult = await this.execGo(['list', '-f', '{{.Dir}}', '-deps', 'all'], workDir);
        const err = execResult.err;
        const out = execResult.out;
        if ('go: warning: "all" matched no packages' === err) {
            return [];
        } else {
            const modules = out.split('\n').filter(module => module.length > 0);
            return modules;
        }
    }

    public async getDependencies(workDir: WorkDir) {
        const execResult = await this.execGo(['list', '-m', '-f', '{{.Path}}', 'all'], workDir);
        const err = execResult.err;
        const out = execResult.out;
        const modules = out.split('\n').filter(module => module.length > 0);
        return modules;
    }

    public async getModuleInfo(moduleName: string, workDir: WorkDir) {
        let execResult = await this.execGo(['list', '-m', '--json', `${moduleName}`], workDir);
        const err = execResult.err;
        const out = execResult.out;
        var rawJson = JSON.parse(out);
        return rawJson as ModuleInfo;
    }

    private async execGo(args: string[], workDir: WorkDir) {
        return await this.exec(this.goPath, args, workDir);
    }

    private async exec(command: string, args: string[], workDir: WorkDir) {
        const execFile = util.promisify(cp.execFile);
        try {
            const { stdout, stderr } = await execFile(command, args, { cwd: workDir });
            // if (stderr.length > 0) {
            //     throw Error(`failed to run "${command} ${args}": stderr:'${stderr}' cwd: ${workDir}`);
            // }
            return { out: stdout.trim(), err: stderr.trim() };
        } catch (err) {
            if (typeof err === "string") {
                throw Error(`failed to run "${command} ${args}": ${err} cwd: ${workDir}`);
            } else if (err instanceof Error) {
                throw Error(`failed to run "${command} ${args}": ${err.message} cwd: ${workDir}`);
            }
            throw err;
        }
    }
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