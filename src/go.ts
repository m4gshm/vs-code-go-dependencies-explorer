'use strict';

import * as vscode from 'vscode';
import cp from 'child_process';

export function getDependencyDirs(): string[] {
    const strResult = execGo('list', '-f', '{{.Dir}}', 'all');
    const modules = strResult.split('\n').filter(module => module.length > 0);
    return modules;
}

export function getDependencies(): string[] {
    const strResult = execGo('list', '-m', '-f', '{{.Path}}', 'all');
    const modules = strResult.split('\n').filter(module => module.length > 0);
    return modules;
}

export class ModuleInfo {
    constructor(
        public readonly Path: string,
        public readonly Main: boolean,
        public readonly Dir: string,
        public readonly GoMod: string,
        public readonly GoVersion: string,
    ) {
    }
}

export function getModuleInfo(moduleName: string): ModuleInfo {
    let strResult = execGo('list', '-m', '--json', `${moduleName}`);
    var rawJson = JSON.parse(strResult);
    return rawJson as ModuleInfo;

}

function execGo(...args: string[]) {
    return exec(goExecPath(), args, getWorkspaceUrl());
}

function goExecPath() {
    return 'go';
}

function getWorkspaceUrl() {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    const uri = workspace?.uri;
    const workspaceUrl = uri ? new URL(uri) : undefined;
    return workspaceUrl;
}

function exec(command: string, args: string[], workspaceUrl: import("url").URL | undefined = undefined) {
    let strResult: string;
    try {
        const rawResult = cp.execFileSync(command, args, { cwd: workspaceUrl });
        strResult = `${rawResult}`;
    } catch (err) {
        if (typeof err === "string") {
            throw Error(`failed to run "${command} ${args}": ${err} cwd: ${workspaceUrl}`);
        } else if (err instanceof Error) {
            throw Error(`failed to run "${command} ${args}": ${err.message} cwd: ${workspaceUrl}`);
        }
        throw err;
    }
    return strResult;
}
