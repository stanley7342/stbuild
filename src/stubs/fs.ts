// Browser stub for 'fs' — all operations are no-ops or return safe defaults
export function existsSync(_p: string): boolean { return false; }
export function readdirSync(_p: string, _opts?: unknown): never[] { return []; }
export function readFileSync(_p: string, _enc?: string): string { return ''; }
export function writeFileSync(_p: string, _data: string, _enc?: string): void { /* no-op */ }
export function mkdirSync(_p: string, _opts?: unknown): void { /* no-op */ }
export function rmSync(_p: string, _opts?: unknown): void { /* no-op */ }
export function copyFileSync(_src: string, _dst: string): void { /* no-op */ }
export function statSync(_p: string): { isDirectory(): boolean; isFile(): boolean } {
    return { isDirectory: () => false, isFile: () => false };
}
