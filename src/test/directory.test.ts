import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DirectoryHierarchyBuilder } from '../directory';
import { ROOT_STD_LIB } from '../goDependencyFSCommon';
import path from 'node:path';

test('create root directory', () => {
	const dirPaths = [
		'/root/dir1/subdir11',
		'/root/dir2',
	];
	const root = DirectoryHierarchyBuilder.create(dirPaths, '/root', ROOT_STD_LIB, "Test std lib")!!.toDirectory();

	const expectedRoot = path.sep + ROOT_STD_LIB;
	assert.strictEqual(expectedRoot, root.path);
	assert.strictEqual(2, root.subdirs.length);
	assert.strictEqual('dir1', root.subdirs[0].label);
	assert.strictEqual(path.join(expectedRoot, 'dir1'), root.subdirs[0].path);
	assert.strictEqual(path.join(expectedRoot, 'dir1', 'subdir11'), root.subdirs[0].subdirs[0].path);

	assert.strictEqual(path.join(expectedRoot, 'dir2'), root.subdirs[1].path);
	assert.strictEqual(0, root.subdirs[1].subdirs.length);
});
