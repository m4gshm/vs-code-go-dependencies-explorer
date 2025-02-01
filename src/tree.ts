import * as vscode from 'vscode';
import { getDependencyDirs } from './go';
import { DirHierarchyBuilder as DirHierarchyBuilder, Directory } from './dir';


export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly workspaceState: vscode.Memento;
  private readonly dirs: Directory[];

  constructor(ctx: vscode.ExtensionContext) {
    this.workspaceState = ctx.workspaceState;
    let dirPaths = getDependencyDirs();
    let hierarchy = DirHierarchyBuilder.create(dirPaths);
    let rootDir = hierarchy.getRoot();
    this.dirs = rootDir.name ? [rootDir] : rootDir.subdirs;
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
      return Promise.resolve(dir.subdirs.map(d => new GoDirItem(d)));
    } else if (!element) {
      return Promise.resolve(Array.from(this.dirs).map(m => new GoDirItem(m)));
    } else {
      return Promise.resolve([]);
    }
  }
}

class GoDirItem extends vscode.TreeItem {
  constructor(
    public readonly dir: Directory,
  ) {
    super(dir.name || "", vscode.TreeItemCollapsibleState.Collapsed);
  }
}
