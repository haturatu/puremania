import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 8844);
const storageDir = process.env.E2E_STORAGE_DIR || '/tmp/puremania-e2e';

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    // Tests intentionally share one real server and storage directory. A
    // single worker prevents one test's reset from changing another test's
    // filesystem state, locally as well as in CI.
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [
        ['list'],
        ['html', { open: 'never' }],
    ],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
    },
    projects: [
        {
            name: 'chromium-desktop',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
        {
            name: 'chromium-mobile',
            use: {
                ...devices['Pixel 7'],
            },
        },
    ],
    webServer: {
        command: `mkdir -p ${shellQuote(storageDir)} && STORAGE_DIR=${shellQuote(storageDir)} PORT=${port} ARIA2C=disable ./puremania`,
        url: `http://127.0.0.1:${port}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
