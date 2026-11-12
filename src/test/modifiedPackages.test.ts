import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkModifiedPackages } from '../modifiedPackages';

const state = vi.hoisted(() => {
    const warnings: { message: string; buttons: string[] }[] = [];
    const infos: string[] = [];
    let warningSelection: string | undefined;
    const settings: Record<string, unknown> = {};
    return {
        warnings,
        infos,
        settings,
        setWarningSelection: (selection: string | undefined) => { warningSelection = selection; },
        reset: () => {
            warnings.length = 0;
            infos.length = 0;
            warningSelection = undefined;
            for (const key of Object.keys(settings)) {
                delete settings[key];
            }
        },
        mock: {
            workspace: {
                getConfiguration: () => ({
                    get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback),
                }),
            },
            window: {
                showWarningMessage: async (message: string, ...buttons: string[]) => {
                    warnings.push({ message, buttons });
                    return warningSelection;
                },
                showInformationMessage: async (message: string) => {
                    infos.push(message);
                },
            },
        },
    };
});

vi.mock('vscode', () => state.mock);

interface ProviderCalls {
    verify: number;
    restored: string[][];
}

function providerOf(modified: string[], calls: ProviderCalls) {
    return {
        verifyModifiedModules: async () => {
            calls.verify++;
            return modified;
        },
        restoreModules: async (paths: string[]) => {
            calls.restored.push([...paths]);
        },
    };
}

describe('checkModifiedPackages', () => {
    beforeEach(() => {
        state.reset();
    });

    it('mode off skips the check entirely', async () => {
        state.settings['modified.packages'] = 'off';
        const calls = { verify: 0, restored: [] as string[][] };
        const refreshes: boolean[] = [];

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, async force => { refreshes.push(!!force); }, true);

        expect(calls.verify).toBe(0);
        expect(calls.restored).toEqual([]);
    });

    it('non-forced refreshes skip the check', async () => {
        const calls = { verify: 0, restored: [] as string[][] };

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, async () => { }, false);

        expect(calls.verify).toBe(0);
    });

    it('auto restores all modified modules silently', async () => {
        state.settings['modified.packages'] = 'auto';
        const calls = { verify: 0, restored: [] as string[][] };
        const refreshes: boolean[] = [];
        const refresh = async (force = false) => { refreshes.push(force); };

        await checkModifiedPackages(providerOf(['mod/one', 'mod/two'], calls) as any, refresh, true);

        expect(calls.restored).toEqual([['mod/one', 'mod/two']]);
        expect(refreshes).toEqual([true]);
        expect(state.infos).toHaveLength(1);
        expect(state.warnings).toHaveLength(0);

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, refresh, true);
        expect(calls.verify).toBe(1);
    });

    it('ask restores a single module on demand', async () => {
        state.settings['modified.packages'] = 'ask';
        state.setWarningSelection('Restore mod/one');
        const calls = { verify: 0, restored: [] as string[][] };
        const refresh = async (): Promise<void> => { };

        await checkModifiedPackages(providerOf(['mod/one', 'mod/two'], calls) as any, refresh, true);

        expect(calls.restored).toEqual([['mod/one']]);

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, refresh, true);
        expect(calls.verify).toBe(1);
    });

    it('ask restores all modules', async () => {
        state.settings['modified.packages'] = 'ask';
        state.setWarningSelection('Restore all');
        const calls = { verify: 0, restored: [] as string[][] };

        await checkModifiedPackages(providerOf(['mod/one', 'mod/two'], calls) as any, async () => { }, true);

        expect(calls.restored).toEqual([['mod/one', 'mod/two']]);

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, async () => { }, true);
        expect(calls.verify).toBe(1);
    });

    it('ask ignores on dismiss and on Ignore', async () => {
        state.settings['modified.packages'] = 'ask';
        state.setWarningSelection(undefined);
        const calls = { verify: 0, restored: [] as string[][] };

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, async () => { }, true);
        state.setWarningSelection('Ignore');
        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, async () => { }, true);

        expect(calls.restored).toEqual([]);
        expect(state.warnings).toHaveLength(2);
    });

    it('skips exactly the refresh triggered by a restore', async () => {
        state.settings['modified.packages'] = 'ask';
        state.setWarningSelection('Restore all');
        const calls = { verify: 0, restored: [] as string[][] };
        const refresh = async () => {
            await checkModifiedPackages(providerOf(['mod/one'], calls) as any, refresh, true);
        };

        await checkModifiedPackages(providerOf(['mod/one'], calls) as any, refresh, true);
        expect(calls.restored).toEqual([['mod/one']]);
        expect(calls.verify).toBe(1);

        const laterCalls = { verify: 0, restored: [] as string[][] };
        await checkModifiedPackages(providerOf(['mod/one'], laterCalls) as any, async () => { }, true);
        expect(laterCalls.verify).toBe(1);
    });

    it('does nothing when no modules are modified', async () => {
        const calls = { verify: 0, restored: [] as string[][] };

        await checkModifiedPackages(providerOf([], calls) as any, async () => { }, true);

        expect(calls.restored).toEqual([]);
        expect(state.warnings).toHaveLength(0);
        expect(state.infos).toHaveLength(0);
    });
});
