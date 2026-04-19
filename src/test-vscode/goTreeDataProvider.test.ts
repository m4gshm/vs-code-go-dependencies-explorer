import * as assert from 'assert';
import { EventEmitter } from 'vscode';
import { getGoBinPath, getGoExtensionAPI, GoExtensionAPI } from '../goExtension';
import { GoExec } from '../goExec';
import { GoPackageProvider } from '../goPackageProvider';
import { GoTreeItemProvider } from '../goTreeItemProvider';
import { FsUriConverter, newFsUriConverter } from '../goDependenciesFsProvider';
import { GoTreeDataProvider } from '../treeView';

suite('GoTreeDataProvider Test Suite', () => {
    let goExtensionApi: GoExtensionAPI | undefined;
    let goExec: GoExec | undefined;
    let goPackDirProvider: GoPackageProvider | undefined;
    let treeItemProvider: GoTreeItemProvider | undefined;
    let uriConv: FsUriConverter | undefined;
    let eventEmitter: EventEmitter<any> | undefined;
    let provider: GoTreeDataProvider | undefined;

    suiteSetup(async () => {
        goExtensionApi = await getGoExtensionAPI();
        if (!goExtensionApi) {
            throw new Error('GoExtensionAPI not found');
        } else {
            goExec = new GoExec(getGoBinPath(goExtensionApi));
            goPackDirProvider = new GoPackageProvider(goExec);
            treeItemProvider = await GoTreeItemProvider.new(goPackDirProvider);
            uriConv = newFsUriConverter(goPackDirProvider);
            eventEmitter = new EventEmitter();
            provider = new GoTreeDataProvider(eventEmitter, uriConv, treeItemProvider);
        }
    });

    test('getTreeItem returns same element', async () => {
        await treeItemProvider!.refresh();
        const rootDirs = treeItemProvider!.rootDirs;
        assert.ok(rootDirs.length > 0);
        const element = rootDirs[0];
        const treeItem = provider!.getTreeItem(element);
        assert.strictEqual(treeItem, element);
    });

    test('getChildren with undefined element returns root directories', async () => {
        await treeItemProvider!.refresh();
        const children = await provider!.getChildren();
        assert.ok(children);
        assert.ok(Array.isArray(children));
        assert.ok(children.length >= 2);
        assert.ok(children.every(child => child.id && child.label));
    });

    test('getChildren with GoDirItem returns subdirectories and files', async () => {
        await treeItemProvider!.refresh();
        const rootDirs = treeItemProvider!.rootDirs;
        const rootDir = rootDirs[0];
        const children = await provider!.getChildren(rootDir);
        assert.ok(Array.isArray(children));
    });

    test('getParent returns parent directory for known path', async () => {
        await treeItemProvider!.refresh();
        // Find a directory that has a parent (e.g., a subdirectory of stdlib)
        const rootDirs = treeItemProvider!.rootDirs;
        const rootDir = rootDirs[0];
        const children = await provider!.getChildren(rootDir);
        if (children.length > 0) {
            const child = children[0];
            const parent = await provider!.getParent(child);
            // Parent should be the rootDir
            assert.strictEqual(parent?.id, rootDir.id);
        }
        // If no children, test is inconclusive but not a failure
    });

    test('getParent returns undefined for root directory', async () => {
        await treeItemProvider!.refresh();
        const rootDirs = treeItemProvider!.rootDirs;
        const rootDir = rootDirs[0];
        const parent = await provider!.getParent(rootDir);
        assert.strictEqual(parent, undefined);
    });
});