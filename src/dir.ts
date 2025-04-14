import path, { parse, join } from 'path';
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


interface M extends Map<string, M> {

}

export class DirHierarchyBuilder {

    constructor(
        public root: boolean,
        public name: string,
        public path: string,
        public subdirs: Map<string, DirHierarchyBuilder>,
        public findFiles: boolean = false,
    ) {
    }

    public static createGrouped(groupedByRootDirs: Map<string, string[]>, rootPath: string, rootName: string) {
        const subdirs = new Map(Array.from(groupedByRootDirs.entries()).map(([root, dirPaths]) => {
            const fullRoot = root;//path.join(fsRootPath, root);
            const subDirHierarhies = new Map(dirPaths.map(subDir => {
                return [subDir, new DirHierarchyBuilder(false, subDir, path.join(fullRoot, subDir), new Map(), true)];
            }));
            return [fullRoot, (new DirHierarchyBuilder(false, fullRoot, fullRoot, subDirHierarhies, false))];
        }));
        return subdirs.size > 0 ? new DirHierarchyBuilder(true, rootName, rootPath, subdirs, false) : undefined;
    }

    public static create(
        dirPaths: string[],
        expectedRootDir: string | undefined = undefined,
        expectedRootDirReplace: string | undefined = undefined,
        expectedRootName: string | undefined = undefined,
        collapseFirst: boolean = false,
    ) {
        let root = expectedRootDir ? DirHierarchyBuilder.newHierarchyBuilder(
            expectedRootDir, expectedRootDir, expectedRootDirReplace, expectedRootName
        ) : undefined;
        for (let dirPath of dirPaths) {
            if (expectedRootDir && !dirPath.startsWith(expectedRootDir)) {
                console.warn(`path "${dirPath}" must be start from "${expectedRootDir}"`);
            } else {
                let newRoot = DirHierarchyBuilder.newHierarchyBuilder(dirPath, expectedRootDir,
                    expectedRootDirReplace, expectedRootName
                );
                if (!root) {
                    root = newRoot;
                } else
                    if (newRoot && root) {
                        if (root.path === newRoot.path) {
                            root.merge(newRoot);
                        } else {
                            //log
                        }
                    }
            }
        }
        if (root) {
            const [_, collapsedRoot] = collapse(expectedRootDir ? expectedRootDir : '', root, collapseFirst);
            return collapsedRoot;
        } else {
            return undefined;
        }
    }

    static newHierarchyBuilder(dirPath: string, expectedRootDir: string | undefined = undefined,
        expectedRootDirReplace: string | undefined = undefined, expectedRootName: string | undefined = undefined) {
        dirPath = normalizeWinPath(dirPath);
        const withExpectedRootDirReplace = expectedRootDirReplace && expectedRootDirReplace.length > 0;
        const expectedRootPathReplace = withExpectedRootDirReplace ? Uri.file(expectedRootDirReplace).fsPath : "";
        let dirPathPart = expectedRootDir ? dirPath.substring(expectedRootDir.length, dirPath.length) : dirPath;
        let root: DirHierarchyBuilder | undefined;
        let findFiles = true;
        for (; dirPathPart.length > 0;) {
            const parsed = parse(dirPathPart);
            const parentParentDir = parsed.dir;
            const name = parsed.name + parsed.ext;
            if (name.length === 0) {
                break;
            }
            const path = join(parentParentDir, name);
            const fullPath = withExpectedRootDirReplace ? join(expectedRootPathReplace, path) : path;
            const newRoot = new DirHierarchyBuilder(false, name, fullPath, new Map(), findFiles);
            if (root) {
                newRoot.subdirs.set(root.name, root);
            }
            root = newRoot;
            dirPathPart = parentParentDir;
            findFiles = false;
        }

        const sub = root;
        const rootPath = expectedRootPathReplace.length > 0 ? expectedRootPathReplace : dirPathPart;
        const rootName = expectedRootName && expectedRootName.length > 0 ? expectedRootName : dirPathPart;
        root = new DirHierarchyBuilder(true, rootName, rootPath, new Map());
        if (sub) {
            root.subdirs.set(sub.name, sub);
        }
        return root;
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

function collapse(name: string, dir: DirHierarchyBuilder, collapseSelf: boolean = false): [string, DirHierarchyBuilder] {
    const subdirs = dir.subdirs;
    const single = subdirs.size === 1;
    if (!(collapseSelf && single)) {
        return [name, dir];
    }
    const [subdirName, subdir] = subdirs.entries().next().value!!;
    const [collapsedSubdirName, collapsedSubdir] = collapse(subdirName, subdir, true);
    const collapsedSubPath = dir.name ? join(dir.name, collapsedSubdirName) : collapsedSubdirName;
    collapsedSubdir.root = dir.root;
    collapsedSubdir.name = collapsedSubPath;
    return [collapsedSubPath, collapsedSubdir];
}

