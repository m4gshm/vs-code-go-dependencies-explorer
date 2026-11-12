export class DirScanCache {
    private readonly entries = new Map<string, string[]>();

    get(dir: string): string[] | undefined {
        return this.entries.get(dir);
    }

    set(dir: string, packageDirs: string[]) {
        this.entries.set(dir, packageDirs);
    }

    clear() {
        this.entries.clear();
    }

    get size() {
        return this.entries.size;
    }
}
