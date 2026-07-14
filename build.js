const esbuild = require('esbuild');
const { createHash } = require('crypto');
const { readFileSync, rmSync, writeFileSync } = require('fs');

const entryPoints = {
    app: 'static/js/app.js',
};

async function build() {
    rmSync('static/dist', { recursive: true, force: true });
    // The shell is fetched separately. Include its digest in the app bundle so
    // a shell-only change produces a new URL for both assets.
    const shellDigest = createHash('sha256').update(readFileSync('static/templates/app_shell.html')).digest('hex');
    const result = await esbuild.build({
        entryPoints,
        bundle: true,
        outdir: 'static/dist',
        entryNames: '[name]-[hash]',
        format: 'esm',
        minify: true,
        sourcemap: true,
        target: ['es2020'],
        banner: { js: `/* app-shell:${shellDigest} */` },
        metafile: true,
        logLevel: 'info',
    });

    const assetURLs = {};
    for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
        if (!output.entryPoint) continue;
        const name = Object.entries(entryPoints).find(([, entryPoint]) => entryPoint === output.entryPoint)?.[0];
        if (name) assetURLs[name] = `/static/${outputPath.replace(/^static\//, '')}`;
    }

    if (!assetURLs.app) {
        throw new Error(`Build output is incomplete: ${JSON.stringify(assetURLs)}`);
    }
    const assetVersion = assetURLs.app.match(/app-([^.]+)\.js$/)?.[1];
    if (!assetVersion) throw new Error(`Cannot determine asset version from ${assetURLs.app}`);

    const html = readFileSync('index.html.local', 'utf8')
        .replaceAll('__APP_ASSET__', assetURLs.app)
        .replaceAll('__ASSET_VERSION__', assetVersion);
    writeFileSync('static/index.html', html);
}

build().catch(error => {
    console.error(error);
    process.exit(1);
});
