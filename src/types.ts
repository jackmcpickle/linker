export type Bindings = {
  BUCKET: R2Bucket;
  LINKS: KVNamespace;
  THROTTLE: KVNamespace;
  ASSETS: Fetcher;

  // vars
  SHARE_DOMAIN: string;
  TURNSTILE_SITE_KEY: string;

  // secrets
  ADMIN_PASSWORD: string;
  COOKIE_HMAC_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
};

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
};

export type Env = { Bindings: Bindings };
export type ShareEnv = Env & { Variables: { token: string; link: ShareLink } };
