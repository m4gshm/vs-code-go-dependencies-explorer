import * as vscode from 'vscode';
import { createTreeView, getFsUriOfSelectedItem } from "./treeView";
import { GoExec } from './goExec';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from './goExtension';
import { GitExtension } from './gitExtension';
import { GoPackageProvider } from './goPackageProvider';
import { getGoPackagePaths } from './goDirs';
import { commands, Uri, workspace } from 'vscode';
import { IFindInFilesArgs } from './search';
import { GoDirItem, GoTreeItemProvider } from './goTreeItemProvider';

let activated: boolean;

export async function activate(context: vscode.ExtensionContext): Promise<any> {
    const subscriptions = context.subscriptions;
    const goExtensionApi = await getGoExtensionAPI();
    if (goExtensionApi) {
        return await activateWithGo(context, goExtensionApi);
    } else {
        console.log('Waiting for Go extension to activate');
        return subscriptions.push(vscode.extensions.onDidChange(async e => {
            if (!activated) {
                const goExtensionApi = await getGoExtensionAPI();
                if (goExtensionApi) {
                    await activateWithGo(context, goExtensionApi);
                }
            }
        }));
    }
}

async function activateWithGo(context: vscode.ExtensionContext, goExtensionApi: GoExtensionAPI,) {
    const goExec = new GoExec(getGoBinPath(goExtensionApi));

    const rootConfig = 'go.dependencies.explorer';
    const conf = vscode.workspace.getConfiguration(rootConfig);

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
        const isActive = gitExtension.isActive;
        const gitExtensionApi: GitExtension | undefined = !isActive ? await gitExtension.activate() : gitExtension.exports;
        const gitApi = gitExtensionApi?.getAPI(1);
        if (gitApi) {
            context.subscriptions.push(gitApi.onDidOpenRepository(async repository => {
                const preventOpenRepo = conf.get('prevent.open.git.repo');
                if (!(!preventOpenRepo || preventOpenRepo === 'off')) {
                    const rootUri = repository.rootUri;
                    const rootPath = rootUri.fsPath;

                    const { stdLibPath: stdLibPath, modulePath: modulesPath } = getGoPackagePaths(goExec);
                    [stdLibPath, modulesPath].forEach(async dir => {
                        if (rootPath.startsWith(dir) || dir.startsWith(rootPath)) {
                            let close = true;
                            if (preventOpenRepo === 'ask') {
                                const selection = await vscode.window.showWarningMessage(`Should the git repository "${rootPath}" be closed?`, 'Close', 'Cancel');
                                close = selection === 'Close';
                            }
                            if (close) {
                                console.debug(`closes git repository intersecting with package directory (repo: ${rootPath}, packages dir: ${dir})`);
                                await vscode.commands.executeCommand('git.close', repository);
                            }
                        }
                    });
                }
            }));
        }
    }

    const goPackDirProvider = new GoPackageProvider(goExec);

    const treeProvider = await GoTreeItemProvider.new(goPackDirProvider);

    const { refresh } = await createTreeView(context, treeProvider);

    const subscriptions = context.subscriptions;

    subscriptions.push(
        commands.registerCommand('go.dependencies.refresh', async () => await refresh()),
        commands.registerCommand('go.dependencies.search.in.all.directories', async _ => {
            const rootDirs = treeProvider.rootDirs;
            const dirs = rootDirs.map(dir => getFsUriOfSelectedItem(dir))
                .filter(d => d !== undefined).map(uri => uri.fsPath)
                .reduce((l, r) => l + "," + r);

            await commands.executeCommand("workbench.action.findInFiles", {
                filesToInclude: dirs,
                triggerSearch: false,
            } as IFindInFilesArgs);
        }), commands.registerCommand('go.dependencies.search.in.directory', async item => {
            const uri = getFsUriOfSelectedItem(item);
            if (uri) {
                await commands.executeCommand("workbench.action.findInFiles", {
                    filesToInclude: uri.fsPath,
                    triggerSearch: false,
                } as IFindInFilesArgs);
            }
        }), commands.registerCommand('go.dependencies.open.in.workspace', async item => {
            if (item instanceof GoDirItem) {
                const path = item.id;
                const uri = path ? Uri.file(path) : undefined;
                if (uri) {
                    const workspaceFolders = workspace.workspaceFolders;
                    workspace.updateWorkspaceFolders(workspaceFolders ? workspaceFolders.length : 0, null, { uri: uri, });
                }
            }
        }), commands.registerCommand('go.dependencies.copy.path', async item => {
            await execCommandOnItem('copyFilePath', item);
        }), commands.registerCommand('go.dependencies.open.in.integrated.terminal', async item => {
            await execCommandOnItem('openInIntegratedTerminal', item);
        }),
    );

    ['mac', 'windows', 'linux'].forEach(os => {
        subscriptions.push(commands.registerCommand(`go.dependencies.reveal.in.os.${os}`, async item => {
            await execCommandOnItem('revealFileInOS', item);
        }));
    });

    console.log('Go Dependencies Explorer activated');
    commands.executeCommand('setContext', 'go.dependencies.explorer.show', true);

    activated = true;
}

export function deactivate() {
    console.log('Go Dependencies Explorer deactivated');
    activated = false;
}

async function execCommandOnItem(command: string, item: any) {
    let uri = getFsUriOfSelectedItem(item);
    if (uri) {
        await commands.executeCommand(command, uri);
    }
}
