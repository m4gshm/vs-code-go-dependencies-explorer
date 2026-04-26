import * as assert from 'assert';
import { join } from 'path';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../goExec';
import { GoPackageProvider } from '../goPackageProvider';
import { GoDependenciesStateProvider } from '../goDependenciesStateProvider';
import { getFsUriOfSelectedItem, GoTreeDataProvider, GoDirItem, GoFileItem } from '../treeView';
import { TreeItem, Uri, TreeItemCollapsibleState } from 'vscode';
import { PathElement } from '../pathTree';

suite('TreeView Integration Test Suite', () => {
    let goExtensionApi: GoExtensionAPI | undefined;
    let goExec: GoExec | undefined;
    let goPackageProvider: GoPackageProvider | undefined;
    let goDependenciesStateProvider: GoDependenciesStateProvider | undefined;

    suiteSetup(async () => {
        goExtensionApi = await getGoExtensionAPI();
        if (!goExtensionApi) {
            throw new Error('GoExtensionAPI not found');
        } else {
            goExec = new GoExec(getGoBinPath(goExtensionApi));
            goPackageProvider = new GoPackageProvider(goExec);
            goDependenciesStateProvider = await GoDependenciesStateProvider.new(goPackageProvider);
        }
    });

    test('GoTreeDataProvider can be instantiated and disposed', () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        assert.ok(provider);
        assert.ok(provider.onDidChangeTreeData);

        // Should not throw on dispose
        provider.dispose();
    });

    test('GoTreeDataProvider refresh triggers tree data change', async () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        let changeFired = false;
        const disposable = provider.onDidChangeTreeData(() => {
            changeFired = true;
        });

        await provider.refresh();

        // Refresh should trigger onDidChangeTreeData
        assert.strictEqual(changeFired, true);

        disposable.dispose();
        provider.dispose();
    });

    test('GoTreeDataProvider getChildren returns root directories', async () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        await provider.refresh();

        const children = await provider.getChildren();
        assert.ok(children);
        assert.ok(Array.isArray(children));
        assert.ok(children.length >= 2); // Should have at least Standard Library and External Packages

        // Check that root items are GoDirItem instances
        for (const child of children) {
            assert.ok(child instanceof GoDirItem);
        }

        provider.dispose();
    });

    test('GoTreeDataProvider getChildren with GoDirItem returns subdirectories and files', async () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        await provider.refresh();

        const rootDirs = await provider.getChildren();
        if (rootDirs.length > 0) {
            const rootDir = rootDirs[0];
            const children = await provider.getChildren(rootDir);
            assert.ok(Array.isArray(children));
            // Children could be empty or contain GoDirItem/GoFileItem instances
        }

        provider.dispose();
    });

    test('GoTreeDataProvider getParent returns parent for child element', async () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        await provider.refresh();

        const rootDirs = await provider.getChildren();
        if (rootDirs.length > 0) {
            const rootDir = rootDirs[0];
            const children = await provider.getChildren(rootDir);
            if (children.length > 0) {
                const child = children[0];
                const parent = await provider.getParent(child);
                assert.ok(parent);
                assert.strictEqual(parent?.id, rootDir.id);
            }
        }

        provider.dispose();
    });

    test('GoTreeDataProvider getParent returns undefined for root directory', async () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        await provider.refresh();

        const rootDirs = await provider.getChildren();
        if (rootDirs.length > 0) {
            const rootDir = rootDirs[0];
            const parent = await provider.getParent(rootDir);
            assert.strictEqual(parent, undefined);
        }

        provider.dispose();
    });

    test('GoDirItem and GoFileItem have correct properties', () => {
        // Create a mock PathElement
        const testPath = join('/test', 'path');
        const mockPathElement = new PathElement(
            'testDir',
            testPath,
            [],
            true
        );

        const dirItem = new GoDirItem(mockPathElement);
        assert.strictEqual(dirItem.id, testPath);
        assert.strictEqual(dirItem.label, 'testDir');
        assert.strictEqual(dirItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(dirItem.contextValue, 'goDir');
        assert.strictEqual(dirItem.tooltip, 'testDir');
        assert.strictEqual(dirItem.dir, mockPathElement);

        const fileItem = new GoFileItem('test.go', testPath);
        const expectedFilePath = join(testPath, 'test.go');
        assert.strictEqual(fileItem.id, expectedFilePath);
        assert.strictEqual(fileItem.label, 'test.go');
        assert.strictEqual(fileItem.contextValue, 'goFile');
        assert.strictEqual(fileItem.tooltip, 'test.go');
        assert.ok(fileItem.resourceUri);
    });

    test('getFsUriOfSelectedItem returns correct Uri for different item types', () => {
        // Test with GoFileItem
        const testPath = join('/test', 'path');
        const fileItem = new GoFileItem('test.go', testPath);
        const fileUri = getFsUriOfSelectedItem(fileItem);
        assert.ok(fileUri);
        assert.strictEqual(fileUri?.fsPath, join(testPath, 'test.go'));

        // Test with GoDirItem
        const mockPathElement = new PathElement(
            'testDir',
            testPath,
            [],
            true
        );
        const dirItem = new GoDirItem(mockPathElement);
        const dirUri = getFsUriOfSelectedItem(dirItem);
        assert.ok(dirUri);
        assert.strictEqual(dirUri?.fsPath, testPath);

        // Test with PathElement
        const anotherPath = join('/another', 'path');
        const pathElement = new PathElement(
            'anotherDir',
            anotherPath,
            [],
            true
        );
        const pathUri = getFsUriOfSelectedItem(pathElement);
        assert.ok(pathUri);
        assert.strictEqual(pathUri?.fsPath, anotherPath);

        // Test with unexpected item type
        const unexpectedItem = new TreeItem('test');
        const unexpectedUri = getFsUriOfSelectedItem(unexpectedItem);
        assert.strictEqual(unexpectedUri, undefined);
    });

    test('GoTreeDataProvider onExpand and onCollapse handle elements without errors', async () => {
        if (!goDependenciesStateProvider) {
            assert.fail('goDependenciesStateProvider not initialized');
        }

        const provider = new GoTreeDataProvider(goDependenciesStateProvider);
        await provider.refresh();

        const children = await provider.getChildren();
        if (children.length > 0) {
            const rootDir = children[0];

            // Should handle without errors
            provider.onExpand(rootDir);
            provider.onCollapse(rootDir);
        }

        provider.dispose();
    });
});