import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode';

import { GoExec } from '../../go';
import { GoPackageDirectoriesProvider } from '../../goPackageDirectoriesProvider';

suite('GoPackageDirectoriesProvider tests', () => {
    suiteTeardown(() => {
        // vscode.window.showInformationMessage('All tests done!');
    });

    test('Instantiate GoPackageDirectoriesProvider', async () => {
        const mockGoExec = sinon.createStubInstance(GoExec);

        // const mockGoExec = new MockedGoExec();
        const provider = new GoPackageDirectoriesProvider(mockGoExec, "", "");
        await provider.getGoPackages();

        await vscode.window.showInformationMessage('All tests started!');
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });
});