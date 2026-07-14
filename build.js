const esbuild = require('esbuild');
const { createHash } = require('crypto');
const { readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } = require('fs');
const { join } = require('path');

const entryPoints = {
    app: 'static/js/app.js',
};

const refreshEnabled = process.env.FAST_REFRESH === '1';
const watchEnabled = refreshEnabled && process.env.WATCH === '1';

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : [path];
    });
}

function frontendDigest() {
    const hash = createHash('sha256');
    const files = [
        'index.html.local',
        ...sourceFiles('static/js'),
        ...sourceFiles('static/css'),
        ...sourceFiles('static/templates'),
    ].sort();
    for (const path of files) {
        hash.update(path);
        hash.update(readFileSync(path));
    }
    return hash.digest('hex');
}

async function build() {
    rmSync('static/dist', { recursive: true, force: true });
    // CSS and templates are requested outside the bundle. Include all frontend
    // inputs in its identity, so a deployment always has one coherent version.
    const sourceDigest = frontendDigest();
    const result = await esbuild.build({
        entryPoints,
        bundle: true,
        outdir: 'static/dist',
        entryNames: '[name]-[hash]',
        format: 'esm',
        minify: true,
        sourcemap: true,
        target: ['es2020'],
        banner: { js: `/* frontend:${sourceDigest} */` },
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
        .replaceAll('__ASSET_VERSION__', assetVersion)
        .replaceAll('__FAST_REFRESH_ENABLED__', String(refreshEnabled));
    writeFileSync('static/index.html', html);
    writeFileSync('static/build-info.json', JSON.stringify({ version: assetVersion }) + '\n');
}

async function runBuild() {
    try {
        await build();
    } catch (error) {
        console.error(error);
        if (!watchEnabled) process.exitCode = 1;
    }
}

void runBuild();

if (watchEnabled) {
    let timer;
    const scheduleBuild = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void runBuild(), 75);
    };
    for (const path of ['index.html.local', 'static/js', 'static/css', 'static/templates']) {
        if (statSync(path).isDirectory()) {
            for (const directory of [path, ...sourceFiles(path).map(file => file.slice(0, file.lastIndexOf('/')))]) {
                watch(directory, scheduleBuild);
            }
        } else {
            watch(path, scheduleBuild);
        }
    }
    console.log('Fast Refresh build watcher is running.');
}
