import * as vscode from 'vscode';
import * as fs from 'fs';
import { getDependencyDirs } from './go';
import {  Directory } from './dir';
import { GoDependenciesFS as GoDependenciesFS } from './fs';

export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly dirs: Directory[];

  constructor(ctx: vscode.ExtensionContext) {
    let dirPaths = getDependencyDirs();
    this.dirs = Directory.create(dirPaths);
  }

  static setup(ctx: vscode.ExtensionContext) {

    const provider = new this(ctx);
    ctx.subscriptions.push(
      vscode.window.registerTreeDataProvider('go.dependencies.explorer', provider)//,
      // registerCommand('go.dependencies.explorer.refresh', () => provider.update(true)),
      // registerCommand('go.dependencies.explorer.open', (item) => provider.open(item)),
      // registerCommand('go.workspace.editEnv', (item) => provider.editEnv(item)),
      // registerCommand('go.workspace.resetEnv', (item) => provider.resetEnv(item))
    );
    // vscode.commands.executeCommand('setContext', 'go.showExplorer', true);
    return provider;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element as GoDirItem) {
      let dirItem = element as GoDirItem;
      let dir = dirItem.dir;
      let path = dir.path;
      let files: vscode.TreeItem[] = path ? fs.readdirSync(path).map(fileName => new FileItem(fileName)) : [];
      let subdirs: vscode.TreeItem[] = dir.subdirs.map(d => new GoDirItem(d));
      return Promise.resolve([...subdirs, ...files]);
    } else if (!element) {
      return Promise.resolve(Array.from(this.dirs).map(m => new GoDirItem(m)));
    } else {
      return Promise.resolve([]);
    }
  }
}

class GoDirItem extends vscode.TreeItem {
  iconPath = new vscode.ThemeIcon('symbol-folder');
  constructor(
    public readonly dir: Directory,
  ) {
    super(dir.name || "", vscode.TreeItemCollapsibleState.Collapsed);
  }
}

class FileItem extends vscode.TreeItem {
  iconPath = vscode.ThemeIcon.File;
  constructor(
    public readonly fileName: string,
  ) {
    super(fileName);
  }
}
