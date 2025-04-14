import cp from 'child_process';
import { Uri } from 'vscode';
import { URL } from 'url';
import * as util from 'util';
import { normalizeWinPath } from './dir';

export type WorkDir = string | URL | undefined;

export class GoExec {
    private readonly _goPath: string;
    public get goPath(): string {
        return this._goPath;
    }

    constructor(goPath: string) {
        this._goPath = goPath;
    }

    public async listAllPackageDirs(workDirs: string[]) {
        return Promise.resolve(workDirs).then(fileDirs =>
            Promise.all(fileDirs.map(fd => this.listPackageDirs(fd, true)))
                .then(ww => ww.flatMap(s => s)));
    }

    public async listPackageDirs(workDir: string | undefined = undefined, excludeWorkDir = true) {
        const args = ['list', '-f', '{{.Dir}}', '-e', 'all'];
        const result = await this.execGo(args, workDir);
        const err = result.err;
        if ('go: warning: "all" matched no packages' === err) {
            return [];
        } else if (err.length > 0) {
            throw this.newError(args, err);
        }
        const out = result.out;
        const dir = out.split('\n').filter(dir => dir.length > 0);
        if (workDir && excludeWorkDir) {
            return dir.filter(dir => !dir.startsWith(workDir));
        }
        return dir;
    }

    public async getEnv(workDir: WorkDir = undefined) {
        const cmd = ['env', '-json'];
        const result = await this.execGo(cmd, workDir);
        const err = result.err;
        if (err.length > 0) {
            throw this.newError(cmd, err);
        }
        const out = result.out;
        const rawJson = JSON.parse(out);
        return rawJson;
    }

    public async getModules(moduleName: string | undefined = undefined, workDir: string) {
        const delim = '=>'; 
        const replaced = 'replaced';
        const args = ['list', '-f', '{{.Path}}' + delim + '{{.Dir}}' + delim + '{{if not (eq .Replace nil)}}' + replaced + '{{end}}', '-m', '-e'];
        if (moduleName) {
            args.push(moduleName);
        }
        const result = await this.execGo(args, workDir);
        const err = result.err;
        if (err.length > 0) {
            throw this.newError(args, err);
        }
        const out = result.out;
        const modules = out.split('\n').map(pair => {
            const parts = pair.split(delim);
            const path = parts[0];
            const dir = parts[1];
            const replaced = parts[2];
            return { dir: normalizeWinPath(dir), path: path, replaced: replaced === "replaced" };
        }).filter(module => module.dir.length > 0);
        return modules;
    }

    private async execGo(args: string[], workDir: WorkDir = undefined) {
        return await this.exec(this.goPath, args, workDir);
    }

    private async exec(command: string, args: string[], workDir: WorkDir) {
        const execFile = util.promisify(cp.execFile);
        try {
            const { stdout, stderr } = await execFile(command, args, { cwd: workDir });
            return { out: stdout.trim(), err: stderr.trim() };
        } catch (err) {
            if (typeof err === "string") {
                throw this.newError(args, err);
            }
            throw err;
        }
    }

    private newError(args: string[], err: string) {
        return new Error("failed to run 'go " + args.join(' ') + "': " + err);
    }
}
