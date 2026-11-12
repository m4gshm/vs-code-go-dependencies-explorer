export interface TreeElement {
    id?: string;
}

export class TreeState<T extends TreeElement> {
    private readonly elements = new Map<string, T>();
    private readonly children = new Map<string, Set<string>>();
    private readonly parents = new Map<string, string>();
    private readonly expanded = new Set<string>();

    element(id: string | undefined): T | undefined {
        return id ? this.elements.get(id) : undefined;
    }

    add(element: T): T {
        if (element.id) {
            this.elements.set(element.id, element);
        }
        return element;
    }

    linkChildren(parentId: string, children: T[]) {
        let childIds = this.children.get(parentId);
        if (!childIds) {
            childIds = new Set();
            this.children.set(parentId, childIds);
        }
        for (const child of children) {
            if (!child.id) {
                continue;
            }
            childIds.add(child.id);
            this.parents.set(child.id, parentId);
            this.add(child);
        }
    }

    childrenOf(id: string | undefined): T[] | undefined {
        const childIds = id ? this.children.get(id) : undefined;
        if (!childIds) {
            return undefined;
        }
        return Array.from(childIds).map(id => this.elements.get(id)).filter(e => e !== undefined) as T[];
    }

    parentOf(childId: string): T | undefined {
        return this.element(this.parents.get(childId));
    }

    deleteDeep(id: string) {
        const childIds = this.children.get(id);
        if (childIds) {
            for (const childId of childIds) {
                if (childId) {
                    this.deleteDeep(childId);
                }
            }
        }
        this.elements.delete(id);
        this.children.delete(id);
        this.parents.delete(id);
        this.expanded.delete(id);
    }

    onExpand(id: string | undefined) {
        if (id) {
            this.expanded.add(id);
        }
    }

    onCollapse(id: string | undefined) {
        if (id) {
            this.expanded.delete(id);
        }
    }

    isExpanded(id: string) {
        return this.expanded.has(id);
    }

    clear() {
        this.elements.clear();
        this.children.clear();
        this.parents.clear();
        this.expanded.clear();
    }
}
