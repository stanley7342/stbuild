const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Copy serialBridge.js to out/ so it can be spawned under system Node.js
fs.mkdirSync('out', { recursive: true });
fs.copyFileSync('src/serialBridge.js', 'out/serialBridge.js');

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
};

if (watch) {
    esbuild.context(options).then(ctx => ctx.watch());
} else {
    esbuild.build(options);
}
