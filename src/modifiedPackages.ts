import { window, workspace } from 'vscode';
import { GoPackageProvider } from './goPackageProvider';

// restoreModules triggers a refresh(true) which runs this check again; skip exactly that one
let skipNextCheck = false;

export async function checkModifiedPackages(provider: GoPackageProvider, refresh: (force?: boolean) => Promise<void>) {
    const mode = workspace.getConfiguration('go.dependencies.explorer').get<'off' | 'auto' | 'ask'>('modified.packages', 'ask');
    if (mode === 'off') {
        return;
    }
    if (skipNextCheck) {
        skipNextCheck = false;
        return;
    }
    let modified: string[];
    try {
        modified = await provider.verifyModifiedModules();
    } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`;
        console.info(`modified package check failed: ${message}`);
        return;
    }
    if (modified.length === 0) {
        return;
    }
    if (mode === 'auto') {
        await restore(provider, modified, refresh);
        return;
    }
    const selection = await window.showWarningMessage(
        `Dependency packages modified in the module cache: ${modified.join(', ')}. Restore the pristine copies?`,
        `Restore ${modified[0]}`, 'Restore all', 'Ignore');
    if (!selection || selection === 'Ignore') {
        return;
    }
    await restore(provider, selection === 'Restore all' ? modified : [modified[0]], refresh);
}

async function restore(provider: GoPackageProvider, modulePaths: string[], refresh: (force?: boolean) => Promise<void>) {
    try {
        await provider.restoreModules(modulePaths);
        skipNextCheck = true;
        await refresh(true);
    } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`;
        void window.showWarningMessage(`Failed to restore modified packages: ${message}`);
    }
}
