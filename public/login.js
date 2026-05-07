(function () {
    var form = document.getElementById('login-form');
    if (!form) return;
    var siteKey = form.getAttribute('data-turnstile-site-key');
    if (!siteKey) return;

    var widgetId = null;
    var pending = false;

    function bootstrap() {
        if (!window.turnstile) {
            setTimeout(bootstrap, 50);
            return;
        }
        widgetId = window.turnstile.render('#ts-container', {
            sitekey: siteKey,
            execution: 'execute',
            callback: function (token) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'cf-turnstile-response';
                input.value = token;
                form.appendChild(input);
                pending = false;
                form.submit();
            },
            'error-callback': function () {
                pending = false;
            },
        });
    }
    bootstrap();

    form.addEventListener('submit', function (e) {
        if (pending || !widgetId) return;
        e.preventDefault();
        pending = true;
        window.turnstile.execute(widgetId);
    });
})();
