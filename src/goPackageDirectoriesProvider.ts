import * as fs from 'fs';
import { Directory, DirectoryHierarchyBuilder, flat, normalizeWinPath } from './directory';
import path, { parse, join } from 'path';
import { GoExec } from './go';
import { promisify } from 'util';
import { EventEmitter, workspace, Disposable } from 'vscode';
import { ROOT_STD_LIB, ROOT_EXT_PACK } from './goDependencyFSCommon';

export const GO_MOD_PATTERN = '**/go.mod';
export const GO_SUM_PATTERN = '**/go.sum';


export class GoPackageDirectoriesProvider implements Disposable {
    constructor(
        private readonly goExec: GoExec,
        private readonly stdLibDir: string,
        private readonly extPackagesDir: string
    ) {

    }

    private readonly _onRequestPackages = new EventEmitter<GoPackageDirs>();
    readonly onRequestPackages = this._onRequestPackages.event;

    public dispose(): void {
        this._onRequestPackages.dispose();
    }

    async getGoStdLib(): Promise<GoStdLibDirs> {
        return await getGoStdLibPackageDirs(this.stdLibDir);
    }

    async getGoPackages(): Promise<GoPackageDirs> {
        const packages = await getGoModulesPackageDirs(this.extPackagesDir, this.goExec);
        this._onRequestPackages.fire(packages);
        return packages;
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

async function getGoStdLibPackageDirs(stdLibDir: string): Promise<GoStdLibDirs> {
    console.debug(`retrieving Go package for standard library ${stdLibDir}`);

    const stdGoPackageDirs = await getPackageDirs(stdLibDir);
    const label = 'Standard library';
    const root = DirectoryHierarchyBuilder.create(stdGoPackageDirs, stdLibDir, ROOT_STD_LIB, label)!!.toDirectory();
    const flatDirs = flat([root]);

    return { root: root, flatDirs: flatDirs };
}

async function getGoModulesPackageDirs(extPackagesDir: string, goExec: GoExec): Promise<GoPackageDirs> {
    const rootDirs = await getGoModuleDirs();
    console.debug(`retrieving Go module directories ${rootDirs}`);

    const workDirModules = Array.from(new Set((await Promise.all(rootDirs.map(async rootDir => {
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
    }))).flatMap(d => d)));

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
    const modulePackageDirs = (await Promise.all(moduleDirs.map(async d => await getPackageDirs(d)))).flatMap(dd => dd);

    const replacedDirs = Array.from(replacedDirsSet);
    console.debug(`retrieving Go replaced package dirs for module dirs ${replacedDirs}`);
    const replacedPackageDirs = (await Promise.all(replacedDirs.map(async d => await getPackageDirs(d)))).flatMap(dd => dd);

    const root = DirectoryHierarchyBuilder.create(modulePackageDirs, extPackagesDir, ROOT_EXT_PACK, 'External packages')!!.toDirectory();
    const rootReplaced = DirectoryHierarchyBuilder.create(replacedPackageDirs, undefined, undefined, undefined, true)?.toDirectory();
    const flatDirs = flat([root]);
    const flatDirsReplaced = rootReplaced ? flat([rootReplaced]) : new Map<string, Directory>();

    return { root: root, flatDirs: flatDirs, rootReplaced: rootReplaced, flatReplaced: flatDirsReplaced };
}

async function getGoModuleDirs() {
    return (await workspace.findFiles(GO_MOD_PATTERN)).map(f => parse(f.fsPath).dir).map(dir => normalizeWinPath(dir));
}

async function getPackageDirs(dir: string) {
    return Array.from(new Set(await listGoPackageDirs(dir)));
}

async function listGoPackageDirs(dirPath: string): Promise<string[]> {
    const opendir = promisify(fs.opendir);
    const dir = await opendir(dirPath);
    const path = dir.path;
    let isGoPackage = false;
    let subPackages: string[] = [];
    for await (let sub of dir) {
        isGoPackage = isGoPackage || isGoFile(sub);
        if (sub.isDirectory()) {
            subPackages.push(...(await listGoPackageDirs(join(sub.parentPath, sub.name))));
        }
    }
    const result = isGoPackage ? [path] : [];
    return subPackages ? [...result, ...subPackages] : result;

    function isGoFile(d: fs.Dirent) {
        return d.isFile() && d.name.endsWith('.go');
    }
}

function groupByRoot(replacedPackageDirs: string[]) {
    const grouped = group(replacedPackageDirs);
    const subGrouped: [string, string[]][] = Array.from(Array.from(grouped.entries()).map(([root, subDirs]) => {
        const grouped = groupByRoot(subDirs);
        const join = grouped.size === 1;
        if (join) {
            const [rootPart, subs] = grouped.entries().next().value!!;
            const newRoot = path.join(root, rootPart);
            return [newRoot, subs];
        } else {
            return [root, subDirs];
        }
    }));
    return new Map(subGrouped);

    function group(dirs: string[]): Map<string, string[]> {
        return new Map(Array.from(Map.groupBy(dirs.map(d => {
            const parts = d.split(path.sep);
            const root = parts[0];
            const dir = parts.length > 1 ? parts.slice(1, parts.length).join(path.sep) : undefined;
            return { root: root, dir: dir };
        }), p => {
            return p.root;
        }).entries()).map(([k, v]) => {
            return [k, Array.from(v.map(c => c.dir).filter(c => c !== undefined))];
        }));
    }
}
