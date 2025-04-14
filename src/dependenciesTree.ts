import { Directory, normalizeWinPath } from './dir';
import { parse, join } from 'path';
import { GoExec } from './go';
import { FsUriConverter, SCHEME } from './readonlyFs';
import {
  commands, EventEmitter, FileSystem, FileType, GlobPattern, Tab, TabInputText, Disposable,
  TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeView, Uri, window, workspace
} from 'vscode';
import { getGoModulesPackageDirs, getGoStdLibPackageDirs, GoPackageDirs } from './goPackageDirs';

export class GoDependenciesTreeProvider implements TreeDataProvider<TreeItem> {
  private readonly subscriptions: Disposable[] = [];
  private readonly treeView: TreeView<TreeItem>;
  private readonly goExec: GoExec;
  private readonly fs: FileSystem;
  private readonly uriConv: FsUriConverter;
  private readonly extPackagesDir: string;

  private readonly stdLibDirs: Map<string, GoDirItem>;
  private readonly stdLibRootDir: GoDirItem;
  private modulesRootDir!: GoDirItem;
  private modulesDirs: Map<string, GoDirItem> = new Map();
  private replacedRootDir!: GoDirItem | undefined;
  private replacedDirs: Map<string, GoDirItem> = new Map();

  static async setup(fs: FileSystem, uriConv: FsUriConverter, goExec: GoExec, stdLibDir: string, extPackagesDir: string, modules: GoPackageDirs) {
    const std = await getGoStdLibPackageDirs(stdLibDir);
    return new this(fs, uriConv, goExec, std, modules, extPackagesDir);
  }

  private constructor(fs: FileSystem, uriConv: FsUriConverter,
    goExec: GoExec, std: GoPackageDirs, modules: GoPackageDirs, extPackagesDir: string
  ) {
    this.fs = fs;
    this.uriConv = uriConv;
    this.goExec = goExec;
    this.stdLibRootDir = newGoDirItem(std.root);
    this.stdLibDirs = convertToGoDirs(std.flatDirs);
    this.extPackagesDir = extPackagesDir;
    this.initModulesDir(modules);
    this.treeView = window.createTreeView("go.dependencies.explorer", {
      showCollapseAll: true, treeDataProvider: this,
    });
    this.subscriptions.push(this.treeView);
    this.subscriptions.push(this.treeView.onDidChangeSelection(async event => {
      const selections = event.selection;
      for (const selection of selections) {
        const fileUri = selection.resourceUri;
        if (fileUri) {
          const newUri = this.uriConv.toFsUri(fileUri);
          await workspace.openTextDocument(newUri || fileUri).then(
            document => window.showTextDocument(document)
          );
        }
      }
    }));

    this.subscriptions.push(this.treeView.onDidChangeVisibility(async event => {
      if (event.visible) {
        this.syncActiveTabWithTree();
      }
    }));

    this.subscriptions.push(window.tabGroups.onDidChangeTabs(tabs => {
      if (this.treeView.visible) {
        for (const tab of tabs.opened) {
          this.selectFileOfActiveTabInTree(tab);
        }
        for (const tab of tabs.changed) {
          this.selectFileOfActiveTabInTree(tab);
        }
      }
    }));

    this.subscriptions.push(commands.registerCommand('go.dependencies.copy.path', async item => {
      await execCommandOnItem('copyFilePath', item, this.uriConv);
    }));

    this.subscriptions.push(commands.registerCommand('go.dependencies.open.in.integrated.terminal', async item => {
      await execCommandOnItem('openInIntegratedTerminal', item, this.uriConv);
    }));

    ['mac', 'windows', 'linux'].forEach(os => {
      this.subscriptions.push(commands.registerCommand(`go.dependencies.reveal.in.os.${os}`, async item => {
        await execCommandOnItem('revealFileInOS', item, this.uriConv);
      }));
    });

    commands.registerCommand('go.dependencies.refresh', async () => await this.refresh());
    this.watchChanges();

    async function execCommandOnItem(command: string, item: any, uriConv: FsUriConverter) {
      let uri = getFsUriOfSelectedItem(item, uriConv);
      if (uri) {
        await commands.executeCommand(command, uri);
      }
      function getFsUriOfSelectedItem(item: any, uriConv: FsUriConverter) {
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
    }
    commands.executeCommand('setContext', 'go.dependencies.explorer.show', true);
  }

  private watchChanges() {
    const filePattern = '**/go.{mod,sum}';
    const gofileWatcher = workspace.createFileSystemWatcher(filePattern);
    this.subscriptions.push(gofileWatcher);
    gofileWatcher.onDidCreate(e => this.handleFileEvent('create', filePattern, e));
    gofileWatcher.onDidChange(e => this.handleFileEvent('change', filePattern, e));
    gofileWatcher.onDidDelete(e => this.handleFileEvent('delete', filePattern, e));
    return gofileWatcher;
  }

  private async handleFileEvent(op: string, filePattern: GlobPattern, event: Uri) {
    console.debug(`handleFileEvent: ${op}, ${filePattern}, ${event}`);
    await this.refresh();
  }

  private initModulesDir(modules: GoPackageDirs) {
    this.modulesRootDir = newGoDirItem(modules.root);
    this.modulesDirs = convertToGoDirs(modules.flatDirs);
    this.replacedRootDir = modules.rootReplaced ? newGoDirItem(modules.rootReplaced) : undefined;
    this.replacedDirs = convertToGoDirs(modules.flatReplaced);
  }

  private syncActiveTabWithTree() {
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      this.selectFileOfActiveTabInTree(activeTab);
    }
  }

  private selectFileOfActiveTabInTree(tab: Tab) {
    if (tab.isActive) {
      const input = tab.input;
      const textInput = input instanceof TabInputText ? input as TabInputText : undefined;
      if (textInput) {
        const fileUri = textInput.uri;
        const depUri = this.uriConv.toDepUri(fileUri);
        if (depUri) {
          const fsPath = depUri.fsPath;
          const filePath = parse(fsPath);
          const dir = filePath.dir;
          if (this.isPackageDir(dir)) {
            commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
            const openPath = depUri.fsPath;//this.uriConv.toFsUri(fileUri).fsPath;
            this.treeView?.reveal({
              id: openPath,
              focus: true,
              select: true,
            } as TreeItem);
          }
        }
      }
    }
  }

  private isPackageDir(dir: string): boolean {
    return this.stdLibDirs.has(dir) || this.modulesDirs.has(dir) || this.replacedDirs.has(dir);
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element instanceof GoDirItem) {
      let children = element.children;
      if (children) {
        return Promise.resolve(children);
      }
      const dir = element.dir;
      const dirUri = dependencyUri(dir.path);
      const newUri = this.uriConv.toFsUri(dirUri);
      if (!newUri) {
        throw new Error(`Bad dependency dir "${dirUri}"`);
      }
      const dirContent = dir.findFiles ? await this.fs.readDirectory(newUri) : [];
      const files: TreeItem[] = dirContent.filter(([_, type]) => {
        return type !== FileType.Directory;
      }).map(([filename, _]) => {
        return new FileItem(filename, dir.path!!);
      });
      const subdirs: TreeItem[] = dir.subdirs.map(d => newGoDirItem(d));
      children = [...subdirs, ...files];
      element.children = children;
      return Promise.resolve(children);
    } else if (!element) {
      const roots: GoDirItem[] = [this.stdLibRootDir];
      const modules = this.modulesRootDir;
      if (modules) {
        roots.push(modules);
      }
      const replaced = this.replacedRootDir;
      if (replaced) {
        roots.push(replaced);
      }
      return Promise.resolve(roots);
    } else {
      return Promise.resolve([]);
    }
  }

  getParent(element: TreeItem): TreeItem | undefined {
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
        treeItemDir = this.getGoDirItem(nextLevelPath);
      }
      if (treeItemDir) {
        return treeItemDir;
      }
    }
    return undefined;
  }

  private _onDidChangeTreeData: EventEmitter<undefined> = new EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private getGoDirItem(nextLevelPath: string): GoDirItem | undefined {
    return this.stdLibDirs.get(nextLevelPath) || this.modulesDirs.get(nextLevelPath) || this.replacedDirs.get(nextLevelPath);
  }

  async refresh() {
    this.initModulesDir(await getGoModulesPackageDirs(this.extPackagesDir, this.goExec));
    this._onDidChangeTreeData.fire(undefined);
  }

  public dispose() {
    this._onDidChangeTreeData.dispose();
    this.subscriptions.forEach(s => s.dispose());
  }
}

function newGoDirItem(dir: Directory): GoDirItem {
  return new GoDirItem(dir);
}

function convertToGoDirs(flatDirs: Map<string, Directory>): Map<string, GoDirItem> {
  return new Map(Array.from(flatDirs.entries()).map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]));
}

function dependencyUri(path: string) {
  return replaceUriScheme(SCHEME, Uri.file(path));
}

function replaceUriScheme(newScheme: string, uri: Uri) {
  if (newScheme && uri.scheme !== newScheme) {
    return Uri.from({
      scheme: newScheme,
      authority: uri.authority,
      path: uri.path,
      query: uri.query,
      fragment: uri.fragment,
    });
  }
  return uri;
}

export function getStdLibDir(env: any) {
  const goRoot = env['GOROOT'];
  const stdLibDir = normalizeWinPath(join(`${goRoot}`, 'src'));
  return stdLibDir;
}

export async function getExtPackagesDir(goExec: GoExec) {
  const env = await goExec.getEnv();
  const goModCache = env['GOMODCACHE'];
  const packagesDir = normalizeWinPath(`${goModCache}`);
  return packagesDir;
}


class GoDirItem extends TreeItem {
  constructor(
    public readonly dir: Directory,
    public children: TreeItem[] | undefined = undefined
  ) {
    super(dir.label, TreeItemCollapsibleState.Collapsed);
    this.id = dir.path;
    this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    this.tooltip = dir.label;
  }
}

class FileItem extends TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
  ) {
    super(fileName);
    const fillFilePath = join(filePath, fileName);
    this.id = fillFilePath;
    this.resourceUri = dependencyUri(fillFilePath);
    this.tooltip = fileName;
  }
}
