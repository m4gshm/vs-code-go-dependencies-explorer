import * as fs from 'fs';
import { parse, join } from 'path';
import { workspace } from 'vscode';
import { GoExec } from './goExec';
import { getModulesPath, getStdLibPath, getGoPackagePaths } from './goDirs';
import { PathElement, PathTreeBuilder, normalizeWinPath } from './pathTree';
import { DirScanCache } from './dirScanCache';

export const GO_MOD_PATTERN = '**/go.mod';

export class GoPackageProvider {
    constructor(private readonly goExec: GoExec, private readonly scanCache: DirScanCache = new DirScanCache()) { }

    private updateDirs: Map<string, string> = new Map();
    private workspaceModuleDirs: string[] = [];
    private cacheModules: Map<string, string> = new Map();

    async getPackagePaths() {
        return await getGoPackagePaths(this.goExec);
    }

    async getPackages(useCache: boolean = true) {
        if (!useCache) {
            this.scanCache.clear();
        }
        return await this.scanPackages();
    }

    async verifyModifiedModules(): Promise<string[]> {
        const modified: string[] = [];
        for (const rootDir of this.workspaceModuleDirs) {
            try {
                modified.push(...await this.goExec.verifyModules(rootDir));
            } catch (err) {
                const message = err instanceof Error ? err.message : `${err}`;
                console.info(`module verify failed for '${rootDir}': ${message}`);
            }
        }
        return modified.filter(path => this.cacheModules.has(path));
    }

    async restoreModules(modulePaths: string[]): Promise<void> {
        const workDir = this.workspaceModuleDirs[0];
        if (!workDir) {
            throw new Error('no workspace module to restore from');
        }
        for (const modulePath of modulePaths) {
            const dir = this.cacheModules.get(modulePath);
            if (!dir) {
                continue;
            }
            await fs.promises.rm(dir, { recursive: true, force: true });
            await this.goExec.downloadModule(modulePath, workDir);
        }
    }

    async fetchModuleUpdates(goproxy: string | undefined = undefined): Promise<Map<string, string>> {
        const extPackagesDir = getModulesPath(await this.goExec.getEnv());
        const updates = new Map<string, string>();
        for (const rootDir of await findWorkspaceModuleDirs(extPackagesDir)) {
            try {
                const rootUpdates = await this.goExec.getModuleUpdates(rootDir, goproxy);
                rootUpdates.forEach((version, dir) => updates.set(dir, version));
            } catch (err) {
                const message = err instanceof Error ? err.message : `${err}`;
                console.info(`module update check failed for '${rootDir}': ${message}`);
                throw err;
            }
        }
        this.updateDirs = updates;
        return updates;
    }

    private async scanPackages(): Promise<[GoStdLibTree, GoModuleTree]> {
        const listPackageDirs = async (dir: string, cacheable: boolean) => {
            if (!cacheable) {
                return Array.from(new Set(await listGoPackageDirs(dir)));
            }
            const cached = this.scanCache.get(dir);
            if (cached) {
                return cached;
            }
            const dirs = Array.from(new Set(await listGoPackageDirs(dir)));
            this.scanCache.set(dir, dirs);
            return dirs;
        };

        const getGoStdLibDirs = async () => {
            const env = await this.goExec.getEnv();
            const stdLibPath = getStdLibPath(env);

            console.debug(`retrieving Go package for standard library ${stdLibPath}`);

            const stdGoPackageDirs = await listPackageDirs(stdLibPath, true);
            const root = PathTreeBuilder.create(stdGoPackageDirs, stdLibPath)!!.toDirectory();
            return { root };
        };

        const getGoModuleDirs = async () => {
            const extPackagesDir = getModulesPath(await this.goExec.getEnv());

            const rootDirs = await findWorkspaceModuleDirs(extPackagesDir);
            console.debug(`retrieving Go module directories ${rootDirs}`);
            this.workspaceModuleDirs = rootDirs;

            const workDirModules = (await Promise.all(rootDirs.map(async rootDir => {
                try {
                    const modules = await this.goExec.getModules("all", rootDir);
                    const noRootModules = modules.filter(module => {
                        const inRootDir = rootDirs.some(rd => {
                            return module.dir.startsWith(rd);
                        });
                        return !inRootDir;
                    });
                    return { baseDir: rootDir, modules: noRootModules, error: undefined };
                } catch (err) {
                    return { baseDir: rootDir, modules: [], error: err };
                }
            })));

            const moduleDirsSet = new Set<string>();
            const replacedDirsSet = new Set<string>();
            const cacheModules = new Map<string, string>();
            for (const wdm of workDirModules) {
                const err = wdm.error;
                if (err) {
                    const message = err instanceof Error ? err.message : `${err}`;
                    console.info(`Module error: '${wdm.baseDir}', ${message}`);
                } else {
                    for (const module of wdm.modules) {
                        if (module.replaced) {
                            replacedDirsSet.add(module.dir);
                        } else {
                            moduleDirsSet.add(module.dir);
                            if (module.dir.startsWith(extPackagesDir)) {
                                cacheModules.set(module.path, module.dir);
                            }
                        }
                    }
                }
            }
            this.cacheModules = cacheModules;

            const modulePath = Array.from(moduleDirsSet);
            console.debug(`retrieving Go package dirs for module dirs ${modulePath}`);
            const modulePackageDirs = (await Promise.all(modulePath.map(d => listPackageDirs(d, d.startsWith(extPackagesDir))))).flatMap(dd => dd);

            const replacedDirs = Array.from(replacedDirsSet);
            console.debug(`retrieving Go replaced package dirs for module dirs ${replacedDirs}`);
            const replacedPackageDirs = (await Promise.all(replacedDirs.map(d => listPackageDirs(d, d.startsWith(extPackagesDir))))).flatMap(dd => dd);

            const root = PathTreeBuilder.create(modulePackageDirs, extPackagesDir)?.toDirectory();
            const rootReplaced = PathTreeBuilder.create(replacedPackageDirs)?.toDirectory();
            return { root, rootReplaced, updates: this.updateDirs };
        };

        return [await getGoStdLibDirs(), await getGoModuleDirs()];
    }
}

export interface GoStdLibTree {
    root: PathElement;
}

export interface GoModuleTree {
    root: PathElement | undefined;
    rootReplaced: PathElement | undefined;
    updates: Map<string, string>;
}

async function findWorkspaceModuleDirs(extPackagesDir: string): Promise<string[]> {
    return (await workspace.findFiles(GO_MOD_PATTERN, extPackagesDir)).map(f => parse(f.fsPath).dir).map(dir => normalizeWinPath(dir));
}

async function listGoPackageDirs(dirPath: string): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
        console.error(`readdir error for ${dirPath}:`, err);
        return [];
    }
    let isGoPackage = false;
    let subPackages: string[] = [];
    await Promise.all(entries.map(async sub => {
        if (sub.isFile() && sub.name.endsWith('.go')) {
            isGoPackage = true;
        } else if (sub.isDirectory()) {
            subPackages.push(...(await listGoPackageDirs(join(sub.parentPath, sub.name))));
        }
    }));
    const result = isGoPackage ? [normalizeWinPath(dirPath)] : [];
    return subPackages.length > 0 ? [...result, ...subPackages] : result;
}
