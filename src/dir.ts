import { sep, parse, join } from 'path';

export class Directory {
    constructor(
        public readonly label: string,
        public readonly name: string,
        public readonly parent: string | undefined,
        public readonly findFiles: boolean,
        public readonly subdirs: Directory[],
    ) {
    }

    public static create(dirPaths: string[], expectedRootDir: string, expectedRootName: string) {
        let root = DirHierarchyBuilder.newHierarchyBuilder(expectedRootDir, expectedRootDir, expectedRootName);
        for (let dirPath of dirPaths) {
            let newRoot = DirHierarchyBuilder.newHierarchyBuilder(dirPath, expectedRootDir, expectedRootName);
            if (root) {
                if (newRoot && root.parentPath === newRoot.parentPath && root.name === newRoot.name) {
                    root.merge(newRoot);
                } else {
                    //log
                }
            }
        }
        const [_, collapsedRoot] = collapse(expectedRootDir, root);
        return collapsedRoot.toDirectory();
    }

}

export function flat(dirs: Directory[]) {
    return new Map(dirs.flatMap(dir => {
        const path = concat(dir.parent, dir.name);
        const flatSubdirs: [string, Directory][] = Array.from(flat(dir.subdirs).entries());
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

    static newHierarchyBuilder(dirPath: string, expectedRootDir: string, expectedRootName: string) {
        if (isWin) {
            const path = parse(dirPath);
            const lcRoot = path.root.toLowerCase();
            if (lcRoot !== path.root) {
                dirPath = lcRoot + dirPath.substring(lcRoot.length, dirPath.length);
            }
        }
        let first: DirHierarchyBuilder | undefined;
        let parentDir = dirPath;
        for (; ;) {
            const isExpectedRoot = expectedRootDir === parentDir;
            const path = parse(parentDir);
            const name = path.name + path.ext;
            if (name.length === 0) {
                break;
            }
            const label = isExpectedRoot ? expectedRootName : name;
            if (!first) {
                first = new DirHierarchyBuilder(true, label, name, path.dir, new Map());
            } else {
                const newRoot = new DirHierarchyBuilder(true, label, name, path.dir, new Map());
                newRoot.subdirs.set(first.name!!, first);
                first.root = false;
                first.findFiles = true;
                first = newRoot;
            }
            if (isExpectedRoot) {
                break;
            }
            parentDir = path.dir;
        }

        if (!first) {
            first = new DirHierarchyBuilder(true, expectedRootName, expectedRootDir, undefined, new Map());
        }
        return first;
    }

    public get isGoPackage(): boolean {
        return true;
    }

    constructor(
        public root: boolean,
        public label: string,
        public name: string,
        public parentPath: string | undefined,
        public subdirs: Map<string, DirHierarchyBuilder>,
        public findFiles: boolean = false,
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
        return new Directory(this.label, this.name, this.parentPath, this.findFiles, Array.from(this.subdirs.values()).map(d => d.toDirectory()));
    }
}

function collapseAll(roots: Map<string, DirHierarchyBuilder>) {
    return new Map(Array.from(roots.entries()).map(([fullPath, dir]) => {
        return collapse(fullPath, dir);
    }));
}

function collapse(name: string, dir: DirHierarchyBuilder): [string, DirHierarchyBuilder] {
    const subdirs = dir.subdirs;
    const collapsedSubdirs = collapseAll(subdirs);

    const root = dir.root;
    const isGoPackage = dir.isGoPackage;
    const single = collapsedSubdirs.size === 1;
    if (!root && !isGoPackage && single) {
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

