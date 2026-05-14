import type { Bindings } from '../../types';

declare module 'cloudflare:test' {
    interface ProvidedEnv extends Bindings {}
}

export {};
