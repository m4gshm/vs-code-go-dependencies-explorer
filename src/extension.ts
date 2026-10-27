import {
    commands, env, extensions, ExtensionContext, QuickPickItem, TreeItem, TreeView, Uri, window, workspace,
} from 'vscode';
import { createTreeView, getFsUriOfSelectedItem, GoDirItem } from "./treeView";
import { GoExec } from './goExec';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from './goExtension';
import { GitExtension } from './gitExtension';
import { GoPackageProvider } from './goPackageProvider';
import { getGoPackagePaths } from './goDirs';
import { IFindInFilesArgs } from './search';
import { GoDependenciesStateProvider } from './goDependenciesStateProvider';
import { importPathOfDir, modulePathOfDir } from './goModulePath';

let activated: boolean;
let activating: Promise<any> | undefined;

export async function activate(context: ExtensionContext): Promise<any> {
    const subscriptions = context.subscriptions;
    const goExtensionApi = await getGoExtensionAPI();
    if (goExtensionApi) {
        return await activateWithGo(context, goExtensionApi);
    } else {
        console.log('Waiting for Go extension to activate');
        return subscriptions.push(extensions.onDidChange(async e => {
            if (!activated && !activating) {
                const goExtensionApi = await getGoExtensionAPI();
                if (goExtensionApi && !activated) {
                    activating = activateWithGo(context, goExtensionApi)
                        .finally(() => { activating = undefined; });
                    await activating;
                }
            }
        }));
    }
}

async function activateWithGo(context: ExtensionContext, goExtensionApi: GoExtensionAPI) {
    try {
        const goExec = new GoExec(getGoBinPath(goExtensionApi));

        await registerGitRepoGuard(context, goExec);

        const goPackDirProvider = new GoPackageProvider(goExec);
        const treeProvider = await GoDependenciesStateProvider.new(goPackDirProvider);

        const { treeView, refresh } = await createTreeView(context, treeProvider);

        registerCommands(context, goExec, goPackDirProvider, treeProvider, treeView, refresh);

        console.log('Go Dependencies Explorer activated');
        await commands.executeCommand('setContext', 'go.dependencies.explorer.show', true);

        activated = true;
    } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`;
        void window.showErrorMessage(`Go Dependencies Explorer activation failed: ${message}`);
        throw err;
    }
}

async function registerGitRepoGuard(context: ExtensionContext, goExec: GoExec) {
    const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        return;
    }
    const gitExtensionApi = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    const gitApi = gitExtensionApi?.getAPI(1);
    if (!gitApi) {
        return;
    }
    const rootConfig = 'go.dependencies.explorer';
    const conf = workspace.getConfiguration(rootConfig);

    context.subscriptions.push(gitApi.onDidOpenRepository(async repository => {
        const preventOpenRepo = conf.get('prevent.open.git.repo');
        if (!preventOpenRepo || preventOpenRepo === 'off') {
            return;
        }
        const rootPath = repository.rootUri.fsPath;
        const { stdLibPath, modulePath } = await getGoPackagePaths(goExec);
        for (const dir of [stdLibPath, modulePath]) {
            if (rootPath.startsWith(dir) || dir.startsWith(rootPath)) {
                let close = true;
                if (preventOpenRepo === 'ask') {
                    const selection = await window.showWarningMessage(`Should the git repository "${rootPath}" be closed?`, 'Close', 'Cancel');
                    close = selection === 'Close';
                }
                if (close) {
                    console.debug(`closes git repository intersecting with package directory (repo: ${rootPath}, packages dir: ${dir})`);
                    await commands.executeCommand('git.close', repository);
                }
            }
        }
    }));
}

function registerCommands(context: ExtensionContext, goExec: GoExec, goPackDirProvider: GoPackageProvider, treeProvider: GoDependenciesStateProvider, treeView: TreeView<TreeItem>, refresh: (force?: boolean) => Promise<void>) {
    const subscriptions = context.subscriptions;

    const searchIn = async (filesToInclude: string) => {
        await commands.executeCommand("workbench.action.findInFiles", {
            filesToInclude,
            triggerSearch: false,
        } as IFindInFilesArgs);
    };

    const getModulesPath = async () => (await getGoPackagePaths(goExec)).modulePath;

    const checkModuleUpdates = async () => {
        const conf = workspace.getConfiguration('go.dependencies.explorer');
        if (!conf.get('check.module.updates', false)) {
            void window.showInformationMessage('Module update check is disabled. Enable "go.dependencies.explorer.check.module.updates" to use it.');
            return;
        }
        const goproxy = conf.get('updates.goproxy', '');
        await window.withProgress({ location: { viewId: "go.dependencies.explorer" }, title: 'Checking module updates…' }, async () => {
            try {
                await goPackDirProvider.fetchModuleUpdates(goproxy || undefined);
                await refresh(false);
            } catch (err) {
                const message = err instanceof Error ? err.message : `${err}`;
                void window.showWarningMessage(`Module update check failed: ${message} If the default proxy is unreachable, set "go.dependencies.explorer.updates.goproxy" to a reachable mirror (e.g. a corporate one) or "direct"/"off".`);
            }
        });
    };

    const goToPackage = async () => {
        const items: (QuickPickItem & { path: string })[] = treeProvider.dirs.map(dir => ({
            label: dir.name,
            description: dir.path,
            path: dir.path,
        }));
        const picked = await window.showQuickPick(items, {
            placeHolder: 'Go to package…',
            matchOnDescription: true,
        });
        if (picked) {
            await treeView.reveal({ id: picked.path }, { select: true, focus: false });
        }
    };

    subscriptions.push(
        commands.registerCommand('go.dependencies.refresh', async () => await refresh(true)),
        commands.registerCommand('go.dependencies.check.module.updates', checkModuleUpdates),
        commands.registerCommand('go.dependencies.go.to.package', goToPackage),
        commands.registerCommand('go.dependencies.search.in.all.directories', async _ => {
            const dirs = treeProvider.rootDirs
                .map(dir => getFsUriOfSelectedItem(dir))
                .filter(uri => uri !== undefined).map(uri => uri.fsPath)
                .join(",");
            await searchIn(dirs);
        }),
        commands.registerCommand('go.dependencies.search.in.directory', async item => {
            const uri = getFsUriOfSelectedItem(item);
            if (uri) {
                await searchIn(uri.fsPath);
            }
        }),
        commands.registerCommand('go.dependencies.open.in.workspace', async item => {
            if (item instanceof GoDirItem) {
                const path = item.id;
                if (path) {
                    const workspaceFolders = workspace.workspaceFolders;
                    workspace.updateWorkspaceFolders(workspaceFolders ? workspaceFolders.length : 0, null, { uri: Uri.file(path) });
                }
            }
        }),
        commands.registerCommand('go.dependencies.copy.path', async item => {
            await execCommandOnItem('copyFilePath', item);
        }),
        commands.registerCommand('go.dependencies.copy.import.path', async item => {
            const path = itemPathOf(item);
            if (!path) {
                return;
            }
            const importPath = importPathOfDir(path, await getModulesPath());
            if (importPath) {
                await env.clipboard.writeText(importPath);
            }
        }),
        commands.registerCommand('go.dependencies.open.on.pkg.go.dev', async item => {
            const path = itemPathOf(item);
            if (!path) {
                return;
            }
            const modulePath = modulePathOfDir(path, await getModulesPath());
            if (modulePath) {
                await commands.executeCommand('vscode.open', Uri.parse(`https://pkg.go.dev/${modulePath}`));
            }
        }),
        commands.registerCommand('go.dependencies.open.in.integrated.terminal', async item => {
            await execCommandOnItem('openInIntegratedTerminal', item);
        }),
    );

    ['mac', 'windows', 'linux'].forEach(os => {
        subscriptions.push(commands.registerCommand(`go.dependencies.reveal.in.os.${os}`, async item => {
            await execCommandOnItem('revealFileInOS', item);
        }));
    });
}

function itemPathOf(item: any): string | undefined {
    const uri = getFsUriOfSelectedItem(item);
    return uri?.fsPath;
}

export function deactivate() {
    console.log('Go Dependencies Explorer deactivated');
    activated = false;
}

async function execCommandOnItem(command: string, item: any) {
    const uri = getFsUriOfSelectedItem(item);
    if (uri) {
        await commands.executeCommand(command, uri);
    }
}
