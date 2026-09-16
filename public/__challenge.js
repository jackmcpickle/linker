(function () {
    var form = document.getElementById('ts-form');
    if (!form) return;
    var siteKey = form.getAttribute('data-turnstile-site-key');
    if (!siteKey) return;

    // Locked-down corporate browsers (remote browser isolation, strict proxies)
    // can fail Turnstile outright or block challenges.cloudflare.com entirely.
    // Every wait here is bounded so those visitors get a readable message
    // instead of a blank page retrying forever.
    var MAX_ATTEMPTS = 3;
    var RETRY_DELAY_MS = 1500;
    var SCRIPT_WAIT_MS = 10000;
    var OVERALL_TIMEOUT_MS = 15000;

    var attempts = 0;
    var settled = false;
    var waited = 0;

    function giveUp() {
        if (settled) return;
        settled = true;
        var status = document.getElementById('ts-status');
        var fallback = document.getElementById('ts-fallback');
        if (status) status.hidden = true;
        if (fallback) fallback.hidden = false;
    }

    setTimeout(giveUp, OVERALL_TIMEOUT_MS);

    function bootstrap() {
        if (settled) return;
        if (!window.turnstile) {
            waited += 50;
            if (waited >= SCRIPT_WAIT_MS) {
                giveUp();
                return;
            }
            setTimeout(bootstrap, 50);
            return;
        }
        window.turnstile.render('#ts-container', {
            sitekey: siteKey,
            execution: 'execute',
            callback: function (token) {
                if (settled) return;
                settled = true;
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'cf-turnstile-response';
                input.value = token;
                form.appendChild(input);
                form.submit();
            },
            'error-callback': function () {
                if (settled) return;
                attempts += 1;
                if (attempts >= MAX_ATTEMPTS) {
                    giveUp();
                    return;
                }
                // brief delay then retry; user-friendly under transient network issues
                setTimeout(function () {
                    if (settled) return;
                    window.turnstile.execute('#ts-container');
                }, RETRY_DELAY_MS);
            },
        });
        window.turnstile.execute('#ts-container');
    }

    bootstrap();
})();
