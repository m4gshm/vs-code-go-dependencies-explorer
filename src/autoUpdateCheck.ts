import { ExtensionContext, workspace } from 'vscode';
import { GoPackageProvider } from './goPackageProvider';

export const LAST_UPDATE_CHECK_KEY = 'updates.lastCheckTimestamp';
const MIN_DELAY_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function scheduleAutoUpdateChecks(
    context: ExtensionContext,
    provider: GoPackageProvider,
    refresh: (force?: boolean) => Promise<void>,
) {
    const conf = workspace.getConfiguration('go.dependencies.explorer');
    if (!conf.get('check.module.updates', false) || !conf.get('updates.autoCheck', false)) {
        return;
    }
    const intervalMs = clamp(conf.get('updates.autoCheck.intervalHours', 4), 1, 168) * HOUR_MS;

    let timer: NodeJS.Timeout | undefined;
    const lastCheck = () => context.globalState.get<number>(LAST_UPDATE_CHECK_KEY, 0);
    const markChecked = () => {
        context.globalState.update(LAST_UPDATE_CHECK_KEY, Date.now());
    };

    const run = async () => {
        if (Date.now() - lastCheck() >= intervalMs) {
            try {
                await provider.fetchModuleUpdates(conf.get('updates.goproxy', '') || undefined);
                markChecked();
                await refresh(false);
            } catch (err) {
                const message = err instanceof Error ? err.message : `${err}`;
                console.info(`scheduled module update check failed: ${message}`);
            }
        }
        schedule();
    };

    const schedule = () => {
        clearTimeout(timer);
        const remaining = Math.max(MIN_DELAY_MS, intervalMs - (Date.now() - lastCheck()));
        timer = setTimeout(run, remaining);
    };

    context.subscriptions.push({
        dispose: () => clearTimeout(timer),
    });

    const reconfigure = () => {
        clearTimeout(timer);
        schedule();
    };
    context.subscriptions.push(workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('go.dependencies.explorer')) {
            reconfigure();
        }
    }));

    schedule();
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
