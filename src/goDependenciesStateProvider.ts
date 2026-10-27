import { PathElement, flat } from "./pathTree";
import { GoPackageProvider } from "./goPackageProvider";
import { parse } from 'path';

export class GoDependenciesStateProvider {
    private _stdLibRootDir!: PathElement;
    private _stdLibDirs: Map<string, PathElement> = new Map();
    private _modulesRootDir!: PathElement | undefined;
    private _moduleDirs: Map<string, PathElement> = new Map();
    private _replacedRootDir!: PathElement | undefined;
    private _replacedDirs: Map<string, PathElement> = new Map();
    private _moduleVersions: Map<string, string> = new Map();
    private _moduleUpdates: Map<string, string> = new Map();

    static async new(packageProvider: GoPackageProvider) {
        const p = new GoDependenciesStateProvider(packageProvider);
        await p.refresh();
        return p;
    }

    private constructor(private readonly packageProvider: GoPackageProvider) { }

    get rootDirs() {
        return [this._stdLibRootDir, this._modulesRootDir, this._replacedRootDir].filter(d => d !== undefined);
    }

    get dirs(): PathElement[] {
        return [...this._stdLibDirs.values(), ...this._moduleDirs.values(), ...this._replacedDirs.values()];
    }

    findDir(path: string) {
        return this._stdLibDirs.get(path) || this._moduleDirs.get(path) || this._replacedDirs.get(path);
    }

    versionOf(path: string) {
        const own = this._moduleVersions.get(path);
        if (own) {
            return own;
        }
        const parent = parse(path).dir;
        return parent ? this._moduleVersions.get(parent) : undefined;
    }

    updateOf(path: string) {
        const own = this._moduleUpdates.get(path);
        if (own) {
            return own;
        }
        const parent = parse(path).dir;
        return parent ? this._moduleUpdates.get(parent) : undefined;
    }

    async refresh(calcChanges: boolean = false, useCache: boolean = true): Promise<RemovedAddedDirs | undefined> {
        const [std, modules] = await this.packageProvider.getPackages(useCache);
        this._moduleVersions = modules.versions;
        this._moduleUpdates = modules.updates;

        const oldStdLibDirs = this.swapTree(this._stdLibDirs, dirs => this._stdLibDirs = dirs,
            std.root.with({ name: 'Standard Library' }), root => this._stdLibRootDir = root);

        const oldModuleDirs = this.swapTree(this._moduleDirs, dirs => this._moduleDirs = dirs,
            modules.root?.with({ name: 'External Packages' }), root => this._modulesRootDir = root);

        const rootReplaced = modules.rootReplaced;
        const replacedRootDir = rootReplaced
            ? rootReplaced.with({ name: '...' + parse(rootReplaced.name).name })
            : undefined;
        const oldReplacedDirs = this.swapTree(this._replacedDirs, dirs => this._replacedDirs = dirs,
            replacedRootDir, root => this._replacedRootDir = root);

        if (!calcChanges) {
            return undefined;
        }
        return {
            removedStdDirs: getRemoved(oldStdLibDirs, this._stdLibDirs),
            addedStdDirs: getAdded(oldStdLibDirs, this._stdLibDirs),
            removedModuleDirs: getRemoved(oldModuleDirs, this._moduleDirs),
            addedModuleDir: getAdded(oldModuleDirs, this._moduleDirs),
            removedReplaced: getRemoved(oldReplacedDirs, this._replacedDirs),
            addedReplaced: getAdded(oldReplacedDirs, this._replacedDirs),
        };
    }

    private swapTree<R extends PathElement | undefined>(
        oldDirs: Map<string, PathElement>,
        setDirs: (dirs: Map<string, PathElement>) => void,
        root: R,
        setRoot: (root: R) => void,
    ) {
        setRoot(root);
        setDirs(flat(root ? [root] : []));
        return oldDirs;
    }
}

export interface RemovedAddedDirs {
    removedStdDirs: PathElement[];
    addedStdDirs: PathElement[];
    removedModuleDirs: PathElement[];
    addedModuleDir: PathElement[];
    removedReplaced: PathElement[];
    addedReplaced: PathElement[];
}

function getRemoved<T>(oldDirs: Map<string, T>, newDirs: Map<string, T>) {
    return getNotContained({ what: oldDirs, where: newDirs });
}

function getAdded<T>(oldDirs: Map<string, T>, newDirs: Map<string, T>) {
    return getNotContained({ what: newDirs, where: oldDirs });
}

function getNotContained<T>(maps: { what: Map<string, T>; where: Map<string, T> }) {
    return Array.from(maps.what).filter(([k, _]) => {
        return !maps.where.has(k);
    }).map(([_, v]) => v);
}

