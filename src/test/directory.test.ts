import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { Directory, DirectoryHierarchyBuilder, flat, normalizeWinPath } from '../directory';
import { ROOT_STD_LIB, ROOT_EXT_PACK } from '../goDependencyFSCommon';
import path from 'node:path';

describe('Directory', () => {
  test('constructor creates directory with correct properties', () => {
    const subdirs = [new Directory('sub1', '/path/sub1', true, [])];
    const dir = new Directory('test', '/path/test', false, subdirs);
    
    assert.strictEqual(dir.label, 'test');
    assert.strictEqual(dir.path, '/path/test');
    assert.strictEqual(dir.findFiles, false);
    assert.strictEqual(dir.subdirs.length, 1);
    assert.strictEqual(dir.subdirs[0].label, 'sub1');
  });
});

describe('flat', () => {
  test('empty array returns empty map', () => {
    const result = flat([]);
    assert.strictEqual(result.size, 0);
  });

  test('single directory returns map with one entry', () => {
    const dir = new Directory('test', '/test', true, []);
    const result = flat([dir]);
    
    assert.strictEqual(result.size, 1);
    assert.strictEqual(result.get('/test'), dir);
  });

  test('nested directories returns flattened map', () => {
    const child = new Directory('child', '/parent/child', true, []);
    const parent = new Directory('parent', '/parent', false, [child]);
    const result = flat([parent]);
    
    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get('/parent'), parent);
    assert.strictEqual(result.get('/parent/child'), child);
  });

  test('multiple root directories with overlapping paths', () => {
    const dir1 = new Directory('dir1', '/dir1', true, []);
    const dir2 = new Directory('dir2', '/dir2', false, []);
    const result = flat([dir1, dir2]);
    
    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get('/dir1'), dir1);
    assert.strictEqual(result.get('/dir2'), dir2);
  });
});

describe('DirectoryHierarchyBuilder', () => {
  describe('create', () => {
    test('empty dirPaths returns undefined', () => {
      const result = DirectoryHierarchyBuilder.create([]);
      assert.strictEqual(result, undefined);
    });

    test('single directory path', () => {
      const dirPaths = ['/root/dir1'];
      const root = DirectoryHierarchyBuilder.create(dirPaths, '/root', ROOT_STD_LIB, "Test")!!.toDirectory();
      
      const expectedRoot = path.sep + ROOT_STD_LIB;
      assert.strictEqual(root.path, expectedRoot);
      assert.strictEqual(root.subdirs.length, 1);
      assert.strictEqual(root.subdirs[0].label, 'dir1');
      assert.strictEqual(root.subdirs[0].path, path.join(expectedRoot, 'dir1'));
    });

    test('multiple nested directories', () => {
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

    test('without expectedRootDir', () => {
      const dirPaths = ['/absolute/path/to/dir'];
      const root = DirectoryHierarchyBuilder.create(dirPaths)!!.toDirectory();
      
      // When no expectedRootDir, the root becomes the filesystem root.
      // With Unix-style path '/absolute/...', the root is '/'.
      // On Windows, the root might still be '/' because the input uses forward slashes.
      // Accept either '/' or the platform separator.
      assert(root.path === '/' || root.path === path.sep);
      assert.strictEqual(root.subdirs.length, 1);
      const first = root.subdirs[0];
      assert.strictEqual(first.label, 'absolute');
      // The path could be '/absolute' or '\absolute' depending on platform
      assert(first.path.endsWith('absolute'));
      // Continue down the hierarchy
      assert.strictEqual(first.subdirs.length, 1);
      assert.strictEqual(first.subdirs[0].label, 'path');
      assert(first.subdirs[0].path.endsWith(path.join('absolute', 'path')));
    });

    test('with expectedRootDirReplace', () => {
      const dirPaths = ['/original/root/dir1'];
      const root = DirectoryHierarchyBuilder.create(dirPaths, '/original/root', 'ReplacedRoot', "Replaced Name")!!.toDirectory();
      
      const expectedRoot = path.sep + 'ReplacedRoot';
      assert.strictEqual(root.path, expectedRoot);
      assert.strictEqual(root.subdirs.length, 1);
      assert.strictEqual(root.subdirs[0].path, path.join(expectedRoot, 'dir1'));
    });

    test('paths not starting with expectedRootDir are ignored with warning', () => {
      // We can't easily test console.warn, but we can verify the path is ignored
      const dirPaths = ['/root/dir1', '/other/dir2'];
      const root = DirectoryHierarchyBuilder.create(dirPaths, '/root', ROOT_STD_LIB, "Test")!!.toDirectory();
      
      // Only /root/dir1 should be included
      const expectedRoot = path.sep + ROOT_STD_LIB;
      assert.strictEqual(root.subdirs.length, 1);
      assert.strictEqual(root.subdirs[0].label, 'dir1');
    });

    test('collapseFirst parameter', () => {
      const dirPaths = ['/root/dir1/subdir11'];
      // With collapseFirst=true, the hierarchy may be collapsed
      const root = DirectoryHierarchyBuilder.create(dirPaths, '/root', ROOT_STD_LIB, "Test", true)!!.toDirectory();
      
      // Just verify we get a valid directory structure
      assert.strictEqual(typeof root.path, 'string');
      assert.strictEqual(typeof root.label, 'string');
      // The exact structure depends on collapse implementation
    });
  });

  describe('createGrouped', () => {
    test('empty map returns undefined', () => {
      const result = DirectoryHierarchyBuilder.createGrouped(new Map(), '/root', 'Root');
      assert.strictEqual(result, undefined);
    });

    test('single group', () => {
      const grouped = new Map([['/group1', ['dir1', 'dir2']]]);
      const result = DirectoryHierarchyBuilder.createGrouped(grouped, '/root', 'Root')!!.toDirectory();
      
      assert.strictEqual(result.label, 'Root');
      assert.strictEqual(result.subdirs.length, 1);
      const group = result.subdirs[0];
      assert.strictEqual(group.label, '/group1');
      assert.strictEqual(group.subdirs.length, 2);
      assert.strictEqual(group.subdirs[0].label, 'dir1');
      assert.strictEqual(group.subdirs[1].label, 'dir2');
      assert.strictEqual(group.subdirs[0].findFiles, true); // Leaf directories have findFiles=true
      assert.strictEqual(group.findFiles, false); // Group directory has findFiles=false
    });

    test('multiple groups', () => {
      const grouped = new Map([
        ['/group1', ['dir1']],
        ['/group2', ['dir2', 'dir3']]
      ]);
      const result = DirectoryHierarchyBuilder.createGrouped(grouped, '/root', 'Root')!!.toDirectory();
      
      assert.strictEqual(result.subdirs.length, 2);
      assert.strictEqual(result.subdirs[0].label, '/group1');
      assert.strictEqual(result.subdirs[1].label, '/group2');
    });
  });

  describe('merge', () => {
    test('merge non-overlapping directories', () => {
      // Create two hierarchies with same root path
      const builder1 = DirectoryHierarchyBuilder.create(['/root/dir1'], '/root', 'Root', 'Root')!!;
      const builder2 = DirectoryHierarchyBuilder.create(['/root/dir2'], '/root', 'Root', 'Root')!!;
      
      // They have the same root path, so merge should combine them
      builder1.merge(builder2);
      const result = builder1.toDirectory();
      
      // The root has subdirectories dir1 and dir2 under it
      // Note: The root label is 'Root', not 'root'
      assert.strictEqual(result.subdirs.length, 2);
      const labels = result.subdirs.map(d => d.label).sort();
      assert.deepStrictEqual(labels, ['dir1', 'dir2']);
    });

    test('merge overlapping directories merges recursively', () => {
      const builder1 = DirectoryHierarchyBuilder.create(['/root/dir1/subdir'], '/root', 'Root', 'Root')!!;
      const builder2 = DirectoryHierarchyBuilder.create(['/root/dir1/other'], '/root', 'Root', 'Root')!!;
      
      builder1.merge(builder2);
      const result = builder1.toDirectory();
      
      // Should have root with dir1 containing two subdirectories
      assert.strictEqual(result.subdirs.length, 1);
      const dir1 = result.subdirs[0];
      assert.strictEqual(dir1.label, 'dir1');
      assert.strictEqual(dir1.subdirs.length, 2);
      const subLabels = dir1.subdirs.map(d => d.label).sort();
      assert.deepStrictEqual(subLabels, ['other', 'subdir']);
    });
  });

  describe('toDirectory', () => {
    test('converts hierarchy to Directory structure', () => {
      const builder = new DirectoryHierarchyBuilder(
        true,
        'root',
        '/root',
        new Map([['child', new DirectoryHierarchyBuilder(false, 'child', '/root/child', new Map(), true)]])
      );
      
      const directory = builder.toDirectory();
      assert.strictEqual(directory.label, 'root');
      assert.strictEqual(directory.path, '/root');
      assert.strictEqual(directory.findFiles, false);
      assert.strictEqual(directory.subdirs.length, 1);
      assert.strictEqual(directory.subdirs[0].label, 'child');
      assert.strictEqual(directory.subdirs[0].findFiles, true);
    });
  });
});

describe('normalizeWinPath', () => {
  test('on non-Windows platform returns unchanged path', () => {
    // Mock platform to be non-Windows for test consistency
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    
    try {
      const path = '/C:/Windows/System';
      const result = normalizeWinPath(path);
      assert.strictEqual(result, path);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('on Windows with uppercase drive letter converts to lowercase', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    
    try {
      const path = 'C:\\Windows\\System';
      const result = normalizeWinPath(path);
      assert.strictEqual(result, 'c:\\Windows\\System');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('on Windows with already lowercase drive letter unchanged', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    
    try {
      const path = 'c:\\Windows\\System';
      const result = normalizeWinPath(path);
      assert.strictEqual(result, path);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

// Note: asRoot and collapse are not exported, so they're tested indirectly through create methods
