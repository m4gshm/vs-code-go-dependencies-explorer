import { describe, expect, it } from 'vitest';
import { importPathOfDir, modulePathOfDir } from '../goModulePath';

const win = process.platform === 'win32';
const sep = win ? '\\' : '/';
const modCache = ['c:', 'users', 'me', 'go', 'pkg', 'mod'].join(sep);

describe('modulePathOfDir', () => {
    it('extracts module path of versioned module dir', () => {
        const dir = [modCache, 'github.com', 'user', 'repo@v1.2.3'].join(sep);
        expect(modulePathOfDir(dir, modCache)).toBe('github.com/user/repo');
    });

    it('keeps nested module path segments before version', () => {
        const dir = [modCache, 'golang.org', 'x', 'tools@v0.1.0', 'go', 'analysis'].join(sep);
        expect(modulePathOfDir(dir, modCache)).toBe('golang.org/x/tools');
    });

    it('returns undefined outside of module cache', () => {
        const dir = ['c:', 'go', 'src', 'fmt'].join(sep);
        expect(modulePathOfDir(dir, modCache)).toBeUndefined();
    });

    it('returns undefined when module root itself', () => {
        expect(modulePathOfDir(modCache, modCache)).toBeUndefined();
    });
});

describe('importPathOfDir', () => {
    it('builds import path of package inside module', () => {
        const dir = [modCache, 'github.com', 'user', 'repo@v1.2.3', 'sub', 'pkg'].join(sep);
        expect(importPathOfDir(dir, modCache)).toBe('github.com/user/repo/sub/pkg');
    });

    it('returns undefined outside of module cache', () => {
        expect(importPathOfDir(['c:', 'tmp'].join(sep), modCache)).toBeUndefined();
    });
});
