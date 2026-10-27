import cp from 'child_process';
import fs from 'fs';
import { URL } from 'url';
import { normalizeWinPath } from './pathTree';

const execFile = promisifyExecFile();

function promisifyExecFile() {
    return (command: string, args: string[], options: cp.ExecFileOptionsWithStringEncoding) =>
        new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            cp.execFile(command, args, { ...options, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    (err as cp.ExecFileException & { stdout?: string; stderr?: string }).stdout = stdout;
                    (err as cp.ExecFileException & { stdout?: string; stderr?: string }).stderr = stderr;
                    reject(err);
                } else {
                    resolve({ stdout: stdout as string, stderr: (stderr as string) ?? '' });
                }
            });
        });
}

export type WorkDir = string | URL | undefined;

export interface GoModule {
    path: string;
    dir: string;
    replaced: boolean;
}

export class GoExec {
    private readonly _goPath: string;
    private _envCache: Record<string, string> | undefined;
    public get goPath(): string {
        return this._goPath;
    }

    constructor(goPath: string) {
        this._goPath = goPath;
    }

    public async listAllPackageDirs(fileDirs: string[]) {
        return (await Promise.all(fileDirs.map(fd => this.listPackageDirs(fd, true)))).flatMap(s => s);
    }

    public async listPackageDirs(workDir: string | undefined = undefined, excludeWorkDir = true): Promise<string[]> {
        const args = ['list', '-f', '{{.Dir}}', '-e', 'all'];
        const result = await this.execGo(args, workDir, false);
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

    public async getEnv(workDir: WorkDir = undefined): Promise<Record<string, string>> {
        if (workDir === undefined) {
            if (!this._envCache) {
                this._envCache = await this.goEnv(workDir);
            }
            return this._envCache;
        }
        return await this.goEnv(workDir);
    }

    private async goEnv(workDir: WorkDir = undefined): Promise<Record<string, string>> {
        const cmd = ['env', '-json'];
        const result = await this.execGo(cmd, workDir);
        try {
            return JSON.parse(result.stdout);
        } catch (err) {
            throw new Error(`failed to parse output of 'go ${cmd.join(' ')}': ${(err as Error).message}`);
        }
    }

    public async getModules(moduleName: string | undefined = undefined, workDir: string): Promise<GoModule[]> {
        const delim = '=>';
        const replaced = 'replaced';
        const args = ['list', '-f', '{{.Path}}' + delim + '{{.Dir}}' + delim + '{{if not (eq .Replace nil)}}' + replaced + '{{end}}', '-m', '-e'];
        if (moduleName) {
            args.push(moduleName);
        }
        const result = await this.execGo(args, workDir);
        return result.stdout.split('\n').filter(line => line.length > 0).map(line => {
            const parts = line.split(delim);
            const path = parts[0];
            const dir = parts.length > 1 ? parts[1] : '';
            return {
                path: path,
                dir: dir ? normalizeWinPath(dir) : '',
                replaced: parts[2] === replaced,
            };
        }).filter(module => module.dir.length > 0);
    }

    private execGo(args: string[], workDir: WorkDir = undefined, throwStdErr = true) {
        return this.exec(this.goPath, args, workDir, throwStdErr);
    }

    private async exec(command: string, args: string[], workDir: WorkDir, throwStdErr = true): Promise<{ stdout: string; stderr?: string }> {
        if (workDir && !fs.existsSync(workDir)) {
            throw new Error(`The working directory does not exist: ${workDir}`);
        }
        const cwd = typeof workDir === 'string' ? workDir : undefined;
        try {
            const { stdout, stderr } = await execFile(command, args, { cwd, encoding: 'utf8' });
            return this.handleExecResult(stdout, stderr, [command, ...args], throwStdErr);
        } catch (err) {
            const execErr = err as cp.ExecFileException & { stdout?: string; stderr?: string };
            return this.handleExecResult(execErr.stdout ?? '', execErr.stderr ?? '', [command, ...args], throwStdErr);
        }
    }

    private handleExecResult(stdout: string, stderr: string | undefined, fullArgs: string[], throwStdErr: boolean) {
        const errOut = (stderr ?? '').trim();
        const out = stdout.trim();
        if (throwStdErr && errOut.length > 0) {
            throw this.newError(fullArgs, errOut);
        }
        return !throwStdErr && errOut.length > 0 ? { stdout: out, stderr: errOut } : { stdout: out };
    }

    private newError(args: string[], err: string) {
        return new Error("failed to run 'go " + args.join(' ') + "': " + err);
    }
}
