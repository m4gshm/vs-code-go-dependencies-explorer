import { join, parse } from 'path';
import { PathElement } from './pathTree';
import { TreeState } from './treeState';
import type { RemovedAddedDirs } from './goDependenciesStateProvider';

export interface DirEntry {
    name: string;
    isDirectory: boolean;
}

export type ReadDir = (dirPath: string) => Promise<DirEntry[]>;

export interface TreeSource {
    rootDirs(): PathElement[];
    findDir(path: string): PathElement | undefined;
    versionOf(path: string): string | undefined;
    refreshTree(calcChanges: boolean, useCache: boolean): Promise<RemovedAddedDirs | undefined>;
}

export type ModelNode = GoDirNode | GoFileNode;

export class GoDirNode {
    readonly id: string;
    readonly label: string;
    isExpanded: boolean = false;
    description: string | undefined = undefined;

    constructor(
        readonly dir: PathElement,
        label: string | undefined = undefined,
    ) {
        this.id = dir.path;
        this.label = label || dir.name;
    }
}

export class GoFileNode {
    readonly id: string;
    readonly label: string;

    constructor(
        readonly fileName: string,
        readonly filePath: string,
    ) {
        this.id = join(filePath, fileName);
        this.label = fileName;
    }
}

export class GoTreeModel {
    private readonly state = new TreeState<ModelNode>();

    constructor(
        private readonly source: TreeSource,
        private readonly readDir: ReadDir,
    ) { }

    elementById(id: string | undefined): ModelNode | undefined {
        return this.state.element(id);
    }

    async refresh(force = false) {
        if (force) {
            this.state.clear();
        }
        const changes = await this.source.refreshTree(!force, !force);
        if (!force && changes) {
            changes.removedStdDirs?.forEach(d => this.state.deleteDeep(d.path));
            changes.removedModuleDirs?.forEach(d => this.state.deleteDeep(d.path));
            changes.removedReplaced?.forEach(d => this.state.deleteDeep(d.path));
        }
    }

    getTreeItem(node: ModelNode): ModelNode {
        const found = this.state.element(node.id) ?? this.state.add(node);
        if (found instanceof GoDirNode) {
            found.isExpanded = this.state.isExpanded(found.id);
            found.description = this.source.versionOf(found.id);
        }
        return found;
    }

    async getChildren(node?: ModelNode): Promise<ModelNode[]> {
        if (!node) {
            return this.source.rootDirs().map(d => {
                const existing = this.state.element(d.path);
                return existing && existing instanceof GoDirNode ? existing : this.state.add(new GoDirNode(d));
            });
        }
        const cached = this.state.childrenOf(node.id);
        if (cached) {
            return cached;
        }
        if (node instanceof GoDirNode) {
            return await this.initChildren(node);
        }
        return [];
    }

    async getParent(node: ModelNode): Promise<ModelNode | undefined> {
        return await this.getParentOf(node.id);
    }

    async getParentOf(id: string): Promise<ModelNode | undefined> {
        let childId = id;
        while (true) {
            const parent = this.state.parentOf(childId);
            if (parent) {
                return parent;
            }

            const parsed = parse(childId);
            const isSystemRoot = parsed.root === parsed.dir && parsed.base.length === 0;
            if (isSystemRoot) {
                return undefined;
            }
            childId = parsed.dir;

            const knownParent = this.state.element(childId);
            if (knownParent instanceof GoDirNode) {
                await this.initChildren(knownParent);
                return knownParent;
            }
            const parentPathElement = this.source.findDir(childId);
            if (!parentPathElement) {
                return undefined;
            }
            const createdParent = new GoDirNode(parentPathElement);
            this.state.add(createdParent);
            await this.initChildren(createdParent);
            return createdParent;
        }
    }

    onExpand(node: ModelNode) {
        this.state.onExpand(node.id);
    }

    onCollapse(node: ModelNode) {
        this.state.onCollapse(node.id);
    }

    private async initChildren(dir: GoDirNode) {
        const entries = dir.dir.exposeFiles ? await this.readDir(dir.dir.path) : [];
        const files = entries.filter(e => !e.isDirectory).map(e => new GoFileNode(e.name, dir.dir.path));
        const subdirs = dir.dir.children.map(d => new GoDirNode(d));
        const children = [...subdirs, ...files];
        this.state.linkChildren(dir.id, children);
        return children;
    }
}
