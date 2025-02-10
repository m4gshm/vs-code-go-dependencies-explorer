import * as vscode from 'vscode';
import * as fs from 'fs';
import { Directory } from './dir';
import { parse, join } from 'path';

export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly roots: Directory[];
  private readonly flatDirs: Map<string, Directory>;

  constructor(ctx: vscode.ExtensionContext, dirs: Directory[], flatDirs: Map<string, Directory>) {
    this.roots = dirs;
    this.flatDirs = flatDirs;
  }

  static async setup(ctx: vscode.ExtensionContext, dirs: Directory[]) {
    let flatDirs = new Map((dirs.flatMap(d => [...d.flatDirs().entries()])));
    const provider = new this(ctx, dirs, flatDirs);

    const treeView = vscode.window.createTreeView("go.dependencies.explorer", {
      showCollapseAll: true,
      treeDataProvider: provider,
    });
    ctx.subscriptions.push(treeView);

    treeView.onDidChangeSelection(event => {
      const selections = event.selection;
      for (const selection of selections) {
        const fileUri = selection.resourceUri;
        if (fileUri) {
          vscode.workspace.openTextDocument(fileUri).then(
            document => vscode.window.showTextDocument(document)
          );
        }
      }
    });

    vscode.window.tabGroups.onDidChangeTabs(async tabs => {
      for (const tab of tabs.opened) {
        await selectIfDependency(tab);
      }
      for (const tab of tabs.changed) {
        await selectIfDependency(tab);
      }

      async function selectIfDependency(tab: vscode.Tab) {
        if (tab.isActive) {
          const input = tab.input;
          const textInput = input instanceof vscode.TabInputText ? input as vscode.TabInputText : undefined;
          if (textInput) {
            const fsPath = textInput.uri.fsPath;
            const filePath = parse(fsPath);
            const dir = filePath.dir;
            if (flatDirs.get(dir)) {
              await treeView.reveal({
                id: fsPath,
              } as vscode.TreeItem);
            }
          }
        }
      }
    });
    return provider;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element instanceof GoDirItem) {
      let dir = element.dir;
      let dirPath = dir.goPath;
      let files: vscode.TreeItem[] = dirPath ? fs.readdirSync(dirPath)
        .filter(fileName => {
          const filePath = join(dirPath, fileName);
          const stat = fs.statSync(filePath);
          const dir = stat.isDirectory();
          return !dir;
        })
        .map(fileName => new FileItem(fileName, dirPath)) : [];
      let subdirs: vscode.TreeItem[] = dir.subdirs.map(d => new GoDirItem(d));
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
      let id = element.id;
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
