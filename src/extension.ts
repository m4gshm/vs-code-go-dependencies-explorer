import * as vscode from 'vscode';
import { getExtPackagesDir, getStdLibDir, GoDependenciesTreeProvider } from "./dependenciesTree";
import { GoExec } from './go';
import { GoExtensionAPI } from './goExtension';
import { GoDepFileSystemProvider, newFsUriConverter as newFsUriConverter, SCHEME } from './readonlyFs';
import { GitExtension } from './gitExtension';
import { GoPackageDirectoriesProvider } from './goPackageDirectoriesProvider';

export async function activate(context: vscode.ExtensionContext) {
    const goExtension = vscode.extensions.getExtension('golang.go');
    if (!goExtension) {
        throw Error("'golang.go' is not installed.");
    }
    const isActive = goExtension.isActive;
    const goExtensionApi: GoExtensionAPI | undefined = !isActive ? await goExtension.activate() : goExtension.exports;
    if (!goExtensionApi) {
        throw Error("'golang.go' desn't export API.");
    }
    const result = goExtensionApi.settings.getExecutionCommand('go');
    const goPath = result?.binPath;
    if (!goPath) {
        throw Error("Cannot detect 'go' path.");
    }

    const goExec = new GoExec(goPath);

    const stdLibDir = getStdLibDir(await goExec.getEnv());
    const extPackagesDir = await getExtPackagesDir(goExec);

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
}

export function deactivate() {
    console.log('Go Dependencies deactivated');
}

