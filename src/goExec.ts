import cp, { ExecFileSyncOptionsWithStringEncoding } from 'child_process';
import { URL } from 'url';
import { normalizeWinPath } from './directory';

export type WorkDir = string | URL | undefined;

export class GoExec {
    private readonly _goPath: string;
    public get goPath(): string {
        return this._goPath;
    }

    constructor(goPath: string) {
        this._goPath = goPath;
    }

    public listAllPackageDirs(fileDirs: string[]) {
        return fileDirs.map(fd => this.listPackageDirs(fd, true)).flatMap(s => s);
    }

    public listPackageDirs(workDir: string | undefined = undefined, excludeWorkDir = true) {
        const args = ['list', '-f', '{{.Dir}}', '-e', 'all'];
        let result: string;
        try {
            result = this.execGo(args, workDir);
        } catch (err) {
            if ('go: warning: "all" matched no packages' === err) {
                return [];
            } else {
                throw err;
            }
        }
        const out = result;
        const dir = out.split('\n').filter(dir => dir.length > 0);
        if (workDir && excludeWorkDir) {
            return dir.filter(dir => !dir.startsWith(workDir));
        }
        return dir;
    }

    public getEnv(workDir: WorkDir = undefined) {
        const cmd = ['env', '-json'];
        const result = this.execGo(cmd, workDir);
        const out = result;
        const rawJson = JSON.parse(out);
        return rawJson;
    }

    public getModules(moduleName: string | undefined = undefined, workDir: string) {
        const delim = '=>';
        const replaced = 'replaced';
        const args = ['list', '-f', '{{.Path}}' + delim + '{{.Dir}}' + delim + '{{if not (eq .Replace nil)}}' + replaced + '{{end}}', '-m', '-e'];
        if (moduleName) {
            args.push(moduleName);
        }
        const result = this.execGo(args, workDir);
        const modules = result.split('\n').filter(line => line.length > 0).map(pair => {
            const parts = pair.split(delim);
            const path = parts[0];
            const dir = parts[1];
            const replaced = parts[2];
            return { dir: normalizeWinPath(dir), path: path, replaced: replaced === "replaced" };
        }).filter(module => module.dir.length > 0);
        return modules;
    }

    private execGo(args: string[], workDir: WorkDir = undefined) {
        return this.exec(this.goPath, args, workDir);
    }

    private exec(command: string, args: string[], workDir: WorkDir) {
        try {
            const stdout = cp.execFileSync(command, args, { cwd: workDir, encoding: 'utf8' });
            return stdout;
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
