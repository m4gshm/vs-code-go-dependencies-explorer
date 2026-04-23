import { parse } from 'path';
import {
  commands, EventEmitter, FileType, GlobPattern, Tab, TabInputText,
  TreeItem,
  Uri, window, workspace,
  ExtensionContext,
  TreeDataProvider, Event,
} from 'vscode';
import { FileItem, GoTreeItemProvider, GoDirItem } from './goTreeItemProvider';

export async function createTreeView(ctx: ExtensionContext, treeProvider: GoTreeItemProvider) {
  const onDidChangeTreeData = new EventEmitter<undefined>();

  const subscriptions = ctx.subscriptions;
  subscriptions.push(onDidChangeTreeData);

  const treeView = window.createTreeView("go.dependencies.explorer", {
    showCollapseAll: true, treeDataProvider: new GoTreeDataProvider(onDidChangeTreeData, treeProvider),
  });
  subscriptions.push(treeView);

  subscriptions.push(treeView.onDidChangeSelection(async event => {
    const selections = event.selection;
    for (const selection of selections) {
      if (selection instanceof FileItem) {
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
              id: openPath,
              focus: true,
              select: true,
            } as TreeItem);
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

  async function refresh() {
    await treeProvider.refresh();
    onDidChangeTreeData.fire(undefined);
    syncSelectedFileWithActiveTab();
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

  await treeProvider.refresh();

  return { treeView, refresh };
}

export function getFsUriOfSelectedItem(item: any) {
  let uri: Uri | undefined;
  if (item instanceof FileItem) {
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
  } else {
    console.warn("unexpected item type:", item);
  }
  return uri;
}

export class GoTreeDataProvider implements TreeDataProvider<TreeItem> {
  readonly onDidChangeTreeData: Event<TreeItem | undefined>;

  constructor(
    _onDidChangeTreeData: EventEmitter<TreeItem | undefined>,
    private treeProvider: GoTreeItemProvider
  ) {
    this.onDidChangeTreeData = _onDidChangeTreeData.event;
  }

  getTreeItem(element: TreeItem) { return element; }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element instanceof GoDirItem) {
      let children = element.children;
      if (children) {
        return children;
      } else {
        const dir = element.dir;
        const newUri = Uri.file(dir.path);

        const dirContent = dir.exposeFiles ? await workspace.fs.readDirectory(newUri) : [];
        const files = dirContent.filter(([_, type]) => {
          return type !== FileType.Directory;
        }).map(([filename, _]) => {
          return new FileItem(filename, dir.path!!);
        });

        const subdirs = dir.children.map(d => new GoDirItem(d));
        const newChildren = [...subdirs, ...files];
        element.children = newChildren;
        return newChildren;
      }
    } else {
      return !element ? this.treeProvider.rootDirs : [];
    }
  }

  async getParent(element: TreeItem): Promise<TreeItem | undefined> {
    const id = element.id;
    if (id) {
      let nextLevelPath = id;
      let treeItemDir: GoDirItem | undefined;
      while (!treeItemDir) {
        const path = parse(nextLevelPath);
        const isRoot = path.root === path.dir && path.base.length === 0;
        if (isRoot) {
          break;
        }
        nextLevelPath = path.dir;
        treeItemDir = this.treeProvider.findDir(nextLevelPath);
      }
      if (treeItemDir) {
        return treeItemDir;
      }
    }
    return undefined;
  }
}


