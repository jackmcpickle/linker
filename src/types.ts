export type Bindings = {
    BUCKET: R2Bucket;
    LINKS: KVNamespace;
    THROTTLE: KVNamespace;
    ASSETS: Fetcher;

    // vars
    SHARE_DOMAIN: string;
    ADMIN_HOST: string;
    TURNSTILE_SITE_KEY: string;

    // secrets
    ADMIN_PASSWORD: string;
    COOKIE_HMAC_SECRET: string;
    TURNSTILE_SECRET_KEY: string;
};

export type LinkType = 'browse' | 'download';

export type ShareLink = {
    token: string;
    name: string;
    notes?: string;
    prefix: string;
    createdAt: number;
    expiresAt: number;
    revokedAt?: number;
    viewCount: number;
    lastAccessedAt?: number;
    /** Undefined on legacy records is treated as 'browse'. */
    linkType?: LinkType;
    /** Token of the paired record (the opposite linkType). Undefined = unpaired. */
    pairedToken?: string;
    /** Bumped on each download action. Independent from viewCount. */
    downloadCount?: number;
};

export type Env = { Bindings: Bindings };
export type ShareEnv = Env & { Variables: { token: string; link: ShareLink } };
