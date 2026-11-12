import { commands, ConfigurationTarget, ExtensionContext, WorkspaceConfiguration, window, workspace } from 'vscode';

const CONTEXT_COMMANDS_KEY = 'editorContextMenuCommands';
const PREVIOUS_KEY = 'importLinks.previous';
const APPLIED_KEY = 'importLinks.applied';

export async function manageImportDocLinks(context: ExtensionContext, conf: WorkspaceConfiguration) {
    const explicitMode = conf.inspect<'on' | 'off'>('block.import.doc.links')?.globalValue;
    if (explicitMode === 'off') {
        if (context.globalState.get<boolean>(APPLIED_KEY)) {
            await restoreLinksCommand(context);
            restartLanguageServer();
        }
        return;
    }
    const changed = await disableLinksCommand(context);
    if (explicitMode === 'on' || !changed) {
        return;
    }
    restartLanguageServer();
    void window.showWarningMessage(
        'Ctrl+Click on import paths now jumps to the package source instead of opening pkg.go.dev: the gopls "importShortcut" is set to Definition and the "Open pkg.go.dev" editor command is disabled. Choose whether to keep this behavior (setting go.dependencies.explorer.block.import.doc.links).',
        'Keep disabled', 'Restore').then(async selection => {
            if (selection === 'Restore') {
                await conf.update('block.import.doc.links', 'off', ConfigurationTarget.Global);
                await restoreLinksCommand(context);
                restartLanguageServer();
            } else {
                await conf.update('block.import.doc.links', 'on', ConfigurationTarget.Global);
            }
        });
}

function restartLanguageServer() {
    Promise.resolve(commands.executeCommand('go.languageserver.restart')).catch(() => { });
}

async function disableLinksCommand(context: ExtensionContext): Promise<boolean> {
    const goConf = workspace.getConfiguration('go');
    const commands = goConf.inspect<Record<string, unknown>>(CONTEXT_COMMANDS_KEY)?.globalValue;
    const goplsSettings = workspace.getConfiguration().inspect<Record<string, any>>('gopls')?.globalValue;
    const importShortcut = goplsSettings?.['ui.navigation.importShortcut'];
    if (commands?.links === false && importShortcut === 'Definition') {
        return false;
    }
    await context.globalState.update(PREVIOUS_KEY, { commands, goplsSettings });
    await context.globalState.update(APPLIED_KEY, true);
    await goConf.update(CONTEXT_COMMANDS_KEY, { ...commands, links: false }, ConfigurationTarget.Global);
    await workspace.getConfiguration().update('gopls', withImportShortcut(goplsSettings, 'Definition'), ConfigurationTarget.Global);
    return true;
}

function withImportShortcut(settings: Record<string, any> | undefined, value: string) {
    return { ...(settings ?? {}), 'ui.navigation.importShortcut': value };
}

async function restoreLinksCommand(context: ExtensionContext) {
    const previous = context.globalState.get<{ commands?: Record<string, unknown>; goplsSettings?: Record<string, any> } | undefined>(PREVIOUS_KEY);
    await workspace.getConfiguration('go').update(CONTEXT_COMMANDS_KEY, previous?.commands, ConfigurationTarget.Global);
    await workspace.getConfiguration().update('gopls', previous?.goplsSettings, ConfigurationTarget.Global);
    await context.globalState.update(PREVIOUS_KEY, undefined);
    await context.globalState.update(APPLIED_KEY, undefined);
}
