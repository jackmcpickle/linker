import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
    plugins: [
        cloudflareTest({
            isolatedStorage: false,
            singleWorker: true,
            wrangler: { configPath: './wrangler.test.jsonc' },
            miniflare: {
                compatibilityFlags: ['nodejs_compat'],
            },
        }),
    ],
});
