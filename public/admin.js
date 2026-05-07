// Browser-local TZ rendering for <time data-time-rel> elements + clipboard buttons.
(function () {
    function relative(date, now) {
        var diff = date.getTime() - now.getTime();
        var abs = Math.abs(diff);
        var past = diff < 0;
        var minute = 60 * 1000;
        var hour = 60 * minute;
        var day = 24 * hour;
        var week = 7 * day;
        var value, unit;
        if (abs < minute) return past ? 'just now' : 'in a moment';
        if (abs < hour) {
            value = Math.round(abs / minute);
            unit = value === 1 ? 'minute' : 'minutes';
        } else if (abs < day) {
            value = Math.round(abs / hour);
            unit = value === 1 ? 'hour' : 'hours';
        } else if (abs < week) {
            value = Math.round(abs / day);
            unit = value === 1 ? 'day' : 'days';
        } else {
            value = Math.round(abs / week);
            unit = value === 1 ? 'week' : 'weeks';
        }
        return past ? value + ' ' + unit + ' ago' : 'in ' + value + ' ' + unit;
    }

    function formatTimes(root) {
        root.querySelectorAll('time[data-time-rel]').forEach(function (el) {
            var iso = el.getAttribute('datetime');
            if (!iso) return;
            var d = new Date(iso);
            if (isNaN(d.getTime())) return;
            el.textContent = relative(d, new Date());
            el.title = d.toLocaleString();
        });
    }

    function bindCopy(root) {
        root.querySelectorAll('[data-copy]').forEach(function (btn) {
            if (btn.__bound) return;
            btn.__bound = true;
            btn.addEventListener('click', function () {
                var text = btn.getAttribute('data-copy');
                if (!text) return;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text);
                }
                var prev = btn.textContent;
                btn.textContent = 'copied';
                setTimeout(function () {
                    btn.textContent = prev;
                }, 1400);
            });
        });
    }

    function refresh(root) {
        formatTimes(root);
        bindCopy(root);
    }

    // Suggestion click → set form's prefix input, clear suggestion panel.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-suggestion]');
        if (!btn) return;
        var form = btn.closest('form');
        var input = form ? form.querySelector('input[name="prefix"]') : null;
        if (input) {
            input.value = btn.getAttribute('data-suggestion');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        var panel = btn.closest('#prefix-suggestions');
        if (panel) panel.replaceChildren();
    });

    refresh(document);

    document.body.addEventListener('htmx:afterSwap', function (e) {
        refresh(e.target);
    });

    // Show spinner on native (non-htmx) form submits — htmx forms get the
    // class automatically.
    document.body.addEventListener('submit', function (e) {
        var form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (
            form.hasAttribute('hx-post') ||
            form.hasAttribute('hx-patch') ||
            form.hasAttribute('hx-put') ||
            form.hasAttribute('hx-delete')
        )
            return;
        form.classList.add('htmx-request');
    });
})();
