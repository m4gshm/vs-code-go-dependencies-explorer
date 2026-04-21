import { parse, join } from 'path';
import { FsUriConverter } from './goDependenciesFsProvider';
import {
  commands, EventEmitter, FileType, GlobPattern, Tab, TabInputText,
  TreeItem,
  Uri, window, workspace,
  ExtensionContext,
  TreeDataProvider, Event,
  WorkspaceFolder
} from 'vscode';
import { dependencyUri, FileItem, GoTreeItemProvider, GoDirItem } from './goTreeItemProvider';

export async function createTreeView(ctx: ExtensionContext, uriConv: FsUriConverter, treeProvider: GoTreeItemProvider) {
  const onDidChangeTreeData = new EventEmitter<undefined>();

  const subscriptions = ctx.subscriptions;
  subscriptions.push(onDidChangeTreeData);

  const treeView = window.createTreeView("go.dependencies.explorer", {
    showCollapseAll: true, treeDataProvider: new GoTreeDataProvider(onDidChangeTreeData, uriConv, treeProvider),
  });
  subscriptions.push(treeView);

  subscriptions.push(treeView.onDidChangeSelection(async event => {
    const selections = event.selection;
    for (const selection of selections) {
      const fileUri = selection.resourceUri;
      if (fileUri) {
        const newUri = uriConv.toFsUri(fileUri);
        await workspace.openTextDocument(newUri || fileUri).then(
          document => window.showTextDocument(document)
        );
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
        if (workspaceFolder) {
          console.trace(`the active tab belongs to the workspace: ${fileUri}`);
        } else {
          const fsPath = fileUri.fsPath;
          const filePath = parse(fsPath);
          const dir = filePath.dir;
          const isPackageDir = treeProvider.findDir(dir) !== undefined;
          // const depUri = uriConv.toDepUri(fileUri);
          // if (depUri) {
            // const fsPath = depUri.fsPath;
            // const filePath = parse(fsPath);
            // const dir = filePath.dir;
            // const isPackageDir = treeProvider.findDir(dir) !== undefined;
            if (isPackageDir) {
              console.debug(`set readonly dependency file ${fileUri}`);
              //workbench.action.files.resetActiveEditorReadonlyInSession
              commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
              // const openPath = depUri.fsPath;
              const openPath = fsPath;
              treeView.reveal({
                id: openPath,
                focus: true,
                select: true,
              } as TreeItem);
            }
          // }
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
  commands.executeCommand('setContext', 'go.dependencies.explorer.show', true);
}

export function getFsUriOfSelectedItem(item: any, uriConv: FsUriConverter) {
  let uri: Uri | undefined;
  if (item instanceof FileItem) {
    uri = dependencyUri(join(item.filePath, item.fileName));
  } else if (item instanceof GoDirItem) {
    const path = item.id;
    if (path) {
      uri = dependencyUri(path);
    } else {
      console.warn("undefined path of item: " + item);
    }
  } else {
    console.warn("unexpected item type: " + item);
  }
  if (uri) {
    uri = uriConv.toFsUri(uri);
  }
  return uri;
}

export class GoTreeDataProvider implements TreeDataProvider<TreeItem> {
  readonly onDidChangeTreeData: Event<TreeItem | undefined>;

  constructor(
    _onDidChangeTreeData: EventEmitter<TreeItem | undefined>,
    private uriConv: FsUriConverter,
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
        const newUri =  Uri.file(dir.path);
        const dirUri = dependencyUri(dir.path);
        // const newUri = this.uriConv.toFsUri(dirUri);
        // if (!newUri) {
          // throw new Error(`Bad dependency dir "${dirUri}"`);
        // }
        const dirContent = dir.findFiles ? await workspace.fs.readDirectory(dirUri) : [];
        const files = dirContent.filter(([_, type]) => {
          return type !== FileType.Directory;
        }).map(([filename, _]) => {
          return new FileItem(filename, dir.path!!);
        });
        const subdirs = dir.subdirs.map(d => new GoDirItem(d));
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


