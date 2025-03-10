import * as vscode from 'vscode';
import { getExtPackagesDir, getStdLibDir, GoDependenciesTreeProvider } from "./dependenciesTree";
import { GoExec } from './go';
import { GoExtensionAPI } from './goExtension';
import { GoDepFileSystemProvider, newFsUriConverter as newFsUriConverter, SCHEME } from './readonlyFs';
import { GitExtension } from './gitExtension';

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

    const uriConv = newFsUriConverter(stdLibDir, extPackagesDir);

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
                if (preventOpenRepo) {
                    const rootUri = repository.rootUri;
                    const rootPath = rootUri.fsPath;

                    [stdLibDir, extPackagesDir].forEach(dir => {
                        if (rootPath.startsWith(dir) || dir.startsWith(rootPath)) {
                            console.debug(`closes git repository intersecting with package directory (repo: ${rootPath}, packages dir: ${dir})`);
                            vscode.commands.executeCommand('git.close', repository);
                        }
                    });

                }
            }));
        }
    }

    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME,
        new GoDepFileSystemProvider(vscode.workspace.fs, uriConv.toFsUri), { isReadonly: true }));
    context.subscriptions.push(await GoDependenciesTreeProvider.setup(vscode.workspace.fs, uriConv, goExec, stdLibDir, extPackagesDir));
}

export function deactivate() {
    console.log('Go Dependencies deactivated');
}

