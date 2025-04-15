import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    // Required: Glob of files to load (can be an array and include absolute paths).
    files: 'dist/test/**/*.test.js',
    // Optional: Version to use, same as the API above, defaults to stable
    version: 'insiders',
    // Optional: Root path of your extension, same as the API above, defaults
    // to the directory this config file is in
    extensionDevelopmentPath: __dirname,
    // Optional: sample workspace to open
    workspaceFolder: `${__dirname}/sampleWorkspace`,
    // Optional: install additional extensions to the installation prior to testing. By
    //default, any `extensionDependencies` from the package.json are automatically installed.
    installExtensions: ['ms-vscode.js-debug-nightly'],
    // Optional: additional mocha options to use:
    mocha: {
    //   require: `./out/test-utils.js`,
      timeout: 20000,
    },
  },
  // you can specify additional test configurations if necessary
]);
