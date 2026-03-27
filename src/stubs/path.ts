// Browser stub for 'path' using forward-slash logic
const SEP = '/';

export function join(...parts: string[]): string {
    return parts.join(SEP).replace(/\/+/g, SEP).replace(/\/$/, '') || SEP;
}
export function basename(p: string, ext?: string): string {
    let base = p.replace(/\\/g, SEP).split(SEP).filter(Boolean).pop() ?? '';
    if (ext && base.endsWith(ext)) { base = base.slice(0, -ext.length); }
    return base;
}
export function dirname(p: string): string {
    const parts = p.replace(/\\/g, SEP).split(SEP);
    parts.pop();
    return parts.join(SEP) || SEP;
}
export function extname(p: string): string {
    const base = basename(p);
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i) : '';
}
export function isAbsolute(p: string): boolean {
    return /^([A-Za-z]:[\\/]|[\\/])/.test(p);
}
export function resolve(...parts: string[]): string { return join(...parts); }
export function relative(_from: string, to: string): string { return to; }
export const sep = SEP;
export default { join, basename, dirname, extname, resolve, relative, sep };
