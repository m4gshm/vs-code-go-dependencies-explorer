import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as vscode from 'vscode';

// import { DirectoryHierarchyBuilder } from '../directory';
// import { ROOT_STD_LIB } from '../readonlyFs';

test('collepse test', () => {
	// const dirPaths = [
	// 	'/root/dir1/subdir11',
	// 	'/root/dir2',
	// ];
	// const root = DirectoryHierarchyBuilder.create(dirPaths, 'root', ROOT_STD_LIB, "Test std lib")!!.toDirectory();

	assert.strictEqual(-1, [1, 2, 3].indexOf(5));
	assert.strictEqual(-1, [1, 2, 3].indexOf(0));
});
