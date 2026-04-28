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

    static async new(packageProvider: GoPackageProvider) {
        const p = new GoDependenciesStateProvider(packageProvider);
        await p.refresh();
        return p;
    }

    private constructor(private readonly packageProvider: GoPackageProvider) { }

    get rootDirs() {
        return [this._stdLibRootDir, this._modulesRootDir, this._replacedRootDir].filter(d => d !== undefined);
    }

    findDir(path: string) {
        return this._stdLibDirs.get(path) || this._moduleDirs.get(path) || this._replacedDirs.get(path);
    }

    async refresh(calcChanges: boolean = false) {
        const convertToGoDirs = (flatDirs: Map<string, PathElement>) => flatDirs/* new Map(Array.from(flatDirs.entries())
            .map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]))*/;

        const [std, modules] = await this.packageProvider.getPackages();

        const newStdLibRootDir = std.root.with({ name: 'Standard Library' });;

        this._stdLibRootDir = newStdLibRootDir;
        const oldStdLibDirs = this._stdLibDirs;

        const newStdLibDirs = convertToGoDirs(flat([newStdLibRootDir]));
        this._stdLibDirs = newStdLibDirs;

        const root = modules.root;
        const newModulesRootDir = root?.with({ name: 'External Packages' }); //? newGoDirItem(root, 'External Packages') : undefined;

        this._modulesRootDir = newModulesRootDir;

        const oldModuleDirs = this._moduleDirs;
        const newModuleDirs = convertToGoDirs(flat(newModulesRootDir ? [newModulesRootDir] : []));

        this._moduleDirs = newModuleDirs;

        let newReplacedRootDir: PathElement | undefined = undefined;
        const rootReplaced = modules.rootReplaced;
        if (rootReplaced) {
            const rootReplacedName = rootReplaced.name;
            const rootReplacedLabel = "..." + parse(rootReplacedName).name;
            newReplacedRootDir = rootReplaced?.with({ name: rootReplacedLabel });// ? newGoDirItem(rootReplaced, rootReplacedLabel) : undefined;
        }
        this._replacedRootDir = newReplacedRootDir;

        const oldReplaced = this._replacedDirs;
        const newReplaced = convertToGoDirs(newReplacedRootDir ? flat([newReplacedRootDir]) : new Map<string, PathElement>());
        this._replacedDirs = newReplaced;

        if (calcChanges) {
            const removedStdDirs = getRemoved(oldStdLibDirs, newStdLibDirs);
            const addedStdDirs = getAdded(oldStdLibDirs, newStdLibDirs);
            const removedModuleDirs = getRemoved(oldModuleDirs, newModuleDirs);
            const addedModuleDir = getAdded(oldModuleDirs, newModuleDirs);

            const removedReplaced = getRemoved(oldReplaced, newReplaced);
            const addedReplaced = getAdded(oldReplaced, newReplaced);

            return {
                removedStdDirs, addedStdDirs, removedModuleDirs, addedModuleDir, removedReplaced, addedReplaced
            };
        }
    }
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

