import { defineConfig } from '@vscode/test-cli';

export default defineConfig([{
    files: 'out/test-vscode/**/*.test.js',
    version: 'stable',
    workspaceFolder: `goWorkspace/go_stub`,
    //`extensionDependencies` from the package.json are automatically installed.
    mocha: {
        timeout: 20000,
    }
}]);