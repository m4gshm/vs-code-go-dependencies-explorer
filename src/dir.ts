import { sep, parse, join } from 'path';

export class Directory {
    constructor(
        public readonly root: boolean,
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

    public flatDirs(): Map<string, Directory> {
        let result = this.subdirs.flatMap(subdir => {
            let parent = (this.name !== sep ? this.name : "");
            let path = concat(parent, subdir.name);
            let flatSubdirs: [string, Directory][] = Array.from(subdir.flatDirs().entries()).map(pair => {
                let subdirPath = pair[0];
                return [concat(parent, subdirPath), pair[1]];
            });
            let pairs: [string, Directory][] = [[path, subdir], ...flatSubdirs];
            return pairs;
        });
        if (this.root) {
            let rootPair: [string, Directory] = [this.name, this as Directory];
            result.push(rootPair);
        }
        return new Map(result);

        function concat(parent: string, subdir: string): string {
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
        return new Directory(this.root, this.name!!, this.parentPath, this.goPath, Array.from(this.subdirs.values()).map(d => d.toDirectory()));
    }
}

function collapse(roots: Map<string, DirHierarchyBuilder>) {
    return new Map(Array.from(roots.entries()).map((e: [string, DirHierarchyBuilder]) => {
        const [fullPath, dir] = e;
        return collpase(fullPath, dir);
    }));
}

function collpase(name: string, dir: DirHierarchyBuilder): [string, DirHierarchyBuilder] {
    const subdirs = dir.subdirs;
    const collapsedSubdirs = collapse(subdirs);

    const single = collapsedSubdirs.size === 1;
    if (single) {
        const [subdirName, subdir] = collapsedSubdirs.entries().next().value!!;
        const collapsedSubdirName = dir.name ? join(dir.name, subdirName) : subdirName;
        subdir.name = collapsedSubdirName;
        return [collapsedSubdirName, subdir];
    }

    dir.subdirs = collapsedSubdirs;
    return [name, dir];
}

