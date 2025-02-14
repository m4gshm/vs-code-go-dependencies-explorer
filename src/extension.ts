import * as vscode from 'vscode';
import { GoDependenciesTreeProvider } from "./tree";
import { GoExec } from './go';
import { Directory } from './dir';
import { GoExtensionAPI } from './goExtension';

export async function activate(context: vscode.ExtensionContext) {
    const fileDirs = getWorkspaceFileDirs();

    // const goPaths = new Set(await execGoCmd('go.gopath', fileDirs));
    // const goRoots = new Set(await execGoCmd('go.goroot', fileDirs));
    // const goTools = new Set(await execGoCmd('go.locate.tools', fileDirs));

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
    const dependencyDirs = await goExec.getAllDependencyDirs(fileDirs);
    const dirs = Directory.create(dependencyDirs);
    GoDependenciesTreeProvider.setup(context, dirs);
}

export function deactivate() {
    console.log('go dependencies tree deactivated');
}

async function execGoCmd(command: string, fileDirs: vscode.Uri[]) {
    return await Promise.all(fileDirs.map(async (dir) => {
        const goPath: string = await vscode.commands.executeCommand(command, dir);
        return goPath;
    }));
}

function getWorkspaceFileDirs() {
    const workspaceFolders = vscode.workspace.workspaceFolders?.filter(wf => wf.uri.scheme === "file").map(wf => wf.uri);
    return workspaceFolders || [];
}

