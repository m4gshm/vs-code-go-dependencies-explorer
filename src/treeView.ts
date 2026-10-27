import { join, parse } from 'path';
import {
  commands, EventEmitter, FileType,
  TreeItem,
  Uri, window, workspace,
  ExtensionContext,
  TreeDataProvider, Event, Disposable,
  TreeItemCollapsibleState, Tab, TabInputText
} from 'vscode';
import { GoDependenciesStateProvider } from './goDependenciesStateProvider';
import { PathElement } from './pathTree';
import { GoDirNode, GoFileNode, GoTreeModel, ModelNode, TreeSource, ExpandStateStore } from './treeModel';

const EXPANDED_STATE_KEY = 'go.dependencies.explorer.expanded';

function createExpandStore(ctx: ExtensionContext | undefined): ExpandStateStore | undefined {
    if (!ctx) {
        return undefined;
    }
    const expandedIds = new Set<string>(ctx.workspaceState.get<string[]>(EXPANDED_STATE_KEY, []));
    return {
        isExpanded: id => expandedIds.has(id),
        setExpanded: (id, expanded) => {
            if (expanded) {
                expandedIds.add(id);
            } else {
                expandedIds.delete(id);
            }
            void ctx.workspaceState.update(EXPANDED_STATE_KEY, Array.from(expandedIds));
        },
    };
}

export async function createTreeView(ctx: ExtensionContext, treeProvider: GoDependenciesStateProvider) {
  const subscriptions = ctx.subscriptions;

  const treeDataProvider = new GoTreeDataProvider(treeProvider, ctx);
  subscriptions.push(treeDataProvider);
  const treeView = window.createTreeView("go.dependencies.explorer", {
    showCollapseAll: true, treeDataProvider: treeDataProvider,
  });

  subscriptions.push(treeView);

  subscriptions.push(treeView.onDidChangeSelection(async event => {
    for (const selection of event.selection) {
      if (selection instanceof GoFileItem) {
        const id = selection.id;
        if (id) {
          const fileUri = Uri.file(id);
          await workspace.openTextDocument(fileUri).then(
            document => window.showTextDocument(document),
            err => console.warn(`failed to open document ${id}:`, err)
          );
        } else {
          console.warn(`selected FileItem without id ${selection}`);
        }
      }
    }
  }));
  subscriptions.push(treeView.onDidChangeVisibility(async event => {
    if (event.visible) {
      syncSelectedFileWithActiveTab();
    }
  }));

  subscriptions.push(treeView.onDidCollapseElement(async event => {
    treeDataProvider.onCollapse(event.element);
  }));

  subscriptions.push(treeView.onDidExpandElement(async event => {
    treeDataProvider.onExpand(event.element);
  }));


  subscriptions.push(window.tabGroups.onDidChangeTabs(tabs => {
    if (treeView.visible) {
      for (const tab of tabs.opened) {
        selectFileOfActiveTabInTree(tab);
      }
      for (const tab of tabs.changed) {
        selectFileOfActiveTabInTree(tab);
      }
    }
  }));

  function selectFileOfActiveTabInTree(tab: Tab) {
    if (!tab.isActive) {
      return;
    }
    const input = tab.input;
    const textInput = input instanceof TabInputText ? input as TabInputText : undefined;
    if (!textInput) {
      return;
    }
    const fileUri = textInput.uri;
    const fsPath = fileUri.fsPath;
    if (isFileInWorkspace(fsPath)) {
      return;
    }
    if (treeProvider.findDir(parse(fsPath).dir) === undefined) {
      return;
    }
    console.debug(`set readonly dependency file ${fileUri}`);
    commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
    treeView.reveal({ id: fsPath }, { focus: true, select: true });
  }

  function isFileInWorkspace(fsPath: string) {
    return !!workspace.workspaceFolders?.some(folder => fsPath.startsWith(folder.uri.fsPath));
  }

  function syncSelectedFileWithActiveTab() {
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      selectFileOfActiveTabInTree(activeTab);
    }
  }

  async function refresh(force = false) {
    await window.withProgress({ location: { viewId: "go.dependencies.explorer" } },
      () => treeDataProvider.refresh(force));
  }

  subscriptions.push(registerGoModWatcher(() => refresh()));
  subscriptions.push(workspace.onDidChangeWorkspaceFolders(event => {
    console.debug(`handle workspace folders changing, added: ${event.added}, removed: ${event.removed}`);
    void refresh();
    syncSelectedFileWithActiveTab();
  }));

  await refresh();
  syncSelectedFileWithActiveTab();

  return { treeView, refresh };
}

function registerGoModWatcher(scheduleRefresh: () => void): Disposable {
  const filePattern = '**/go.{mod,sum}';
  // go mod tidy etc. fire several watcher events in a burst; one full rescan is enough
  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleDebounced = (delayMs = 500) => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      scheduleRefresh();
    }, delayMs);
  };
  const watcher = workspace.createFileSystemWatcher(filePattern);
  watcher.onDidCreate(() => scheduleDebounced());
  watcher.onDidChange(() => scheduleDebounced());
  watcher.onDidDelete(() => scheduleDebounced());
  return new Disposable(() => {
    clearTimeout(refreshTimer);
    watcher.dispose();
  });
}

export function getFsUriOfSelectedItem(item: TreeItem | PathElement) {
  if (item instanceof PathElement) {
    return Uri.file(item.path);
  }
  const path = item.id;
  if (!path) {
    console.warn("undefined path of item:", item);
    return undefined;
  }
  return Uri.file(path);
}

export class GoTreeDataProvider implements TreeDataProvider<TreeItem>, Disposable {
  private readonly _onDidChangeTreeData = new EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData: Event<TreeItem | undefined> = this._onDidChangeTreeData.event;
  private readonly subscriptions: Disposable[] = [];

  private readonly model: GoTreeModel;

  constructor(treeProvider: GoDependenciesStateProvider, ctx?: ExtensionContext) {
    const source: TreeSource = {
      rootDirs: () => treeProvider.rootDirs,
      findDir: path => treeProvider.findDir(path),
      versionOf: path => treeProvider.versionOf(path),
      updateOf: path => treeProvider.updateOf(path),
      refreshTree: (calcChanges, useCache) => treeProvider.refresh(calcChanges, useCache),
    };
    this.model = new GoTreeModel(source, async dirPath => {
      const entries = await workspace.fs.readDirectory(Uri.file(dirPath));
      return entries.map(([name, type]) => ({ name, isDirectory: type === FileType.Directory }));
    }, createExpandStore(ctx));
    this.subscriptions.push(this._onDidChangeTreeData);
  }

  dispose() {
    this.subscriptions.forEach(d => d.dispose());
  }

  async refresh(force = false) {
    const useCache = workspace.getConfiguration('go.dependencies.explorer').get('use.scan.cache', true);
    await this.model.refresh(force, useCache);
    this._onDidChangeTreeData.fire(undefined);
  }

  private nodeOf(element?: TreeItem): ModelNode | undefined {
    if (!element) {
      return undefined;
    }
    if (element instanceof GoDirItem) {
      return element.node;
    }
    if (element instanceof GoFileItem) {
      return element.node;
    }
    return this.model.elementById(element.id);
  }

  private wrap(node: ModelNode, reuse?: TreeItem): TreeItem {
    if (node instanceof GoDirNode) {
      const item = reuse instanceof GoDirItem && reuse.node.dir === node.dir ? reuse : new GoDirItem(node.dir);
      item.collapsibleState = node.isExpanded
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.Collapsed;
      item.description = node.description;
      return item;
    }
    return reuse instanceof GoFileItem && reuse.node === node ? reuse : new GoFileItem(node.fileName, node.filePath);
  }

  async getTreeItem(element: TreeItem) {
    const node = this.nodeOf(element);
    if (!node) {
      return element;
    }
    return this.wrap(this.model.getTreeItem(node), element);
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const node = this.nodeOf(element);
    if (element && !node) {
      return [];
    }
    const children = await this.model.getChildren(node);
    return children.map(child => this.wrap(child));
  }

  async getParent(element: TreeItem): Promise<TreeItem | undefined> {
    if (!element.id) {
      return undefined;
    }
    const parent = await this.model.getParentOf(element.id);
    return parent ? this.wrap(parent) : undefined;
  }

  onExpand(element: TreeItem) {
    const node = this.nodeOf(element);
    if (node) {
      this.model.onExpand(node);
    }
  }

  onCollapse(element: TreeItem) {
    const node = this.nodeOf(element);
    if (node) {
      this.model.onCollapse(node);
    }
  }
}

export class GoDirItem extends TreeItem {
  readonly node: GoDirNode;

  constructor(
    public readonly dir: PathElement,
    label: string | undefined = undefined,
  ) {
    super(label || dir.name, TreeItemCollapsibleState.Collapsed);
    this.node = new GoDirNode(dir, label);
    this.id = dir.path;
    this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    this.tooltip = dir.path;
    this.contextValue = 'goDir';
  }
}

export class GoFileItem extends TreeItem {
  readonly node: GoFileNode;

  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
  ) {
    super(fileName);
    this.node = new GoFileNode(fileName, filePath);
    const fullFilePath = join(filePath, fileName);
    this.id = fullFilePath;
    //just file to render mime icon but prevent file name colorizing by Git extension
    this.resourceUri = Uri.file(fileName);
    this.tooltip = fullFilePath;
    this.contextValue = 'goFile';
  }
}
