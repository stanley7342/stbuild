// Browser stub for 'child_process' — spawning is not supported in web
export function exec(
    _cmd: string,
    _opts: unknown,
    callback?: (err: Error | null, stdout: string, stderr: string) => void
): void {
    callback?.(new Error('child_process not supported in web'), '', '');
}
export function execFile(
    _cmd: string, _args: string[],
    _opts: unknown,
    callback?: (err: Error | null, stdout: string, stderr: string) => void
): void {
    callback?.(new Error('child_process not supported in web'), '', '');
}
export function spawn(_cmd: string, _args?: string[], _opts?: unknown): never {
    throw new Error('child_process not supported in web');
}
