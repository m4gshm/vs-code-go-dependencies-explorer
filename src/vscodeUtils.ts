import * as vscode from 'vscode';

export function getWorkspaceFileDirs() {
    const workspaceFolders = vscode.workspace.workspaceFolders?.filter(wf => wf.uri.scheme === "file").map(wf => wf.uri.fsPath);
    return workspaceFolders || [];
  }
  