import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manageImportDocLinks } from '../importLinks';

const state = vi.hoisted(() => {
    const configs = new Map<string, Record<string, unknown>>();
    const warnings: { message: string; buttons: string[] }[] = [];
    let warningSelection: string | undefined;
    const executedCommands: string[] = [];
    const globalState = new Map<string, unknown>();
    return {
        configs,
        warnings,
        globalState,
        executedCommands,
        setWarningSelection: (selection: string | undefined) => { warningSelection = selection; },
        reset: () => {
            configs.clear();
            warnings.length = 0;
            executedCommands.length = 0;
            globalState.clear();
            warningSelection = undefined;
        },
        mock: {
            commands: {
                executeCommand: (command: string) => {
                    executedCommands.push(command);
                    return Promise.resolve();
                },
            },
            workspace: {
                getConfiguration: (section: string = '') => ({
                    get: (key: string, fallback?: unknown) => {
                        const data = configs.get(section);
                        return data && key in data ? data[key] : fallback;
                    },
                    inspect: (key: string) => {
                        const data = configs.get(section);
                        return { globalValue: data && key in data ? data[key] : undefined, defaultValue: undefined };
                    },
                    update: async (key: string, value: unknown) => {
                        const data = configs.get(section) ?? {};
                        if (value === undefined) {
                            delete data[key];
                        } else {
                            data[key] = value;
                        }
                        configs.set(section, data);
                    },
                }),
            },
            window: {
                showWarningMessage: async (message: string, ...buttons: string[]) => {
                    warnings.push({ message, buttons });
                    return warningSelection;
                },
            },
            ConfigurationTarget: { Global: 1 },
        },
    };
});

vi.mock('vscode', () => state.mock);

const context = {
    globalState: {
        get: (key: string) => state.globalState.get(key),
        update: (key: string, value: unknown) => { state.globalState.set(key, value); },
    },
};

const explorerConf = () => state.mock.workspace.getConfiguration('go.dependencies.explorer') as any;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('manageImportDocLinks', () => {
    beforeEach(() => {
        state.reset();
        state.configs.set('go', {});
    });

    it('first startup (no explicit value) disables links, sets gopls importShortcut to Definition, restarts gopls and asks', async () => {
        await manageImportDocLinks(context as any, explorerConf() as any);
        await flush();

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false });
        expect(state.configs.get('')?.gopls).toEqual({ 'ui.navigation.importShortcut': 'Definition' });
        expect(state.executedCommands).toEqual(['go.languageserver.restart']);
        expect(state.warnings).toHaveLength(1);
        expect(state.warnings[0].buttons).toEqual(['Keep disabled', 'Restore']);
    });

    it('keep disabled persists on and never asks again', async () => {
        state.setWarningSelection('Keep disabled');

        await manageImportDocLinks(context as any, explorerConf() as any);
        await flush();
        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(explorerConf().get('block.import.doc.links')).toBe('on');
        expect(state.warnings).toHaveLength(1);
        expect(state.executedCommands).toEqual(['go.languageserver.restart']);
    });

    it('restore reverts the previous commands and import shortcut, switches to off and restarts gopls', async () => {
        state.configs.set('go', { editorContextMenuCommands: { links: true, generateTests: true } });
        state.configs.set('', { gopls: { 'ui.navigation.importShortcut': 'Both', buildFlags: ['-v'] } });
        state.setWarningSelection('Restore');

        await manageImportDocLinks(context as any, explorerConf() as any);
        await flush();

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: true, generateTests: true });
        expect(state.configs.get('')?.gopls).toEqual({ 'ui.navigation.importShortcut': 'Both', buildFlags: ['-v'] });
        expect(explorerConf().get('block.import.doc.links')).toBe('off');
        expect(state.globalState.get('importLinks.previous')).toBeUndefined();
        expect(state.executedCommands).toEqual(['go.languageserver.restart', 'go.languageserver.restart']);
    });

    it('explicit off leaves the editor configuration untouched when we never applied changes', async () => {
        state.configs.set('go.dependencies.explorer', { 'block.import.doc.links': 'off' });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')).toEqual({});
        expect(state.configs.get('')).toBeUndefined();
        expect(state.warnings).toHaveLength(0);
        expect(state.executedCommands).toEqual([]);
    });

    it('explicit off reverts previously applied changes and restarts gopls', async () => {
        state.configs.set('go', { editorContextMenuCommands: { links: true, generateTests: true } });
        state.configs.set('', { gopls: { 'ui.navigation.importShortcut': 'Both', buildFlags: ['-v'] } });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false, generateTests: true });

        state.configs.set('go.dependencies.explorer', { 'block.import.doc.links': 'off' });
        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: true, generateTests: true });
        expect(state.configs.get('')?.gopls).toEqual({ 'ui.navigation.importShortcut': 'Both', buildFlags: ['-v'] });
        expect(state.globalState.get('importLinks.applied')).toBeUndefined();
        expect(state.executedCommands).toEqual(['go.languageserver.restart', 'go.languageserver.restart']);
        expect(state.warnings).toHaveLength(1);
    });

    it('explicit on enforces both changes silently', async () => {
        state.configs.set('go.dependencies.explorer', { 'block.import.doc.links': 'on' });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false });
        expect(state.configs.get('')?.gopls).toEqual({ 'ui.navigation.importShortcut': 'Definition' });
        expect(state.warnings).toHaveLength(0);
    });

    it('an already configured setup without explicit value changes nothing and does not ask', async () => {
        state.configs.set('go', { editorContextMenuCommands: { links: false, coverProfile: true } });
        state.configs.set('', { gopls: { 'ui.navigation.importShortcut': 'Definition' } });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false, coverProfile: true });
        expect(state.configs.get('')?.gopls).toEqual({ 'ui.navigation.importShortcut': 'Definition' });
        expect(state.globalState.get('importLinks.previous')).toBeUndefined();
        expect(state.warnings).toHaveLength(0);
        expect(state.executedCommands).toEqual([]);
    });
});
