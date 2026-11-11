import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manageImportDocLinks } from '../importLinks';

const state = vi.hoisted(() => {
    const configs = new Map<string, Record<string, unknown>>();
    const warnings: { message: string; buttons: string[] }[] = [];
    let warningSelection: string | undefined;
    const globalState = new Map<string, unknown>();
    return {
        configs,
        warnings,
        globalState,
        setWarningSelection: (selection: string | undefined) => { warningSelection = selection; },
        reset: () => {
            configs.clear();
            warnings.length = 0;
            globalState.clear();
        },
        mock: {
            workspace: {
                getConfiguration: (section: string) => ({
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
        state.configs.set('go.dependencies.explorer', { 'block.import.doc.links': 'ask' });
        state.configs.set('go', {});
    });

    it('mode off leaves the go configuration untouched', async () => {
        state.configs.set('go.dependencies.explorer', { 'block.import.doc.links': 'off' });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')).toEqual({});
        expect(state.warnings).toHaveLength(0);
    });

    it('ask disables links and explains once', async () => {
        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false });
        expect(state.warnings).toHaveLength(1);
        expect(state.warnings[0].buttons).toEqual(['Keep disabled', 'Restore']);
    });

    it('restore reverts the previous commands object and switches to off', async () => {
        state.configs.set('go', { editorContextMenuCommands: { links: true, generateTests: true } });
        state.setWarningSelection('Restore');

        await manageImportDocLinks(context as any, explorerConf() as any);
        await flush();

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: true, generateTests: true });
        expect(explorerConf().get('block.import.doc.links')).toBe('off');
        expect(state.globalState.get('importLinks.previousContextMenuCommands')).toBeUndefined();
    });

    it('keep disabled persists the block for the next startups without asking again', async () => {
        state.setWarningSelection('Keep disabled');

        await manageImportDocLinks(context as any, explorerConf() as any);
        await flush();
        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false });
        expect(state.warnings).toHaveLength(1);
    });

    it('mode on enforces the block silently', async () => {
        state.configs.set('go.dependencies.explorer', { 'block.import.doc.links': 'on' });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false });
        expect(state.warnings).toHaveLength(0);
    });

    it('an already disabled links command is not touched and not stored', async () => {
        state.configs.set('go', { editorContextMenuCommands: { links: false, coverProfile: true } });

        await manageImportDocLinks(context as any, explorerConf() as any);

        expect(state.configs.get('go')?.editorContextMenuCommands).toEqual({ links: false, coverProfile: true });
        expect(state.globalState.get('importLinks.previousContextMenuCommands')).toBeUndefined();
    });
});
