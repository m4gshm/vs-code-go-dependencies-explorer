import * as vscode from 'vscode';
import { GoDependenciesTreeProvider } from "./tree";
import * as fs from 'fs';
import { getDependencyDirs } from './go';
import { Directory } from './dir';
import { GoDependenciesFS as GoDependenciesFS } from './fs';

export function activate(context: vscode.ExtensionContext) {
    let fileDirs = getWorkspaceFileDirs();
    let allSrcDirs = fileDirs.flatMap(fd => getDependencyDirs(fd.path));
    let dependencyDirs = allSrcDirs.filter(dir => {
        let rrr = fileDirs.map(f => f.path).filter(path => dir.startsWith(path));
        let contains = rrr.length === 0;
        if (contains) {
            return true;
        }
        return false;
    });

    let dirs = Directory.create(dependencyDirs);

    let scheme = 'go-dependencies';
    vscode.workspace.registerFileSystemProvider(scheme, new GoDependenciesFS(dirs, listFiles), {
        isReadonly: true,
    });

    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null,
        { uri: vscode.Uri.parse(scheme + ':/'), name: 'DEPENDENCIES' });

    // GoDependenciesTreeProvider.setup(context);
}

export function deactivate() { }


function getWorkspaceFileDirs() {
    const workspaceFolders = vscode.workspace.workspaceFolders?.filter(wf => wf.uri.scheme === "file").map(wf => wf.uri);
    return workspaceFolders || [];
}

function listFiles(path: string) {
    return fs.readdirSync(path, { withFileTypes: true }).filter(e => e.isFile());
}