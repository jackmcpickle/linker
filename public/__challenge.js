(function () {
    var form = document.getElementById('ts-form');
    if (!form) return;
    var siteKey = form.getAttribute('data-turnstile-site-key');
    if (!siteKey) return;

    function bootstrap() {
        if (!window.turnstile) {
            setTimeout(bootstrap, 50);
            return;
        }
        window.turnstile.render('#ts-container', {
            sitekey: siteKey,
            size: 'invisible',
            callback: function (token) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'cf-turnstile-response';
                input.value = token;
                form.appendChild(input);
                form.submit();
            },
            'error-callback': function () {
                // brief delay then retry; user-friendly under transient network issues
                setTimeout(function () {
                    window.turnstile.execute('#ts-container');
                }, 1500);
            },
        });
        window.turnstile.execute('#ts-container');
    }

    bootstrap();
})();
