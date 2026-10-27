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
import { TreeState } from './treeState';

export async function createTreeView(ctx: ExtensionContext, treeProvider: GoDependenciesStateProvider) {
  const subscriptions = ctx.subscriptions;

  const treeDataProvider = new GoTreeDataProvider(treeProvider);
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

  private readonly state = new TreeState<TreeItem>();

  constructor(private readonly treeProvider: GoDependenciesStateProvider) {
    this.subscriptions.push(this._onDidChangeTreeData);
  }

  dispose() {
    this.subscriptions.forEach(d => d.dispose());
  }

  async refresh(force = false) {
    if (force) {
      this.state.clear();
    } else {
      const changes = await this.treeProvider.refresh(true);
      if (changes) {
        changes.removedStdDirs?.forEach(d => this.state.deleteDeep(d.path));
        changes.removedModuleDirs?.forEach(d => this.state.deleteDeep(d.path));
        changes.removedReplaced?.forEach(d => this.state.deleteDeep(d.path));
      }
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  async getTreeItem(element: TreeItem) {
    const id = element.id;
    if (!id) {
      return element;
    }

    const found = this.state.element(id);
    if (found) {
      element = found;
    } else if (element instanceof GoDirItem || element instanceof GoFileItem) {
      this.state.add(element);
    }

    if (element instanceof GoDirItem) {
      if (!this.state.isExpanded(id) && element.collapsibleState === TreeItemCollapsibleState.Expanded) {
        this.state.onExpand(id);
      }
      element.collapsibleState = this.state.isExpanded(id)
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.Collapsed;
      element.description = this.treeProvider.versionOf(id);
    }
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const id = element?.id;
    if (id) {
      const cached = this.state.childrenOf(id);
      if (cached) {
        return cached;
      }
    }
    if (element instanceof GoDirItem) {
      return await this.initChildren(element);
    }
    if (element) {
      return [];
    }
    return this.treeProvider.rootDirs.map(d => {
      const element = this.state.element(d.path);
      return element && element instanceof GoDirItem ? element : this.state.add(new GoDirItem(d));
    });
  }

  private async initChildren(element: GoDirItem) {
    const dir = element.dir;
    const newUri = Uri.file(dir.path);
    const dirContent = dir.exposeFiles ? await workspace.fs.readDirectory(newUri) : [];
    const files = dirContent.filter(([_, type]) => {
      return type !== FileType.Directory;
    }).map(([filename, _]) => {
      return new GoFileItem(filename, dir.path!!);
    });

    const subdirs = dir.children.map(d => new GoDirItem(d));
    const children = [...subdirs, ...files];

    this.state.linkChildren(element.id!!, children);

    return children;
  }

  async getParent(element: TreeItem): Promise<TreeItem | undefined> {
    let childId = element.id;
    if (!childId) {
      return undefined;
    }
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
      if (knownParent instanceof GoDirItem) {
        await this.initChildren(knownParent);
        return knownParent;
      }
      const parentPathElement = this.treeProvider.findDir(childId);
      if (!parentPathElement) {
        return undefined;
      }
      const createdParent = new GoDirItem(parentPathElement);
      this.state.add(createdParent);
      await this.initChildren(createdParent);
      return createdParent;
    }
  }

  onExpand(element: TreeItem) {
    this.state.onExpand(element.id);
  }

  onCollapse(element: TreeItem) {
    this.state.onCollapse(element.id);
  }
}

export class GoDirItem extends TreeItem {
  constructor(
    public readonly dir: PathElement,
    label: string | undefined = undefined,
  ) {
    super(label || dir.name, TreeItemCollapsibleState.Collapsed);
    this.id = dir.path;
    this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    this.tooltip = dir.path;
    this.contextValue = 'goDir';
  }
}

export class GoFileItem extends TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
  ) {
    super(fileName);
    const fullFilePath = join(filePath, fileName);
    this.id = fullFilePath;
    //just file to render mime icon but prevent file name colorizing by Git extension 
    this.resourceUri = Uri.file(fileName);
    this.tooltip = fullFilePath;
    this.contextValue = 'goFile';
  }
}
