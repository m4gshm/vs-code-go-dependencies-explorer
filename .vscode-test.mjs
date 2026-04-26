import { defineConfig } from '@vscode/test-cli';

export default defineConfig([{
    files: 'out/test-vscode/**/*.test.js',
    version: 'stable',
    workspaceFolder: `goWorkspace/go_stub`,
    //default, any `extensionDependencies` from the package.json are automatically installed.
    installExtensions: ['ms-vscode.js-debug'],
    mocha: {
        timeout: 20000,
    },
    installExtensions: [
        "golang.go",
        "vscode.git"
    ]
}]);