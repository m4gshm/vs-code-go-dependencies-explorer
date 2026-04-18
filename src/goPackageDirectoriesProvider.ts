import * as fs from 'fs';
import { Directory, DirectoryHierarchyBuilder, flat, normalizeWinPath } from './directory';
import { parse, join } from 'path';
import { GoExec } from './goExec';
import { EventEmitter, workspace, Disposable } from 'vscode';
import { getModulesDir, getStdLibDir, getGoDepDirs } from './goDirs';
import { ROOT_MODULES, ROOT_STD_LIB } from './goDependenciesFsCommon';

export const GO_MOD_PATTERN = '**/go.mod';
export const GO_SUM_PATTERN = '**/go.sum';

export class GoPackageDirectoriesProvider implements Disposable {
    constructor(private readonly goExec: GoExec) { }

    private readonly _onRequestPackages = new EventEmitter<[GoStdLibDirs, GoPackageDirs]>();
    readonly onRequestPackages = this._onRequestPackages.event;

    public getDependencyDirs() {
        return getGoDepDirs(this.goExec);
    }

    async getGoPackages() {
        const dirs = await getGoPackageDirs(this.goExec);
        this._onRequestPackages.fire(dirs);
        return dirs;
    }

    public dispose(): void {
        this._onRequestPackages.dispose();
    }
}

export interface GoStdLibDirs {
    root: Directory;
    flatDirs: Map<string, Directory>;
}

export interface GoPackageDirs {
    root: Directory;
    flatDirs: Map<string, Directory>;
    rootReplaced: Directory | undefined;
    flatReplaced: Map<string, Directory>;
}

async function getGoPackageDirs(goExec: GoExec): Promise<[GoStdLibDirs, GoPackageDirs]> {
    const getPackageDirs = (dir: string) => Array.from(new Set(listGoPackageDirs(dir)));

    const getGoStdLib = () => {
        const env = goExec.getEnv();
        const stdLibDir = getStdLibDir(env);

        console.debug(`retrieving Go package for standard library ${stdLibDir}`);

        const stdGoPackageDirs = getPackageDirs(stdLibDir);
        const label = 'Standard library';
        const root = DirectoryHierarchyBuilder.create(stdGoPackageDirs, stdLibDir, ROOT_STD_LIB, label)!!.toDirectory();
        const flatDirs = flat([root]);

        return { root: root, flatDirs: flatDirs };
    };

    const getGoModulesPackageDirs = async () => {
        const extPackagesDir = getModulesDir(goExec.getEnv());

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

        const moduleDirs = Array.from(moduleDirsSet);
        console.debug(`retrieving Go package dirs for module dirs ${moduleDirs}`);
        const modulePackageDirs = moduleDirs.map(d => getPackageDirs(d)).flatMap(dd => dd);

        const replacedDirs = Array.from(replacedDirsSet);
        console.debug(`retrieving Go replaced package dirs for module dirs ${replacedDirs}`);
        const replacedPackageDirs = replacedDirs.map(d => getPackageDirs(d)).flatMap(dd => dd);

        const root = DirectoryHierarchyBuilder.create(modulePackageDirs, extPackagesDir, ROOT_MODULES, 'External packages')!!.toDirectory();
        const rootReplaced = DirectoryHierarchyBuilder.create(replacedPackageDirs, undefined, undefined, undefined, true)?.toDirectory();
        const flatDirs = flat([root]);
        const flatDirsReplaced = rootReplaced ? flat([rootReplaced]) : new Map<string, Directory>();

        return { root: root, flatDirs: flatDirs, rootReplaced: rootReplaced, flatReplaced: flatDirsReplaced };
    };

    return [getGoStdLib(), await getGoModulesPackageDirs()];
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


