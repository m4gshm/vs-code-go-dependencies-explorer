import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(ctx: vscode.ExtensionContext) { }


  static setup(ctx: vscode.ExtensionContext) {
    const provider = new this(ctx);
    const {
      window: { registerTreeDataProvider },
      commands: { registerCommand, executeCommand }
    } = vscode;
    ctx.subscriptions.push(
      vscode.window.registerTreeDataProvider('go.explorer', provider)//,
      // registerCommand('go.explorer.refresh', () => provider.update(true)),
      // registerCommand('go.explorer.open', (item) => provider.open(item)),
      // registerCommand('go.workspace.editEnv', (item) => provider.editEnv(item)),
      // registerCommand('go.workspace.resetEnv', (item) => provider.resetEnv(item))
    );
    return provider;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    // if (!this.workspaceRoot) {
    vscode.window.showInformationMessage('No dependency in empty workspace');
    return Promise.resolve([]);
    // }

    if (element) {
      return Promise.resolve([]);
      // return Promise.resolve(
      //   this.getDepsInPackageJson(
      //     path.join(this.workspaceRoot, 'node_modules', element.label, 'package.json')
      //   )
      // );
    } else {
      // const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
      // if (this.pathExists(packageJsonPath)) {
      //   return Promise.resolve(this.getDepsInPackageJson(packageJsonPath));
      // } else {
      //   vscode.window.showInformationMessage('Workspace has no package.json');
      //   return Promise.resolve([]);
      // }
    }
  }
}


