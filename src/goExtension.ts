import { Uri } from 'vscode';
import * as vscode from 'vscode';

export interface GoExtensionAPI {
    settings: {
        getExecutionCommand(toolName: string, resource?: Uri): { binPath: string, why: any } | undefined;
    };
}

export async function getGoExtensionAPI(): Promise<GoExtensionAPI | undefined> {
    const extName = 'golang.go';
    const goExtension = vscode.extensions.getExtension(extName);
    if (!goExtension) {
        console.log(`'${extName}' is not installed.`);
        return undefined;
    } else {
        const isActive = goExtension.isActive;
        const goExtensionApi: GoExtensionAPI | undefined = !isActive ? await goExtension.activate() : goExtension.exports;
        if (!goExtensionApi) {
            throw Error("'golang.go' desn't export API.");
        }
        return goExtensionApi;
    }
}

export function getGoBinPath(goExtensionApi: GoExtensionAPI) {
    const result = goExtensionApi.settings.getExecutionCommand('go');
    const binPath = result?.binPath;
    if (!binPath) {
        throw Error("Cannot detect 'go' path.");
    }
    return binPath;
}