import * as vscode from 'vscode';
import { GoDependenciesTreeProvider } from "./dependenciesTree";
import { GoExec } from './go';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from './goExtension';
import { GoDepFileSystemProvider, newFsUriConverter as newFsUriConverter } from './goDependencyFS';
import { GitExtension } from './gitExtension';
import { GoPackageDirectoriesProvider } from './goPackageDirectoriesProvider';
import { SCHEME } from './goDependencyFSCommon';
import { getExtPackagesDir, getStdLibDir } from './goEnv';

var activated: boolean;

export async function activate(context: vscode.ExtensionContext) {
    const goExtensionApi = await getGoExtensionAPI();
    if (goExtensionApi) {
        await activateWithGo(goExtensionApi, context);
    } else {
        console.log('Waiting for Go extension to activate');
        context.subscriptions.push(vscode.extensions.onDidChange(async e => {
            if (!activated) {
                const goExtensionApi = await getGoExtensionAPI();
                if (goExtensionApi) {
                    await activateWithGo(goExtensionApi, context);
                }
            }
        }));
    }
    return { context };
}

async function activateWithGo(goExtensionApi: GoExtensionAPI, context: vscode.ExtensionContext) {
    const goExec = new GoExec(getGoBinPath(goExtensionApi));

    const env = await goExec.getEnv();
    const stdLibDir = getStdLibDir(env);
    const extPackagesDir = getExtPackagesDir(env);

    const rootConfig = 'go.dependencies.explorer';
    const conf = vscode.workspace.getConfiguration(rootConfig);

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
        const isActive = gitExtension.isActive;
        const gitExtensionApi: GitExtension | undefined = !isActive ? await gitExtension.activate() : gitExtension.exports;
        const gitApi = gitExtensionApi?.getAPI(1);
        if (gitApi) {
            context.subscriptions.push(gitApi?.onDidOpenRepository(repository => {
                const preventOpenRepo = conf.get('prevent.open.git.repo');
                if (!(!preventOpenRepo || preventOpenRepo === 'off')) {
                    const rootUri = repository.rootUri;
                    const rootPath = rootUri.fsPath;
                    [stdLibDir, extPackagesDir].forEach(async dir => {
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

    const goPackDirProvider = new GoPackageDirectoriesProvider(goExec, stdLibDir, extPackagesDir);
    const uriConv = newFsUriConverter(stdLibDir, extPackagesDir, goPackDirProvider);
    const fsProvider = new GoDepFileSystemProvider(vscode.workspace.fs, uriConv.toFsUri);

    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, fsProvider, { isReadonly: true }));
    context.subscriptions.push(await GoDependenciesTreeProvider.setup(vscode.workspace.fs, uriConv, goPackDirProvider));

    console.log('Go Dependencies Explorer activated');
    activated = true;
}

export function deactivate() {
    console.log('Go Dependencies Explorer deactivated');
    activated = false;
}
