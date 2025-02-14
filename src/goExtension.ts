import { Uri } from 'vscode';

export interface GoExtensionAPI {
    settings: {
        getExecutionCommand(toolName: string, resource?: Uri): { binPath: string, why: any } | undefined;
    };
}
