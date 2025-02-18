import * as vscode from 'vscode';
import * as fs from 'fs';
import { Directory, flat } from './dir';
import path, { parse, join } from 'path';
import { GoExec } from './go';
import { getWorkspaceFileDirs } from './vscodeUtils';
import { SCHEME } from './readonlyFs';
import { log } from 'console';

const GIT_MOD = "git.mod";

export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly treeView: vscode.TreeView<vscode.TreeItem>;
  private readonly goExec: GoExec;
  private readonly filesystemScheme: string;
  private roots: Directory[] = [];
  private dirItems: Map<string, GoDirItem> = new Map();
  private treeVisible = false;

  static async setup(goExec: GoExec, filesystemScheme: string) {
    const { roots, flatDirs } = await getGoDirs(goExec);
    return new this(goExec, filesystemScheme, roots, flatDirs);
  }

  private constructor(goExec: GoExec, filesystemScheme: string, roots: Directory[], flatDirs: Map<string, Directory>) {
    this.goExec = goExec;
    this.initDirs(roots, flatDirs);
    this.filesystemScheme = filesystemScheme;
    this.treeView = vscode.window.createTreeView("go.dependencies.explorer", {
      showCollapseAll: true, treeDataProvider: this,
    });
    this.subscriptions.push(this.treeView);
    this.subscriptions.push(this.treeView.onDidChangeSelection(async event => {
      const selections = event.selection;
      for (const selection of selections) {
        const fileUri = selection.resourceUri;
        if (fileUri) {
          const newUri = replaceUriScheme(fileUri, 'file');
          await vscode.workspace.openTextDocument(newUri).then(
            document => vscode.window.showTextDocument(document)
          );
        }
      }
    }));

    this.subscriptions.push(this.treeView.onDidChangeVisibility(async event => {
      const visible = event.visible;
      this.treeVisible = visible;
      if (this.treeVisible) {
        this.syncActiveTabWithTree();
      }
    }));

    this.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(tabs => {
      if (this.treeVisible) {
        for (const tab of tabs.opened) {
          this.selectFileOfActiveTabInTree(tab);
        }
        for (const tab of tabs.changed) {
          this.selectFileOfActiveTabInTree(tab);
        }
      }
    }));

    this.subscriptions.push(vscode.commands.registerCommand("go.dependencies.open.in.integrated.terminal", async item => {
      if (item instanceof FileItem) {
        const uri = vscode.Uri.file(item.filePath);
        await vscode.commands.executeCommand('openInIntegratedTerminal', uri);
      } else if (item instanceof GoDirItem) {
        const path = item.id;
        if (path) {
          const uri = vscode.Uri.file(path);
          await vscode.commands.executeCommand('openInIntegratedTerminal', uri);
        } else {
          console.warn("undefined path of item: " + item);
        }
      } else {
        console.warn("unexpected item type: " + item);
      }
    }));
    vscode.commands.registerCommand('go.dependencies.refresh', async () => {
      await this.refresh();
    });

    this.watchChanges('**/*.go');
    this.watchChanges('go.{mod,sum}');
  }

  private watchChanges(filePattern: string) {
    const gofileWatcher = vscode.workspace.createFileSystemWatcher(filePattern);
    this.subscriptions.push(gofileWatcher);
    gofileWatcher.onDidCreate(e => this.updateDirs(filePattern, e));
    gofileWatcher.onDidChange(e => this.updateDirs(filePattern, e));
    gofileWatcher.onDidDelete(e => this.updateDirs(filePattern, e));
  }

  private async updateDirs(filePattern: string, event: vscode.Uri) {
    const fsPath = path.parse(event.fsPath);
    if (fsPath.ext === '.go' || (fsPath.name === 'go' && (fsPath.ext === 'mod' || fsPath.ext === 'sum'))) {
      await this.refresh();
    }
  }

  private initDirs(roots: Directory[], flatDirs: Map<string, Directory>) {
    this.roots = roots;
    this.dirItems = new Map(Array.from(flatDirs.entries()).map(([k, v], _) => [k, new GoDirItem(v)]));
  }

  private syncActiveTabWithTree() {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      this.selectFileOfActiveTabInTree(activeTab);
    }
  }

  private selectFileOfActiveTabInTree(tab: vscode.Tab) {
    if (tab.isActive) {
      const input = tab.input;
      const textInput = input instanceof vscode.TabInputText ? input as vscode.TabInputText : undefined;
      if (textInput) {
        const fsPath = textInput.uri.fsPath;
        const filePath = parse(fsPath);
        const dir = filePath.dir;
        if (this.dirItems.get(dir)) {
          vscode.commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
          this.treeView?.reveal({
            id: fsPath,
            focus: true,
            select: true,
          } as vscode.TreeItem);
        }
      }
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof GoDirItem) {
      let children = element.children;
      if (children) {
        return Promise.resolve(children);
      }
      const dir = element.dir;
      const dirPath = dir.goPath;
      const dirContent = dirPath ? await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath)) : [];
      const files: vscode.TreeItem[] = dirContent.filter(([_, type]) => {
        return type !== vscode.FileType.Directory;
      }).map(([filename, _]) => {
        return new FileItem(filename, dirPath!!, this.filesystemScheme);
      });
      const subdirs: vscode.TreeItem[] = dir.subdirs.map(d => new GoDirItem(d));
      children = [...subdirs, ...files];
      element.children = children;
      return Promise.resolve(children);
    } else if (!element) {
      return Promise.resolve(Array.from(this.roots).map(m => new GoDirItem(m)));
    } else {
      return Promise.resolve([]);
    }
  }

  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
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
        treeItemDir = this.dirItems.get(nextLevelPath);
      }
      if (treeItemDir) {
        return treeItemDir;
      }
    }
    return undefined;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<undefined> = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  async refresh() {
    const goDirs = await getGoDirs(this.goExec);
    this.initDirs(goDirs.roots, goDirs.flatDirs);
    this._onDidChangeTreeData.fire(undefined);
  }

  public dispose() {
    this._onDidChangeTreeData.dispose();
    this.subscriptions.forEach(s => s.dispose());
  }
}

class GoDirItem extends vscode.TreeItem {
  constructor(
    public readonly dir: Directory,
    public children: vscode.TreeItem[] | undefined = undefined
  ) {
    super(dir.label, vscode.TreeItemCollapsibleState.Collapsed);
    const fullPath = dir.parent ? join(dir.parent, dir.name) : dir.name;
    this.id = fullPath;
    this.tooltip = fullPath;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }
}

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
    public readonly filesystemScheme: string | undefined = undefined,
  ) {
    super(fileName);
    const fillFilePath = join(filePath, fileName);
    let uri = vscode.Uri.file(fillFilePath);
    uri = replaceUriScheme(uri, filesystemScheme);
    this.id = fillFilePath;
    this.resourceUri = uri;
  }
}

function replaceUriScheme(uri: vscode.Uri, newScheme: string | undefined) {
  if (newScheme && uri.scheme !== newScheme) {
    return vscode.Uri.from({
      scheme: newScheme,
      authority: uri.authority,
      path: uri.path,
      query: uri.query,
      fragment: uri.fragment,
    });
  }
  return uri;
}

async function getGoDirs(goExec: GoExec): Promise<GoDirs> {
  const env = await goExec.getEnv();

  const goRoot = env['GOROOT'];
  const goModCache = env['GOMODCACHE'];

  const root = new Map([
    [`${goRoot}` + path.sep + 'src', 'Standard library'],
    [`${goModCache}`, 'External packages'],
  ]);
  try {
    const depDirs = await goExec.getAllDependencyDirs(getWorkspaceFileDirs());
    const roots = Directory.create(depDirs, root);
    const flatDirs = flat(undefined, roots);
    return { roots: roots, flatDirs: flatDirs };
  } catch (err) {
    const message = err instanceof Error ? err.message : `${err}`;
    vscode.window.showErrorMessage(message);
    return { roots: [], flatDirs: new Map() };
  }
}

interface GoDirs {
  roots: Directory[];
  flatDirs: Map<string, Directory>;
}



