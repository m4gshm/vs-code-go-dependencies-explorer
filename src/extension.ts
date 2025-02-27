import * as vscode from 'vscode';
import { getExtPackagesDir, getStdLibDir, GoDependenciesTreeProvider } from "./dependenciesTree";
import { GoExec } from './go';
import { GoExtensionAPI } from './goExtension';
import { GoDepFileSystemProvider, newFsUriConverter as newFsUriConverter, SCHEME } from './readonlyFs';

export async function activate(context: vscode.ExtensionContext) {
    const goExtension = vscode.extensions.getExtension('golang.go');
    if (!goExtension) {
        throw Error("'golang.go' is not installed.");
    }
    const isActive = goExtension.isActive;
    const exports: GoExtensionAPI | undefined = !isActive ? await goExtension.activate() : goExtension.exports;
    if (!exports) {
        throw Error("'golang.go' desn't export API.");
    }
    const result = exports.settings.getExecutionCommand('go');
    const goPath = result?.binPath;
    if (!goPath) {
        throw Error("Cannot detect 'go' path.");
    }
    const goExec = new GoExec(goPath);

    const stdLibDir = getStdLibDir(await goExec.getEnv());
    const extPackagesDir = await getExtPackagesDir(goExec);

    const uriConv = newFsUriConverter(stdLibDir, extPackagesDir);
    
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, new GoDepFileSystemProvider(vscode.workspace.fs, uriConv.toFsUri), { isReadonly: true }));

    context.subscriptions.push(await GoDependenciesTreeProvider.setup(vscode.workspace.fs, uriConv, goExec, stdLibDir, extPackagesDir));
}

export function deactivate() {
    console.log('Go Dependencies deactivated');
}

