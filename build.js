const esbuild = require('esbuild');

esbuild.build({
    entryPoints: ['static/js/app.js'],
    bundle: true,
    outfile: 'static/dist/app.bundle.js',
    format: 'esm',
    minify: true,
    sourcemap: true,
    target: ['es2020'],
    logLevel: 'info',
}).catch(() => process.exit(1));
