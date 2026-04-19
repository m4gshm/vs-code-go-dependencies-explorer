import cp from 'child_process';
import fs from 'fs';
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
        const result = this.execGo(args, workDir, false);
        const stderr = result.stderr;
        if (stderr && 'go: warning: "all" matched no packages' === stderr) {
            return [];
        } else if (stderr && stderr.length > 0) {
            throw this.newError(args, stderr);
        }
        const out = result.stdout;
        const dir = out.split('\n').filter(dir => dir.length > 0);
        if (workDir && excludeWorkDir) {
            return dir.filter(dir => !dir.startsWith(workDir));
        }
        return dir;
    }

    public getEnv(workDir: WorkDir = undefined) {
        const cmd = ['env', '-json'];
        const result = this.execGo(cmd, workDir);
        const rawJson = JSON.parse(result.stdout);
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
        const modules = result.stdout.split('\n').filter(line => line.length > 0).map(pair => {
            const parts = pair.split(delim);
            const path = parts[0];
            const dir = parts[1];
            const replaced = parts[2];
            return { dir: normalizeWinPath(dir), path: path, replaced: replaced === "replaced" };
        }).filter(module => module.dir.length > 0);
        return modules;
    }

    private execGo(args: string[], workDir: WorkDir = undefined, throwStdErr = true) {
        return this.exec(this.goPath, args, workDir, throwStdErr);
    }

    private exec(command: string, args: string[], workDir: WorkDir, throwStdErr = true) {
        if (workDir && !fs.existsSync(workDir)) {
            throw new Error(`The working directory does not exist: ${workDir}`);
        }
        const result = cp.spawnSync(command, args, { cwd: workDir, encoding: 'utf8' });
        const err = result.error;
        if (err) {
            throw err;
        }
        const stderr = result.stderr?.trim();
        const stdout = result.stdout.trim();
        if (throwStdErr && stderr.length > 0) {
            throw this.newError([command, ...args], result.stderr);
        } else {
            return !throwStdErr && stderr.length > 0 ? { stdout, stderr } : { stdout };
        }
    }

    private newError(args: string[], err: string) {
        return new Error("failed to run 'go " + args.join(' ') + "': " + err);
    }
}
