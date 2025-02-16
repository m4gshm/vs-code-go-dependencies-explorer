import * as vscode from 'vscode';
import * as fs from 'fs';
import { Directory, flat } from './dir';
import path, { parse, join } from 'path';
import { GoExec } from './go';
import { log } from 'console';

const GIT_MOD = "git.mod";

export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly goExec: GoExec;
  private roots: Directory[];
  private flatDirs: Map<string, Directory>;
  private readonly treeView: vscode.TreeView<vscode.TreeItem>;
  private treeVisible = false;

  static async setup(ctx: vscode.ExtensionContext, goExec: GoExec) {
    const { roots, flatDirs } = await getGoDirs(goExec);
    return new this(ctx, goExec, roots, flatDirs);
  }

  private constructor(ctx: vscode.ExtensionContext, goExec: GoExec, dirs: Directory[], flatDirs: Map<string, Directory>) {
    this.goExec = goExec;
    this.roots = dirs;
    this.flatDirs = flatDirs;
    this.treeView = vscode.window.createTreeView("go.dependencies.explorer", {
      showCollapseAll: true, treeDataProvider: this,
    });
    this.subscriptions.push(this.treeView);
    this.subscriptions.push(this.treeView.onDidChangeSelection(event => {
      const selections = event.selection;
      for (const selection of selections) {
        const fileUri = selection.resourceUri;
        if (fileUri) {
          vscode.workspace.openTextDocument(fileUri).then(
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
          this.showFileOfActiveTabInTree(tab);
        }
        for (const tab of tabs.changed) {
          this.showFileOfActiveTabInTree(tab);
        }
      }
    }));

    this.syncActiveTabWithTree();

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
    vscode.commands.registerCommand('go.dependencies.refresh', () => {
      // this.refresh()
    });

    const modWatcher = vscode.workspace.createFileSystemWatcher('**/*.go');
    this.subscriptions.push(modWatcher);
    modWatcher.onDidCreate(e => this.updateDirs(e));
    modWatcher.onDidChange(e => this.updateDirs(e));
    modWatcher.onDidDelete(e => this.updateDirs(e));
  }

  private async updateDirs(e: vscode.Uri) {
    const fsPath = path.parse(e.fsPath);
    if (fsPath.ext === '.go') {
      const { roots, flatDirs } = await getGoDirs(this.goExec);
      this.roots = roots;
      this.flatDirs = flatDirs;
      this.refresh();
    }
  }

  private syncActiveTabWithTree() {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      this.showFileOfActiveTabInTree(activeTab);
    }
  }

  private showFileOfActiveTabInTree(tab: vscode.Tab) {
    if (tab.isActive) {
      const input = tab.input;
      const textInput = input instanceof vscode.TabInputText ? input as vscode.TabInputText : undefined;
      if (textInput) {
        const fsPath = textInput.uri.fsPath;
        const filePath = parse(fsPath);
        const dir = filePath.dir;
        if (this.flatDirs.get(dir)) {
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
      const dir = element.dir;
      const dirPath = dir.goPath;
      const dirContent = dirPath ? await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath)) : [];
      const files: vscode.TreeItem[] = dirContent.filter(([_, type]) => {
        return type !== vscode.FileType.Directory;
      }).map(([filename, _]) => {
        return new FileItem(filename, dirPath!!);
      });

      // const files: vscode.TreeItem[] = dirPath ? fs.readdirSync(dirPath)
      //   .filter(fileName => {
      //     const filePath = join(dirPath, fileName);
      //     const stat = fs.statSync(filePath);
      //     const dir = stat.isDirectory();
      //     return !dir;
      //   })
      //   .map(fileName => new FileItem(fileName, dirPath)) : [];
      const subdirs: vscode.TreeItem[] = dir.subdirs.map(d => new GoDirItem(d));
      return Promise.resolve([...subdirs, ...files]);
    } else if (!element) {
      return Promise.resolve(Array.from(this.roots).map(m => new GoDirItem(m)));
    } else {
      return Promise.resolve([]);
    }
  }

  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof FileItem) {
      const baseDir = this.flatDirs.get(element.filePath);
      return { id: baseDir } as vscode.TreeItem;
    } else {
      const id = element.id;
      if (id) {
        let nextLevelPath = id;
        let dir: Directory | undefined;
        while (!dir) {
          const path = parse(nextLevelPath);
          const isRoot = path.root === path.dir && path.base.length === 0;
          if (isRoot) {
            break;
          }

          nextLevelPath = path.dir;
          dir = this.flatDirs.get(nextLevelPath);
        }
        if (dir) {
          const baseDir = dir.parent ? join(dir.parent, dir.name) : dir.name;
          return { id: baseDir } as vscode.TreeItem;
        }
      }
    }
    return undefined;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<undefined> = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
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
  ) {
    super(dir.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = dir.parent ? join(dir.parent, dir.name) : dir.name;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }
}

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
  ) {
    super(fileName);
    const fillFiilePath = join(filePath, fileName);
    this.id = fillFiilePath;
    this.resourceUri = vscode.Uri.file(fillFiilePath);
  }
}

async function getGoDirs(goExec: GoExec) {
  const roots = Directory.create(await goExec.getAllDependencyDirs(getWorkspaceFileDirs()));
  const flatDirs = flat(undefined, roots);
  return { roots, flatDirs };
}

function getWorkspaceFileDirs() {
  const workspaceFolders = vscode.workspace.workspaceFolders?.filter(wf => wf.uri.scheme === "file").map(wf => wf.uri.fsPath);
  return workspaceFolders || [];
}

