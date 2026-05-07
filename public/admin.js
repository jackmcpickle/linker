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
        var panel = btn.closest('.prefix-suggestions');
        if (panel) panel.replaceChildren();
    });

    // ---------- toasts ----------
    // Allow htmx to process 4xx/5xx responses so the OOB toast in the body is
    // applied. The handler still respects HX-Reswap: none, so the original
    // target is left alone on errors.
    if (window.htmx && window.htmx.config) {
        window.htmx.config.responseHandling = [
            { code: '204', swap: false },
            { code: '[23]..', swap: true },
            { code: '[45]..', swap: true, error: true },
            { code: '...', swap: false },
        ];
    }

    var TOAST_TIMEOUT_MS = 4000;

    function dismissToast(el) {
        if (!el || el.__dismissing) return;
        el.__dismissing = true;
        el.classList.add('toast--dismissing');
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 180);
    }

    function bindToasts() {
        var region = document.getElementById('toast-region');
        if (!region) return;
        region.querySelectorAll('[data-auto-dismiss]').forEach(function (el) {
            if (el.__bound) return;
            el.__bound = true;
            setTimeout(function () {
                dismissToast(el);
            }, TOAST_TIMEOUT_MS);
        });
    }

    function fallbackToast(level, message) {
        var region = document.getElementById('toast-region');
        if (!region) return;
        var colorClasses =
            level === 'error'
                ? ['border-red-200', 'bg-red-50', 'text-red-900']
                : ['border-emerald-200', 'bg-emerald-50', 'text-emerald-900'];
        var toast = document.createElement('div');
        toast.className =
            'toast pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm ' +
            colorClasses.join(' ');
        toast.setAttribute('data-toast-level', level);
        toast.setAttribute('role', level === 'error' ? 'alert' : 'status');
        var span = document.createElement('span');
        span.className = 'flex-1';
        span.textContent = message;
        var close = document.createElement('button');
        close.type = 'button';
        close.className =
            '-mr-1 -mt-0.5 px-1 text-current opacity-60 hover:opacity-100';
        close.setAttribute('data-toast-dismiss', '');
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '×';
        toast.appendChild(span);
        toast.appendChild(close);
        region.replaceChildren(toast);
        bindToasts();
    }

    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-toast-dismiss]');
        if (!btn) return;
        dismissToast(btn.closest('.toast'));
    });

    document.body.addEventListener('htmx:afterSettle', function (e) {
        refresh(e.target);
        bindToasts();
    });
    document.body.addEventListener('htmx:oobAfterSwap', function () {
        bindToasts();
    });
    document.body.addEventListener('htmx:sendError', function () {
        fallbackToast('error', 'Network error. Please try again.');
    });
    document.body.addEventListener('htmx:timeout', function () {
        fallbackToast('error', 'Request timed out. Please try again.');
    });

    refresh(document);
    bindToasts();

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

    // ---------- file browser: filter input ----------
    document.addEventListener('input', function (e) {
        var input = e.target;
        if (!input || !input.matches || !input.matches('[data-filter]')) return;
        var q = input.value.trim().toLowerCase();
        var rows = document.querySelectorAll('#file-content [data-name]');
        rows.forEach(function (row) {
            var name = row.getAttribute('data-name') || '';
            row.style.display = !q || name.indexOf(q) !== -1 ? '' : 'none';
        });
    });

    // ---------- file browser: drag and drop ----------
    function bindDropzone(zone) {
        if (zone.__dzBound) return;
        zone.__dzBound = true;
        var fileInput = zone.querySelector('input[type="file"]');
        if (!fileInput) return;
        ['dragenter', 'dragover'].forEach(function (ev) {
            zone.addEventListener(ev, function (e) {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('ring-2', 'ring-zinc-900');
            });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            zone.addEventListener(ev, function (e) {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('ring-2', 'ring-zinc-900');
            });
        });
        zone.addEventListener('drop', function (e) {
            var dt = e.dataTransfer;
            if (!dt || !dt.files || dt.files.length === 0) return;
            try {
                fileInput.files = dt.files;
                if (window.htmx) window.htmx.trigger(zone, 'submit');
                else zone.requestSubmit();
            } catch (_) {
                // Some browsers reject programmatic FileList assignment.
            }
        });
    }

    function bindAllDropzones(root) {
        (root || document)
            .querySelectorAll('[data-dropzone]')
            .forEach(bindDropzone);
    }

    // ---------- file browser: upload progress ----------
    document.body.addEventListener('htmx:xhr:progress', function (e) {
        var form = e.target;
        if (!form || !form.matches || !form.matches('[data-dropzone]')) return;
        var bar = form.querySelector('[data-upload-progress]');
        if (!bar) return;
        bar.classList.remove('hidden');
        var d = e.detail;
        if (d && d.lengthComputable && d.total > 0) {
            bar.value = Math.round((d.loaded / d.total) * 100);
        }
    });
    document.body.addEventListener('htmx:afterRequest', function (e) {
        var form = e.target;
        if (!form || !form.matches || !form.matches('[data-dropzone]')) return;
        var bar = form.querySelector('[data-upload-progress]');
        if (bar) {
            bar.value = 0;
            bar.classList.add('hidden');
        }
    });

    bindAllDropzones(document);
    document.body.addEventListener('htmx:afterSettle', function (e) {
        bindAllDropzones(e.target);
    });
})();
