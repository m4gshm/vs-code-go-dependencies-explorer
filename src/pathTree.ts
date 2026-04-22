import { parse, join } from 'path';

export class PathElement {
    constructor(
        public readonly name: string,
        public readonly path: string,
        public readonly children: PathElement[],
        public readonly exposeFiles: boolean = false,
    ) { }
}

export function flat(dirs: PathElement[]) {
    return new Map(dirs.flatMap(dir => {
        const path = dir.path;
        const flatSubdirs: [string, PathElement][] = Array.from(flat(dir.children).entries());
        const pairs: [string, PathElement][] = [[path, dir], ...flatSubdirs];
        return pairs;
    }));
}

export enum RootType {
    common, system
}

export class PathTreeBuilder {
    constructor(
        public root: boolean,
        public leafBranch: boolean,
        public name: string,
        public path: string,
        public children: Map<string, PathTreeBuilder>,
    ) { }

    public static create(dirPaths: string[], rootDir: string | RootType = RootType.common) {
        const useRoot = typeof rootDir === "string";
        let root: PathTreeBuilder | undefined;
        for (let dirPath of dirPaths) {
            if (useRoot && !dirPath.startsWith(rootDir)) {
                console.warn(`path "${dirPath}" must be start from "${rootDir}"`);
            } else {
                const newRoot = PathTreeBuilder.newHierarchyBuilder(dirPath, useRoot ? rootDir : undefined);
                if (!root) {
                    root = newRoot;
                } else if (newRoot && root.path === newRoot.path) {
                    root.merge(newRoot);
                }
            }
        }

        if (rootDir === RootType.common && root) {
            const [_, collapsed] = collapseSubdirs(root);
            return collapsed;
        } else {
            return root;
        }
    }

    static newHierarchyBuilder(dirPath: string, rootDir: string | undefined) {
        dirPath = normalizeWinPath(dirPath);
        rootDir = rootDir ? normalizeWinPath(rootDir) : undefined;
        let dirPathPart = dirPath;
        let root: PathTreeBuilder | undefined;
        for (let i = 0; dirPathPart.length > 0; i++) {
            let isLeafBranch = i === 0;

            let newRoot: PathTreeBuilder;
            if (rootDir && dirPathPart === rootDir) {
                newRoot = new PathTreeBuilder(true, isLeafBranch, dirPathPart, dirPathPart, new Map());
                dirPathPart = ''; // exit
            } else {
                const parsed = parse(dirPathPart);
                const parentParentDir = parsed.dir;

                const name = parsed.name + parsed.ext;
                const fullPath = join(parentParentDir, name);
                newRoot = new PathTreeBuilder(true, isLeafBranch, name, fullPath, new Map());
                dirPathPart = parsed.root === parentParentDir && name.length === 0 ? '' : parentParentDir;
            }
            if (root) {
                root.root = false;
                newRoot.children.set(root.name, root);
            }
            root = newRoot;
        }
        return root;
    }

    merge(other: PathTreeBuilder) {
        if (other.leafBranch) {
            this.leafBranch = true;
        }
        if (other.root) {
            this.root = true;
        }
        other.children.forEach((otherSubdir, name) => {
            let subdir = this.children.get(name);
            if (!subdir) {
                this.children.set(name, otherSubdir);
            } else {
                subdir.merge(otherSubdir);
            }
        });
    }

    public toDirectory(): PathElement {
        return new PathElement(this.name, this.path, Array.from(this.children.values()).map(d => d.toDirectory()), this.leafBranch);
    }
}

const isWin = process.platform === "win32";

export function normalizeWinPath(dirPath: string) {
    if (isWin) {
        const path = parse(dirPath);
        const lcRoot = path.root.toLowerCase();
        if (lcRoot !== path.root) {
            dirPath = lcRoot + dirPath.substring(lcRoot.length, dirPath.length);
        }
    }
    return dirPath;
}

function collapseSubdirs(path: PathTreeBuilder): [string, PathTreeBuilder] {
    const subdirs = path.children;
    if (path.leafBranch || subdirs.size !== 1) {
        return [path.name, path];
    }
    const [_, subdir] = subdirs.entries().next().value!;
    const [collapsedSubdirName, collapsedSubdir] = collapseSubdirs(subdir);
    const root = path.root;
    const collapsedSubPath = root
        ? join(path.path, path.name, collapsedSubdirName)
        : join(path.name, collapsedSubdirName);
    collapsedSubdir.root = root;
    if (path.leafBranch) {
        collapsedSubdir.leafBranch = true;
    }
    collapsedSubdir.name = collapsedSubPath;
    return [collapsedSubPath, collapsedSubdir];
}

