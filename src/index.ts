import type { Bindings } from './types';
import adminApp from './admin/routes';
import shareApp from './share/routes';
import { classifyHost } from './lib/dispatch';
import { log } from './lib/log';
import { htmxToastResponse } from './admin/lib/toast';

export default {
    async fetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === '/health') return new Response('ok');

        const host = req.headers.get('host') ?? '';
        const cls = classifyHost(host, env.SHARE_DOMAIN, env.ADMIN_HOST);

        // Unknown host → throw uncaught so CF Worker Route "Fail open" mode bypasses
        // the worker and falls through to the host's regular DNS record. Reserved
        // subs (www, info, autodiscover, …) must have their own DNS records to land
        // anywhere real. Must throw BEFORE the try/catch below.
        if (cls.kind === 'unknown') {
            throw new Error(`fail-open: unknown host ${host}`);
        }

        try {
            if (cls.kind === 'admin') return await adminApp.fetch(req, env, ctx);
            return await shareApp.fetch(req, env, ctx);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : undefined;
            log({ event: 'fetch.error', message, stack });
            if (req.headers.get('HX-Request')) {
                return htmxToastResponse('Something went wrong. Please try again.');
            }
            return new Response('internal error', {
                status: 500,
                headers: { 'Cache-Control': 'no-store' },
            });
        }
    },
};
