import { nativeExact, nativeText, nativeDigest, nativeBytesDigest, nativeSha256 } from '../vendor/compatibility/v1/native.mjs';
import type { NativePackage } from '../vendor/compatibility/v1/native.mjs';
export function pointerValue(value: unknown, pointer: string): {
    exists: boolean;
    value?: unknown;
} {
    if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/')) || /~(?:[^01]|$)/.test(pointer))
        throw new TypeError('Invalid RFC 6901 JSON Pointer');
    let current = value;
    if (pointer === '')
        return { exists: true, value: current };
    for (const token of pointer.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, token))
            return { exists: false };
        if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(token))
            return { exists: false };
        current = (current as Record<string, unknown>)[token];
    }
    return { exists: true, value: current };
}
export function validateSourceContent(pkg: NativePackage, source: Record<string, unknown>): void {
    nativeText(source.contentPath);
    if (!source.contentPath.startsWith('sources/') || typeof pkg.files[source.contentPath] !== 'string' || nativeBytesDigest(pkg.files[source.contentPath]) !== source.digest)
        throw new TypeError('Source file identity differs');
}
export function validateSourceFragment(pkg: NativePackage, source: Record<string, unknown>, mapping: Record<string, unknown>): void {
    nativeText(mapping.revision);
    nativeDigest(mapping.fileDigest);
    nativeDigest(mapping.fragmentDigest);
    if (mapping.revision !== source.revision || mapping.fileDigest !== source.digest)
        throw new TypeError('Source mapping revision/file digest differs');
    const bytes = pkg.files[source.contentPath as string];
    if (!mapping.selector || typeof mapping.selector !== 'object')
        throw new TypeError('Source selector required');
    const selector = mapping.selector as Record<string, unknown>;
    let fragmentDigest: string;
    if (selector.kind === 'json-pointer') {
        nativeExact(selector, ['kind', 'pointer']);
        if (typeof selector.pointer !== 'string')
            throw new TypeError('Source JSON Pointer required');
        const selected = pointerValue(JSON.parse(bytes), selector.pointer);
        if (!selected.exists)
            throw new TypeError('Source JSON Pointer not found');
        fragmentDigest = nativeSha256(selected.value);
    }
    else if (selector.kind === 'lines') {
        nativeExact(selector, ['kind', 'start', 'end']);
        const lines = bytes.split('\n');
        if (!Number.isSafeInteger(selector.start) || !Number.isSafeInteger(selector.end) || (selector.start as number) < 1 || (selector.end as number) < (selector.start as number) || (selector.end as number) > lines.length)
            throw new TypeError('Source line range invalid');
        fragmentDigest = nativeBytesDigest(lines.slice((selector.start as number) - 1, selector.end as number).join('\n'));
    }
    else
        throw new TypeError('Unknown source selector');
    if (mapping.fragmentDigest !== fragmentDigest)
        throw new TypeError('Source fragment digest differs');
}
