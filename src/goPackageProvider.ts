import * as fs from 'fs';
import { parse, join } from 'path';
import { EventEmitter, workspace, Disposable } from 'vscode';
import { GoExec } from './goExec';
import { getModulesPath, getStdLibPath, getGoPackagePaths } from './goDirs';
import { PathElement, PathTreeBuilder, normalizeWinPath } from './pathTree';

export const GO_MOD_PATTERN = '**/go.mod';
export const GO_SUM_PATTERN = '**/go.sum';

export class GoPackageProvider implements Disposable {
    constructor(private readonly goExec: GoExec) { }

    private readonly _onRequestPackages = new EventEmitter<[GoStdLibTree, GoModuleTree]>();
    readonly onRequestPackages = this._onRequestPackages.event;

    getPackagePaths() {
        return getGoPackagePaths(this.goExec);
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
    root: PathElement;
    rootReplaced: PathElement | undefined;
}

async function getGoPackages(goExec: GoExec): Promise<[GoStdLibTree, GoModuleTree]> {
    const getPackageDirs = (dir: string) => Array.from(new Set(listGoPackageDirs(dir)));

    const getGoStdLibDirs = () => {
        const env = goExec.getEnv();
        const stdLibPath = getStdLibPath(env);

        console.debug(`retrieving Go package for standard library ${stdLibPath}`);

        const stdGoPackageDirs = getPackageDirs(stdLibPath);
        const root = PathTreeBuilder.create(stdGoPackageDirs, stdLibPath)!!.toDirectory();
        return { root };
    };

    const getGoModuleDirs = async () => {
        const extPackagesDir = getModulesPath(goExec.getEnv());

        const rootDirs = (await workspace.findFiles(GO_MOD_PATTERN)).map(f => parse(f.fsPath).dir).map(dir => normalizeWinPath(dir));
        console.debug(`retrieving Go module directories ${rootDirs}`);

        const workDirModules = Array.from(new Set(rootDirs.map(rootDir => {
            try {
                const modules = goExec.getModules("all", rootDir);
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
        }).flatMap(d => d)));

        const moduleDirsSet = new Set<string>();
        const replacedDirsSet = new Set<string>();
        for (const wdm of workDirModules) {
            const err = wdm.error;
            if (err) {
                const moduelDir = wdm.baseDir;
                const message = err instanceof Error ? err.message : `${err}`;
                const errMessage = `Module error: '${moduelDir}', ${message}`;
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
        const modulePackageDirs = modulePath.map(d => getPackageDirs(d)).flatMap(dd => dd);

        const replacedDirs = Array.from(replacedDirsSet);
        console.debug(`retrieving Go replaced package dirs for module dirs ${replacedDirs}`);
        const replacedPackageDirs = replacedDirs.map(d => getPackageDirs(d)).flatMap(dd => dd);

        const root = PathTreeBuilder.create(modulePackageDirs, extPackagesDir)!!.toDirectory();
        const rootReplaced = PathTreeBuilder.create(replacedPackageDirs)?.toDirectory();
        return { root, rootReplaced };
    };

    return [getGoStdLibDirs(), await getGoModuleDirs()];
}


function listGoPackageDirs(dirPath: string): string[] {
    const dir = fs.opendirSync(dirPath);
    try {
        const path = dir.path;
        let isGoPackage = false;
        let subPackages: string[] = [];
        for (; ;) {
            let sub: fs.Dirent | null;
            try {
                sub = dir.readSync();
            } catch (err) {
                console.error("dir.readSync error:", err);
                continue;
            }
            if (sub === null) {
                break;
            }
            const isGoFile = sub.isFile() && sub.name.endsWith('.go');
            isGoPackage = isGoPackage || isGoFile;
            if (sub.isDirectory()) {
                subPackages.push(...(listGoPackageDirs(join(sub.parentPath, sub.name))));
            }
        }
        const result = isGoPackage ? [path] : [];
        return subPackages ? [...result, ...subPackages] : result;
    } finally {
        dir.closeSync();
    }
}


