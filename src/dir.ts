import { sep, parse, join } from 'path';

export class Directory {
    public get isGoPackage(): boolean {
        const goPath = this.goPath;
        return goPath ? goPath.length > 0 : false;
    }
    constructor(
        // public readonly root: boolean,
        public readonly name: string,
        public readonly parent: string | undefined,
        public readonly goPath: string | undefined,
        public readonly subdirs: Directory[]
    ) {
    }

    public static create(dirPaths: string[]) {
        const roots = new Map<string, DirHierarchyBuilder>();
        for (let dirPath of dirPaths) {
            let root = DirHierarchyBuilder.newHierarchyBuilder(dirPath);
            if (root) {
                let existsRoot = roots.get(root.name);
                if (existsRoot) {
                    existsRoot.merge(root);
                } else {
                    roots.set(root.name, root);
                }
            }
        }

        const collapsedRoots = collapse(roots);
        return Array.from(collapsedRoots.values()).map(d => d.toDirectory());
    }

}

export function flat(parent: Directory | undefined, dirs: Directory[]) {
    return new Map(dirs.flatMap(dir => {
        const path = concat(dir.parent, dir.name);
        const flatSubdirs: [string, Directory][] = Array.from(flat(dir, dir.subdirs).entries())/*.map(pair => {
            const subdirPath = pair[0];
            return [concat(dir.parent, subdirPath), pair[1]];
        })*/;
        const pairs: [string, Directory][] = [[path, dir], ...flatSubdirs];
        return pairs;
    }));

    function concat(parent: string | undefined, subdir: string): string {
        if (!parent) {
            return subdir;
        } else {
            return parent.endsWith(sep) ? parent + subdir : parent + sep + subdir;
        }
    }
}

const isWin = process.platform === "win32";

class DirHierarchyBuilder {

    static newHierarchyBuilder(dirPath: string) {
        if (isWin) {
            let path = parse(dirPath);
            const lcRoot = path.root.toLowerCase();
            if (lcRoot !== path.root) {
                dirPath = lcRoot + dirPath.substring(lcRoot.length, dirPath.length);
            }
        }
        let first: DirHierarchyBuilder | undefined;
        let parentDir = dirPath;
        for (; ;) {
            let path = parse(parentDir);
            let name = path.name + path.ext;
            if (name.length === 0) {
                break;
            }
            if (!first) {
                first = new DirHierarchyBuilder(true, name, path.dir, dirPath, new Map());
            } else {
                let newRoot = new DirHierarchyBuilder(true, name, path.dir, undefined, new Map());
                newRoot.subdirs.set(first.name!!, first);
                first.root = false;
                first = newRoot;
            }
            parentDir = path.dir;
        }

        if (first && first.name?.length && first.name?.length > 0) {
            let root = new DirHierarchyBuilder(true, first.parentPath || "", undefined, undefined, new Map());
            first.root = false;
            root.subdirs.set(first.name, first);
            return root;
        } else {
            return first;
        }
    }

    public get isGoPackage(): boolean {
        const goPath = this.goPath;
        return goPath ? goPath.length > 0 : false;
    }

    constructor(
        public root: boolean,
        public name: string,
        public parentPath: string | undefined,
        public goPath: string | undefined,
        public subdirs: Map<string, DirHierarchyBuilder>
    ) {
    }

    merge(other: DirHierarchyBuilder) {
        other.subdirs.forEach((otherSubdir, name) => {
            let subdir = this.subdirs.get(name);
            if (!subdir) {
                this.subdirs.set(name, otherSubdir);
            } else {
                subdir.merge(otherSubdir);
            }
        });
    }

    public toDirectory(): Directory {
        return new Directory(this.name!!, this.parentPath, this.goPath, Array.from(this.subdirs.values()).map(d => d.toDirectory()));
    }
}

function collapse(roots: Map<string, DirHierarchyBuilder>) {
    return new Map(Array.from(roots.entries()).map((pair: [string, DirHierarchyBuilder]) => {
        const [fullPath, dir] = pair;
        return collpase(fullPath, dir);
    }));
}

function collpase(name: string, dir: DirHierarchyBuilder): [string, DirHierarchyBuilder] {
    const subdirs = dir.subdirs;
    const collapsedSubdirs = collapse(subdirs);

    const isGoPackage = dir.isGoPackage;
    const single = collapsedSubdirs.size === 1;
    if (!isGoPackage && single) {
        const [subdirName, subdir] = collapsedSubdirs.entries().next().value!!;
        const collapsedSubdirName = dir.name ? join(dir.name, subdirName) : subdirName;
        subdir.name = collapsedSubdirName;
        subdir.parentPath = dir.parentPath;
        subdir.root = dir.root;
        return [collapsedSubdirName, subdir];
    }

    dir.subdirs = collapsedSubdirs;
    return [name, dir];
}

