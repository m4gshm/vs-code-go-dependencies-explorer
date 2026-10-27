import * as fs from 'fs';
import { parse, join } from 'path';
import { EventEmitter, workspace, Disposable } from 'vscode';
import { GoExec } from './goExec';
import { getModulesPath, getStdLibPath, getGoPackagePaths } from './goDirs';
import { PathElement, PathTreeBuilder, normalizeWinPath } from './pathTree';

export const GO_MOD_PATTERN = '**/go.mod';

export class GoPackageProvider implements Disposable {
    constructor(private readonly goExec: GoExec) { }

    private readonly _onRequestPackages = new EventEmitter<[GoStdLibTree, GoModuleTree]>();
    readonly onRequestPackages = this._onRequestPackages.event;

    async getPackagePaths() {
        return await getGoPackagePaths(this.goExec);
    }

    async getPackages() {
        const dirs = await getGoPackages(this.goExec);
        this._onRequestPackages.fire(dirs);
        return dirs;
    }

    dispose(): void {
        this._onRequestPackages.dispose();
    }
}

export interface GoStdLibTree {
    root: PathElement;
}

export interface GoModuleTree {
    root: PathElement | undefined;
    rootReplaced: PathElement | undefined;
}

async function getGoPackages(goExec: GoExec): Promise<[GoStdLibTree, GoModuleTree]> {
    const getPackageDirs = async (dir: string) => Array.from(new Set(await listGoPackageDirs(dir)));

    const getGoStdLibDirs = async () => {
        const env = await goExec.getEnv();
        const stdLibPath = getStdLibPath(env);

        console.debug(`retrieving Go package for standard library ${stdLibPath}`);

        const stdGoPackageDirs = await getPackageDirs(stdLibPath);
        const root = PathTreeBuilder.create(stdGoPackageDirs, stdLibPath)!!.toDirectory();
        return { root };
    };

    const getGoModuleDirs = async () => {
        const extPackagesDir = getModulesPath(await goExec.getEnv());

        const rootDirs = (await workspace.findFiles(GO_MOD_PATTERN, extPackagesDir)).map(f => parse(f.fsPath).dir).map(dir => normalizeWinPath(dir));
        console.debug(`retrieving Go module directories ${rootDirs}`);

        const workDirModules = (await Promise.all(rootDirs.map(async rootDir => {
            try {
                const modules = await goExec.getModules("all", rootDir);
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
        for (const wdm of workDirModules) {
            const err = wdm.error;
            if (err) {
                const message = err instanceof Error ? err.message : `${err}`;
                const errMessage = `Module error: '${wdm.baseDir}', ${message}`;
                console.info(errMessage);
            } else {
                for (const module of wdm.modules) {
                    if (module.replaced) {
                        replacedDirsSet.add(module.dir);
                    } else {
                        moduleDirsSet.add(module.dir);
                    }
                }
            }
        }

        const modulePath = Array.from(moduleDirsSet);
        console.debug(`retrieving Go package dirs for module dirs ${modulePath}`);
        const modulePackageDirs = (await Promise.all(modulePath.map(d => getPackageDirs(d)))).flatMap(dd => dd);

        const replacedDirs = Array.from(replacedDirsSet);
        console.debug(`retrieving Go replaced package dirs for module dirs ${replacedDirs}`);
        const replacedPackageDirs = (await Promise.all(replacedDirs.map(d => getPackageDirs(d)))).flatMap(dd => dd);

        const root = PathTreeBuilder.create(modulePackageDirs, extPackagesDir)?.toDirectory();
        const rootReplaced = PathTreeBuilder.create(replacedPackageDirs)?.toDirectory();
        return { root, rootReplaced };
    };

    return [await getGoStdLibDirs(), await getGoModuleDirs()];
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


