import { ConfigurationTarget, ExtensionContext, WorkspaceConfiguration, window, workspace } from 'vscode';

const CONTEXT_COMMANDS_KEY = 'editorContextMenuCommands';
const PREVIOUS_COMMANDS_KEY = 'importLinks.previousContextMenuCommands';
const DECIDED_KEY = 'importLinks.decided';

export async function manageImportDocLinks(context: ExtensionContext, conf: WorkspaceConfiguration) {
    const mode = conf.get<'ask' | 'on' | 'off'>('block.import.doc.links', 'ask');
    if (mode === 'off') {
        return;
    }
    await disableLinksCommand(context);
    if (mode === 'on' || context.globalState.get<boolean>(DECIDED_KEY)) {
        return;
    }
    void window.showWarningMessage(
        'Ctrl+Click on import paths no longer opens pkg.go.dev automatically: the "Open pkg.go.dev" editor context command is disabled. Change it via go.dependencies.explorer.block.import.doc.links.',
        'Keep disabled', 'Restore').then(async selection => {
            await context.globalState.update(DECIDED_KEY, true);
            if (selection === 'Restore') {
                await conf.update('block.import.doc.links', 'off', ConfigurationTarget.Global);
                await restoreLinksCommand(context);
            }
        });
}

async function disableLinksCommand(context: ExtensionContext) {
    const goConf = workspace.getConfiguration('go');
    const inspected = goConf.inspect<Record<string, unknown>>(CONTEXT_COMMANDS_KEY);
    const current = inspected?.globalValue ?? {};
    if (current.links === false) {
        return;
    }
    if (inspected?.globalValue === undefined) {
        await context.globalState.update(PREVIOUS_COMMANDS_KEY, undefined);
    } else {
        await context.globalState.update(PREVIOUS_COMMANDS_KEY, current);
    }
    await goConf.update(CONTEXT_COMMANDS_KEY, { ...current, links: false }, ConfigurationTarget.Global);
}

async function restoreLinksCommand(context: ExtensionContext) {
    const previous = context.globalState.get<Record<string, unknown> | undefined>(PREVIOUS_COMMANDS_KEY);
    const goConf = workspace.getConfiguration('go');
    await goConf.update(CONTEXT_COMMANDS_KEY, previous, ConfigurationTarget.Global);
    await context.globalState.update(PREVIOUS_COMMANDS_KEY, undefined);
}
