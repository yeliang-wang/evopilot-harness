import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeBytesDigest, nativeSha256, nativeFrozenClone } from '../vendor/compatibility/v1/native.mjs';
export const HARNESS_SPEC_ROOT = fileURLToPath(new URL('../specifications/v1/', import.meta.url));
export const CANONICAL_CONFTEST = readFileSync(join(HARNESS_SPEC_ROOT, 'templates/conftest.toml'), 'utf8');
export function inspectHarnessStandard() {
    const files: {
        path: string;
        sha256: string;
    }[] = [];
    function walk(dir: string) { for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name), s = lstatSync(path);
        if (s.isSymbolicLink())
            throw new TypeError('Linked standard file');
        if (s.isDirectory())
            walk(path);
        else if (s.isFile())
            files.push({ path: relative(HARNESS_SPEC_ROOT, path).split('\\').join('/'), sha256: nativeBytesDigest(readFileSync(path)) });
        else
            throw new TypeError('Nonregular standard file');
    } }
    walk(HARNESS_SPEC_ROOT);
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const lock = JSON.parse(readFileSync(join(HARNESS_SPEC_ROOT, 'standards.lock.json'), 'utf8')) as unknown;
    const supportMatrix = JSON.parse(readFileSync(join(HARNESS_SPEC_ROOT, 'support-matrix.json'), 'utf8')) as unknown;
    const contractManifest = JSON.parse(readFileSync(new URL('../vendor/compatibility/v1/manifest.json', import.meta.url), 'utf8')) as {
        native?: {
            sha256?: string;
        };
        modules?: Record<string, {
            sha256: string;
        }>;
    };
    // Hash the actual generated canonical module, never a caller claim.
    const contractDigest = nativeBytesDigest(readFileSync(new URL('../vendor/compatibility/v1/native.mjs', import.meta.url)));
    void contractManifest;
    return nativeFrozenClone({ schema: 'evopilot-standard-inspection/v1', owner: 'harness' as const, specVersion: 'v1' as const, standardDigest: nativeSha256(files), standardLockDigest: nativeBytesDigest(readFileSync(join(HARNESS_SPEC_ROOT, 'standards.lock.json'))), contractDigest, files, lock, supportMatrix, authority: false as const });
}
