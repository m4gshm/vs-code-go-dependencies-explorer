import { join, parse } from 'path';
import {
  commands, EventEmitter, FileType, GlobPattern, Tab, TabInputText,
  TreeItem,
  Uri, window, workspace,
  ExtensionContext,
  TreeDataProvider, Event, Disposable,
  TreeItemCollapsibleState
} from 'vscode';
import { GoDependenciesStateProvider } from './goDependenciesStateProvider';
import { PathElement } from './pathTree';

export async function createTreeView(ctx: ExtensionContext, treeProvider: GoDependenciesStateProvider) {
  const subscriptions = ctx.subscriptions;

  const treeDataProvider = new GoTreeDataProvider(treeProvider);
  subscriptions.push(treeDataProvider);
  const treeView = window.createTreeView("go.dependencies.explorer", {
    showCollapseAll: true, treeDataProvider: treeDataProvider,
  });

  subscriptions.push(treeView);

  subscriptions.push(treeView.onDidChangeSelection(async event => {
    const selections = event.selection;
    for (const selection of selections) {
      treeDataProvider.onSelect(selection);
      if (selection instanceof GoFileItem) {
        const id = selection.id;
        if (id) {
          const fileUri = Uri.file(id);
          await workspace.openTextDocument(fileUri).then(
            document => window.showTextDocument(document)
          );
        } else {
          console.warn(`selected FileItem withoud id ${selection}`);
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
    if (tab.isActive) {
      const input = tab.input;
      const textInput = input instanceof TabInputText ? input as TabInputText : undefined;
      if (textInput) {
        const fileUri = textInput.uri;
        const workspaceFolders = workspace.workspaceFolders;
        const workspaceFolder = workspaceFolders?.find(folder => {
          const found = fileUri.fsPath.startsWith(folder.uri.fsPath);
          return found;
        });
        if (!workspaceFolder) {
          const fsPath = fileUri.fsPath;
          const filePath = parse(fsPath);
          const dir = filePath.dir;
          const isPackageDir = treeProvider.findDir(dir) !== undefined;
          if (isPackageDir) {
            console.debug(`set readonly dependency file ${fileUri}`);
            //workbench.action.files.resetActiveEditorReadonlyInSession
            commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
            const openPath = fsPath;
            treeView.reveal({
              id: openPath
            }, {
              focus: true,
              select: true,
            });
          }
        }
      }
    }
  }

  function syncSelectedFileWithActiveTab() {
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      selectFileOfActiveTabInTree(activeTab);
    }
  }

  async function refresh(force = false) {
    treeDataProvider.refresh(force);
  }

  const handleFileEvent = async (op: string, filePattern: GlobPattern, event: Uri) => {
    console.debug(`handleFileEvent: ${op}, ${filePattern}, ${event}`);
    await refresh();
  };

  const filePattern = '**/go.{mod,sum}';
  const gofileWatcher = workspace.createFileSystemWatcher(filePattern);
  gofileWatcher.onDidCreate(e => handleFileEvent('create', filePattern, e));
  gofileWatcher.onDidChange(e => handleFileEvent('change', filePattern, e));
  gofileWatcher.onDidDelete(e => handleFileEvent('delete', filePattern, e));
  subscriptions.push(gofileWatcher);

  const workspaceListener = workspace.onDidChangeWorkspaceFolders(event => {
    console.debug(`handle workspace folders changing, added: ${event.added}, removed: ${event.removed}`);
    refresh();
    syncSelectedFileWithActiveTab();
  });
  subscriptions.push(workspaceListener);

  await refresh();
  // syncSelectedFileWithActiveTab();

  return { treeView, refresh };
}

export function getFsUriOfSelectedItem(item: TreeItem | PathElement) {
  let uri: Uri | undefined;
  if (item instanceof GoFileItem) {
    const path = item.id;
    if (path) {
      uri = Uri.file(path);
    } else {
      console.warn("undefined path of file item:", item);
    }
  } else if (item instanceof GoDirItem) {
    const path = item.id;
    if (path) {
      uri = Uri.file(path);
    } else {
      console.warn("undefined path of dir item:", item);
    }
  } else if (item instanceof PathElement) {
    uri = Uri.file(item.path);
  } else {
    console.warn("unexpected item type:", item);
  }
  return uri;
}

export class GoTreeDataProvider implements TreeDataProvider<TreeItem>, Disposable {
  private readonly _onDidChangeTreeData = new EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData: Event<TreeItem | undefined> = this._onDidChangeTreeData.event;
  private readonly subscriptions: Disposable[] = [];

  private readonly elements = new Map<string, TreeItem>();
  private readonly children = new Map<string, Set<string>>();
  private readonly parents = new Map<string, string>();

  private readonly expanded = new Set<string>();

  constructor(private readonly treeProvider: GoDependenciesStateProvider) {
    this.subscriptions.push(this._onDidChangeTreeData);
  }

  dispose() {
    this.subscriptions.forEach(d => d.dispose());
  }

  async refresh(force = false) {
    if (force) {
      this.elements.clear();
      this.children.clear();
      this.parents.clear();
    } else {
      const changes = await this.treeProvider.refresh(true);
      if (changes) {
        changes.removedStdDirs?.forEach(d => this.deleteState(d.path));
        changes.removedModuleDirs?.forEach(d => this.deleteState(d.path));
        changes.removedReplaced?.forEach(d => this.deleteState(d.path));
      }
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  private deleteState(id: string, deepCheck = 10000) {
    if (deepCheck <= 0) {
      throw Error('overflow');
    }
    const element = this.elements.get(id);
    if (element) {
      const children = this.children.get(id) || new Set();
      for (const childId of children) {
        if (childId) {
          this.deleteState(childId, deepCheck - 1);
        }
      }
      this.elements.delete(id);
      this.children.delete(id);
      this.parents.delete(id);
    }
  }

  async getTreeItem(element: TreeItem) {
    const id = element.id;

    if (id) {
      const found = this.elements.get(id);
      if (found) {
        element = found;
      } else {
        if (element instanceof GoDirItem) {
          this.addElement(element);
        } else if (element instanceof GoFileItem) {
          this.addElement(element);
        } else {
          const parent = await this.getParent(element);
          if (parent) {
            const children = await this.getChildren(parent);
            const childFound = children.find(e => e.id === id);
            const childFound2 = this.elements.get(id);
            if (childFound) {
              element = childFound;
            } else {
              //log
            }
          } else {
            //log
          }
        }
      }

      if (element instanceof GoDirItem) {
        const expanded = this.expanded.has(id);
        if (expanded) {
          element.collapsibleState = TreeItemCollapsibleState.Expanded;
        } else if (element.collapsibleState === TreeItemCollapsibleState.Expanded) {
          element.collapsibleState = TreeItemCollapsibleState.Expanded;
          this.expanded.add(id);
        } else if (element.collapsibleState === TreeItemCollapsibleState.Collapsed && expanded) {
          this.expanded.delete(id);
        }
      }
    }
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const id = element?.id;
    let childIds = id ? this.children.get(id) : undefined;
    if (childIds) {
      const children = Array.from(childIds).map(id => this.elements.get(id)).filter(e => e !== undefined);
      return children;
    } else if (element instanceof GoDirItem) {
      const children = await this.initChildren(element);
      return children;
    } else {
      const rootElements = !element ? Array.from(this.treeProvider.rootDirs.map(d => {
        const element = this.elements.get(d.path);
        return element && element instanceof GoDirItem ? element : this.addElement(newGoDirItem(d));
      })) : [];
      return rootElements;
    }
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

    const subdirs = dir.children.map(d => newGoDirItem(d));
    const children = [...subdirs, ...files];

    this.linkElements(element, children);
    children.forEach(child => this.addElement(child));

    return children;
  }

  async getParent(element: TreeItem): Promise<TreeItem | undefined> {
    const id = element.id;
    if (!id) {
      return;
    }

    let nextLevelPerantPath = id;
    while (true) {
      const parentId = this.parents.get(nextLevelPerantPath);
      const parent = parentId ? this.elements.get(parentId) : undefined;
      if (parent) {
        return parent;
      }

      const path = parse(nextLevelPerantPath);
      const isSystemRoot = path.root === path.dir && path.base.length === 0;
      if (isSystemRoot) {
        return;
      }

      nextLevelPerantPath = path.dir;

      let newParent = this.elements.get(nextLevelPerantPath);
      if (newParent) {
        await this.initChildren(newParent as GoDirItem);
        return newParent;
      } else {
        const parentPathElement = this.treeProvider.findDir(nextLevelPerantPath);
        if (parentPathElement) {
          const newParent = newGoDirItem(parentPathElement);
          this.addElement(newParent);
          await this.initChildren(newParent);

          return newParent;
        } else {
          //is tree root?
          return;
        }
      }
    }
  }

  private addElement(element: (GoDirItem | GoFileItem)) {
    this.elements.set(element?.id!!, element);
    return element;
  }

  private linkElements(parent: GoDirItem, children: (GoDirItem | GoFileItem)[]) {
    for (const child of children) {
      const childId = child.id!!;
      const parentId = parent.id!!;
      let children = this.children.get(parentId);
      if (!children) {
        children = new Set();
        this.children.set(parentId, children);
      }
      children.add(childId);
      this.parents.set(childId, parentId);
      this.addElement(child);
    }
  }

  onSelect(element: TreeItem) {

  }

  onExpand(element: TreeItem) {
    const id = element.id;
    if (id) {
      this.expanded.add(id);
    }
  }

  onCollapse(element: TreeItem) {
    const id = element.id;
    if (id) {
      this.expanded.delete(id);
    }
  }
}

function newGoDirItem(dir: PathElement, label: string | undefined = undefined) {
  return new GoDirItem(dir, label);
}

export class GoDirItem extends TreeItem {
  constructor(
    public readonly dir: PathElement,
    label: string | undefined = undefined,
  ) {
    super(label || dir.name, TreeItemCollapsibleState.Collapsed);
    this.id = dir.path;
    this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    this.tooltip = dir.name;
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
    this.tooltip = fileName;
    this.contextValue = 'goFile';
  }
}
