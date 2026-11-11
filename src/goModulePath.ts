import { relative, sep } from 'path';

const versionSuffix = /@.*$/;

export function modulePathOfDir(dirPath: string, modulesRoot: string): string | undefined {
    const segments = segmentsUnderRoot(dirPath, modulesRoot);
    const versionedIndex = segments?.findIndex(segment => segment.includes('@')) ?? -1;
    if (!segments || versionedIndex < 0) {
        return undefined;
    }
    const moduleSegments = [...segments.slice(0, versionedIndex), segments[versionedIndex].replace(versionSuffix, '')];
    return moduleSegments.join('/');
}

export function importPathOfDir(dirPath: string, modulesRoot: string): string | undefined {
    const segments = segmentsUnderRoot(dirPath, modulesRoot);
    if (!segments || segments.length === 0) {
        return undefined;
    }
    return segments.map(segment => segment.replace(versionSuffix, '')).join('/');
}

function segmentsUnderRoot(dirPath: string, modulesRoot: string): string[] | undefined {
    const rel = relative(modulesRoot, dirPath);
    if (!rel || rel.startsWith('..')) {
        return undefined;
    }
    return rel.split(sep).filter(segment => segment.length > 0);
}

export function parseModifiedModules(output: string): string[] {
    const modified = output.split('\n')
        .map(line => line.trim().replace(/^go:\s*/, ''))
        .filter(line => line.includes('dir has been modified') || line.includes('checksum mismatch'))
        .map(line => line.split(/\s+/)[0])
        .filter(path => path.length > 0);
    return Array.from(new Set(modified));
}
