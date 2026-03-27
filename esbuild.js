const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Copy serialBridge.js to out/ so it can be spawned under system Node.js
fs.mkdirSync('out', { recursive: true });
fs.copyFileSync('src/serialBridge.js', 'out/serialBridge.js');

/** @type {import('esbuild').BuildOptions} */
const nodeOptions = {
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

/** @type {import('esbuild').BuildOptions} */
const webOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/web/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    // Redirect Node.js built-ins to browser stubs
    alias: {
        'fs':            './src/stubs/fs.ts',
        'path':          './src/stubs/path.ts',
        'child_process': './src/stubs/child_process.ts',
        'util':          './src/stubs/util.ts',
    },
    define: {
        'process.platform': JSON.stringify('browser'),
        'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
    },
};

if (watch) {
    Promise.all([
        esbuild.context(nodeOptions).then(ctx => ctx.watch()),
        esbuild.context(webOptions).then(ctx => ctx.watch()),
    ]);
} else {
    Promise.all([
        esbuild.build(nodeOptions),
        esbuild.build(webOptions),
    ]);
}
