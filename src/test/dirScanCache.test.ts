import { describe, expect, it } from 'vitest';
import { DirScanCache } from '../dirScanCache';

describe('DirScanCache', () => {

    it('stores and returns scan results per dir', () => {
        const cache = new DirScanCache();
        cache.set('mod-a', ['a/pkg1', 'a/pkg2']);

        expect(cache.get('mod-a')).toEqual(['a/pkg1', 'a/pkg2']);
        expect(cache.get('mod-b')).toBeUndefined();
    });

    it('overwrites previous entry for the same dir', () => {
        const cache = new DirScanCache();
        cache.set('mod-a', ['old']);
        cache.set('mod-a', ['new']);

        expect(cache.get('mod-a')).toEqual(['new']);
        expect(cache.size).toBe(1);
    });

    it('clear drops all entries', () => {
        const cache = new DirScanCache();
        cache.set('mod-a', ['a']);
        cache.set('mod-b', ['b']);

        cache.clear();

        expect(cache.size).toBe(0);
        expect(cache.get('mod-a')).toBeUndefined();
    });
});
