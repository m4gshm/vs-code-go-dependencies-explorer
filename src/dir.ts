import { sep, parse } from 'path';

export class Directory {
    constructor(
        public readonly root: boolean,
        public readonly name: string,
        public readonly path: string | undefined,
        public readonly subdirs: Directory[]
    ) {
    }

    public static create(dirPaths: string[]) {
        let roots = new Map<string | undefined, DirHierarchyBuilder>();
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
        return Array.from(roots.values()).map(d => d.toDirectory());
    }

    public flatDirs(): Map<string, Directory> {
        let result = this.subdirs.flatMap(subdir => {
            let parent = (this.name !== sep ? this.name : "");
            let path = parent + sep + subdir.name;
            let flatSubdirs: [string, Directory][] = Array.from(subdir.flatDirs().entries()).map(pair => {
                let subdirPath = pair[0];
                return [parent + sep + subdirPath, pair[1]];
            });
            let pairs: [string, Directory][] = [[path, subdir], ...flatSubdirs];
            return pairs;
        });
        if (this.root) {
            let rootPair: [string, Directory] = [this.name, this as Directory];
            result.push(rootPair);
            // result = [rootPair].concat(...result);
        }
        return new Map(result);
    }
}

class DirHierarchyBuilder {

    static newHierarchyBuilder(dirPath: string) {
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
            let root = new DirHierarchyBuilder(true, first.parentPath, undefined, undefined, new Map());
            first.root = false;
            root.subdirs.set(first.name, first);
            return root;
        } else {
            return first;
        }
    }

    constructor(
        public root: boolean,
        public name: string | undefined,
        public parentPath: string | undefined,
        public path: string | undefined,
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
        return new Directory(this.root, this.name!!, this.path, Array.from(this.subdirs.values()).map(d => d.toDirectory()));
    }
}