import * as vscode from 'vscode';
import { GoDependenciesTreeProvider } from "./tree";
import { getDependencyDirs } from './go';
import { Directory } from './dir';


export function activate(context: vscode.ExtensionContext) {
    let fileDirs = getWorkspaceFileDirs();
    let dependencyDirs = fileDirs.flatMap(fd => getDependencyDirs(fd.path).filter(dir => {
        let exclude = dir.startsWith(fd.path);
        return !exclude;
    }));

    let dirs = Directory.create(dependencyDirs);
    GoDependenciesTreeProvider.setup(context, dirs);
}

export function deactivate() {
}

function getWorkspaceFileDirs() {
    const workspaceFolders = vscode.workspace.workspaceFolders?.filter(wf => wf.uri.scheme === "file").map(wf => wf.uri);
    return workspaceFolders || [];
}

