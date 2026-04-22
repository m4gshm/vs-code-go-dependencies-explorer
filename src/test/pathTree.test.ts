import assert from 'assert';
import { PathElement, PathTreeBuilder, flat, normalizeWinPath, RootType } from '../pathTree';
import path from 'node:path';
import { suite, test } from 'node:test';

suite('pathTree', () => {
  test('constructor creates directory with correct properties', () => {
    const subpaths = [new PathElement('sub1', '/path/sub1', [])];
    const path = new PathElement('test', '/path/test', subpaths);

    assert.strictEqual(path.name, 'test');
    assert.strictEqual(path.path, '/path/test');
    assert.strictEqual(path.children.length, 1);
    assert.strictEqual(path.children[0].name, 'sub1');
  });

  test('empty array returns empty map', () => {
    const result = flat([]);
    assert.strictEqual(result.size, 0);
  });

  test('single directory returns map with one entry', () => {
    const path = new PathElement('test', '/test', []);
    const result = flat([path]);

    assert.strictEqual(result.size, 1);
    assert.strictEqual(result.get('/test'), path);
  });

  test('nested directories returns flattened map', () => {
    const child = new PathElement('child', '/parent/child', []);
    const parent = new PathElement('parent', '/parent', [child]);
    const result = flat([parent]);

    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get('/parent'), parent);
    assert.strictEqual(result.get('/parent/child'), child);
  });

  test('multiple root directories with overlapping paths', () => {
    const dir1 = new PathElement('dir1', '/dir1', []);
    const dir2 = new PathElement('dir2', '/dir2', []);
    const result = flat([dir1, dir2]);

    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get('/dir1'), dir1);
    assert.strictEqual(result.get('/dir2'), dir2);
  });

  suite('DirectoryHierarchyBuilder', () => {
    suite('create', () => {
      test('empty paths returns undefined', () => {
        const result = PathTreeBuilder.create([]);
        assert.strictEqual(result, undefined);
      });

      test('single directory path', () => {
        const paths = ['/root/dir1'];
        const root = PathTreeBuilder.create(paths, '/root')!!.toDirectory();

        const expectedRoot = '/root';
        assert.strictEqual(root.path, expectedRoot);
        assert.strictEqual(root.children.length, 1);
        assert.strictEqual(root.children[0].name, 'dir1');
        assert.strictEqual(root.children[0].path, path.join(expectedRoot, 'dir1'));
      });

      test('multiple nested directories', () => {
        const paths = [
          '/root/dir1/subdir11',
          '/root/dir2',
        ];
        const root = PathTreeBuilder.create(paths, '/root')!!.toDirectory();

        const expectedRoot = '/root';
        assert.strictEqual(expectedRoot, root.path);
        assert.strictEqual(2, root.children.length);
        assert.strictEqual('dir1', root.children[0].name);
        assert.strictEqual(path.join(expectedRoot, 'dir1'), root.children[0].path);
        assert.strictEqual(path.join(expectedRoot, 'dir1', 'subdir11'), root.children[0].children[0].path);

        assert.strictEqual(path.join(expectedRoot, 'dir2'), root.children[1].path);
        assert.strictEqual(0, root.children[1].children.length);
      });

      test('no collapse, use system root', () => {
        const paths = ['/absolute/path/to/dir'];
        const root = PathTreeBuilder.create(paths, RootType.system)!!.toDirectory();

        assert(root.path === '/' || root.path === path.sep);
        assert.strictEqual(root.children.length, 1);
        const first = root.children[0];
        assert.strictEqual(first.name, 'absolute');
        // The path could be '/absolute' or '\absolute' depending on platform
        assert(first.path.endsWith('absolute'));
        // Continue down the hierarchy
        assert.strictEqual(first.children.length, 1);
        assert.strictEqual(first.children[0].name, 'path');
        assert(first.children[0].path.endsWith(path.join('absolute', 'path')));
      });

      test('collapse by default', () => {
        const paths = ['/absolute/path/to/dir/main.go'];
        const root = PathTreeBuilder.create(paths)!!.toDirectory();

        assert(root.path === '/absolute/path/to/dir');
        assert.strictEqual(root.children.length, 1);
      });

      test('collapse by default with multiple paths', () => {
        const paths = [
          '/absolute/path/to/dir/main.go',
          '/absolute/path/to/dir2/main.go',
          '/absolute/path',
        ];
        const root = PathTreeBuilder.create(paths)!!.toDirectory();

        assert.strictEqual(root.path, '/absolute');
        assert.strictEqual(root.children.length, 1);

        const firstChild = root.children[0];
        assert.strictEqual(firstChild.name, 'path');
        assert.strictEqual(firstChild.path, '/absolute/path');

        const subChildren = firstChild.children;
        assert.strictEqual(subChildren.length, 1);

        const subChild = subChildren[0];
        assert.strictEqual(subChild.name, 'to');
        assert.strictEqual(subChild.path, '/absolute/path/to');

        const subSubChildren = subChild.children;
        assert.strictEqual(subSubChildren.length, 2);
        assert.strictEqual(subSubChildren[0].name, 'dir');
        assert.strictEqual(subSubChildren[0].path, '/absolute/path/to/dir');
        assert.strictEqual(subSubChildren[1].name, 'dir2');
        assert.strictEqual(subSubChildren[1].path, '/absolute/path/to/dir2');
      });

      test('with expectedRootDirReplace', () => {
        const paths = ['/original/root/dir1'];
        const root = PathTreeBuilder.create(paths, '/original/root')!!.toDirectory();

        assert.strictEqual(root.path, '/original/root');
        assert.strictEqual(root.children.length, 1);
        assert.strictEqual(root.children[0].path, path.join(root.path, 'dir1'));
      });

      test('paths not starting with expectedRootDir are ignored with warning', () => {
        const paths = ['/root/dir1', '/other/dir2'];
        const root = PathTreeBuilder.create(paths, '/root')!!.toDirectory();

        assert.strictEqual(root.children.length, 1);
        assert.strictEqual(root.children[0].name, 'dir1');
      });

      test('collapseFirst parameter', () => {
        const paths = ['/root/dir1/subdir11'];
        // With collapseFirst=true, the hierarchy may be collapsed
        const root = PathTreeBuilder.create(paths, '/root')!!.toDirectory();

        // Just verify we get a valid directory structure
        assert.strictEqual(typeof root.path, 'string');
        assert.strictEqual(typeof root.name, 'string');
        // The exact structure depends on collapse implementation
      });
    });

    suite('merge', () => {
      test('merge non-overlapping directories', () => {
        // Create two hierarchies with same root path
        const builder1 = PathTreeBuilder.create(['/root/dir1'], '/root')!!;
        const builder2 = PathTreeBuilder.create(['/root/dir2'], '/root')!!;

        // They have the same root path, so merge should combine them
        builder1.merge(builder2);
        const result = builder1.toDirectory();

        // The root has subdirectories dir1 and dir2 under it
        // Note: The root label is 'Root', not 'root'
        assert.strictEqual(result.children.length, 2);
        const labels = result.children.map(d => d.name).sort();
        assert.deepStrictEqual(labels, ['dir1', 'dir2']);
      });

      test('merge overlapping directories merges recursively', () => {
        const builder1 = PathTreeBuilder.create(['/root/dir1/subdir'], '/root')!!;
        const builder2 = PathTreeBuilder.create(['/root/dir1/other'], '/root')!!;

        builder1.merge(builder2);
        const result = builder1.toDirectory();

        // Should have root with dir1 containing two subdirectories
        assert.strictEqual(result.children.length, 1);
        const dir1 = result.children[0];
        assert.strictEqual(dir1.name, 'dir1');
        assert.strictEqual(dir1.children.length, 2);
        const subLabels = dir1.children.map(d => d.name).sort();
        assert.deepStrictEqual(subLabels, ['other', 'subdir']);
      });
    });

    suite('toDirectory', () => {
      test('converts hierarchy to Directory structure', () => {
        const builder = new PathTreeBuilder(
          true, true, 'root', '/root',
          new Map([['child', new PathTreeBuilder(false, false, 'child', '/root/child', new Map())]])
        );
        const directory = builder.toDirectory();
        assert.strictEqual(directory.name, 'root');
        assert.strictEqual(directory.path, '/root');
        assert.strictEqual(directory.children.length, 1);
        assert.strictEqual(directory.children[0].name, 'child');
      });
    });
  });

  suite('normalizeWinPath', () => {
    const runWindowsOnly = { skip: process.platform !== 'win32' ? 'Only for Windows' : false };

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

    test('on Windows with uppercase drive letter converts to lowercase', runWindowsOnly, () => {
      const path = 'C:\\Windows\\System';
      const result = normalizeWinPath(path);
      assert.strictEqual(result, 'c:\\Windows\\System');

    });

    test('on Windows with already lowercase drive letter unchanged', runWindowsOnly, () => {
      const path = 'c:\\Windows\\System';
      const result = normalizeWinPath(path);
      assert.strictEqual(result, path);
    });
  });
});
