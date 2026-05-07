type TurnstileResponse = {
    success: boolean;
    'error-codes'?: string[];
    challenge_ts?: string;
    hostname?: string;
    action?: string;
    cdata?: string;
};

export async function verifyTurnstile(
    token: string,
    secret: string,
    remoteIp?: string,
): Promise<{ ok: boolean; errors?: string[] }> {
    if (!token) return { ok: false, errors: ['missing-token'] };

    const body = new FormData();
    body.set('secret', secret);
    body.set('response', token);
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
            method: 'POST',
            body,
        },
    );

    if (!res.ok)
        return { ok: false, errors: [`siteverify-http-${res.status}`] };

    const data = (await res.json()) as TurnstileResponse;
    return data.success
        ? { ok: true }
        : { ok: false, errors: data['error-codes'] ?? ['unknown'] };
}
