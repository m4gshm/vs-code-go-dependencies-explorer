'use strict';

export class DirHierarchyBuilder {
    public static create(dirPaths: string[]): DirHierarchyBuilder {
        let hierarchy = new DirHierarchyBuilder(undefined, undefined, new Map());
        for (let dirPath of dirPaths) {
            var dir: DirHierarchyBuilder | undefined = hierarchy;
            let subdirs = dir.subdirs;
            let parts = dirPath.split(pathDelim()).filter(p => p.length > 0);
            for (var i = 0; i < parts.length; i++) {
                let part = parts[i];
                dir = subdirs.get(part);
                if (!dir) {
                    let lastPart = i === parts.length - 1;
                    dir = new DirHierarchyBuilder(part, lastPart ? dirPath : undefined, new Map());
                    subdirs.set(part, dir);
                }
                subdirs = dir.subdirs;
            }
        }
        hierarchy.collapse();
        return hierarchy;
    }
    constructor(
        private name: string | undefined,
        private path: string | undefined,
        private subdirs: Map<string, DirHierarchyBuilder>
    ) {
    }
    public collapse() {
        let subdirs = this.subdirs;
        while (subdirs.size === 1) {
            let first = subdirs.values().next().value!!;
            var n = this.name;
            this.name = (n || "") + pathDelim() + first.name;
            this.path = first.path;
            subdirs = first.subdirs;
            this.subdirs = subdirs;
        }
        let isRoot = !this.name;
        subdirs.forEach(subdir => {
            subdir.collapse();
            if (isRoot) {
                subdir.name = pathDelim() + subdir.name;
            }
        });
    }

    public getRoot(): Directory {
        return new Directory(this.name!!, this.path, Array.from(this.subdirs.values()).map(d => d.getRoot()));
    }
}

export class Directory {
    constructor(
        public readonly name: string,
        public path: string | undefined,
        public readonly subdirs: Directory[]
    ) {
    }
}

function pathDelim(): string {
    return "/";
}

