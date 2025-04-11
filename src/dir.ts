import { parse, join } from 'path';
import { Uri } from 'vscode';

export class Directory {
    constructor(
        public readonly label: string,
        public readonly path: string,
        public readonly findFiles: boolean,
        public readonly subdirs: Directory[],
    ) {
    }
}

export function flat(dirs: Directory[]) {
    return new Map(dirs.flatMap(dir => {
        const path = dir.path;
        const flatSubdirs: [string, Directory][] = Array.from(flat(dir.subdirs).entries());
        const pairs: [string, Directory][] = [[path, dir], ...flatSubdirs];
        return pairs;
    }));
}

export class DirHierarchyBuilder {

    public static create(dirPaths: string[], expectedRootDir: string, expectedRootDirReplace: string, expectedRootName: string) {
        let root = DirHierarchyBuilder.newHierarchyBuilder(expectedRootDir, expectedRootDir, expectedRootDirReplace, expectedRootName);
        for (let dirPath of dirPaths) {
            if (!dirPath.startsWith(expectedRootDir)) {
                // throw new Error(`path "${dirPath}" must be start from "${expectedRootDir}"`);
                console.warn(`path "${dirPath}" must be start from "${expectedRootDir}"`);
            } else {
                let newRoot = DirHierarchyBuilder.newHierarchyBuilder(dirPath, expectedRootDir, expectedRootDirReplace, expectedRootName);
                if (newRoot && root) {
                    if (root.path === newRoot.path) {
                        root.merge(newRoot);
                    } else {
                        //log
                    }
                }
            }
        }
        const [_, collapsedRoot] = collapse(expectedRootDir, root);
        return collapsedRoot;
    }

    static newHierarchyBuilder(dirPath: string, expectedRootDir: string, expectedRootDirReplace: string, expectedRootName: string) {
        dirPath = normalizeWinPath(dirPath);
        const expectedRootPathReplace = Uri.file(expectedRootDirReplace).fsPath;
        let dirPathPart = dirPath.substring(expectedRootDir.length, dirPath.length);
        let root: DirHierarchyBuilder | undefined;
        let findFiles = true;
        for (; dirPathPart.length > 0;) {
            const parsed = parse(dirPathPart);
            const parentParentDir = parsed.dir;
            const name = parsed.name + parsed.ext;
            if (name.length === 0) {
                break;
            }
            const path = join(expectedRootPathReplace, join(parentParentDir, name));
            const newRoot = new DirHierarchyBuilder(false, name, path, new Map(), findFiles);
            if (root) {
                newRoot.subdirs.set(root.name, root);
            }
            root = newRoot;
            dirPathPart = parentParentDir;
            findFiles = false;
        }

        const sub = root;
        root = new DirHierarchyBuilder(true, expectedRootName, expectedRootPathReplace, new Map());
        if (sub) {
            root.subdirs.set(sub.name, sub);
        }
        return root;
    }

    public get isGoPackage(): boolean {
        return true;
    }

    constructor(
        public root: boolean,
        public name: string,
        public path: string,
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
        return new Directory(this.name, this.path, this.findFiles, Array.from(this.subdirs.values()).map(d => d.toDirectory()));
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
        const collapsedPath = dir.path ? join(dir.path, subdirName) : subdirName;
        subdir.path = collapsedPath;
        subdir.root = dir.root;
        return [collapsedPath, subdir];
    }

    dir.subdirs = collapsedSubdirs;
    return [name, dir];
}

