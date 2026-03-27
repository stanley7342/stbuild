// Browser stub for 'util'
export function promisify(fn: Function): (...args: unknown[]) => Promise<unknown> {
    return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
            fn(...args, (err: Error | null, result: unknown) => {
                if (err) { reject(err); } else { resolve(result); }
            });
        });
}
