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
        bindAllDropzones(e.target);
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

    document.body.addEventListener('submit', function (e) {
        var form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (form.matches('[data-dropzone]')) return; // handled below
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

    // ---------- chunked uploads ----------
    // The HTML responses below come from our own same-origin admin endpoints,
    // wrapped through htmx.swap which handles HTML insertion with the library's
    // standard sanitization/processing pipeline.
    var liveUploads = new Map(); // uploadId → key
    var PARALLEL_PARTS = 3;

    function progressBar(form) {
        return form.querySelector('[data-upload-progress]');
    }
    function statusEl(form) {
        return form.querySelector('[data-upload-status]');
    }
    function setProgress(form, pct) {
        var bar = progressBar(form);
        if (!bar) return;
        bar.classList.remove('hidden');
        bar.value = Math.max(0, Math.min(100, pct));
    }
    function setStatus(form, text) {
        var el = statusEl(form);
        if (!el) return;
        if (text) {
            el.textContent = text;
            el.classList.remove('hidden');
        } else {
            el.textContent = '';
            el.classList.add('hidden');
        }
    }
    function resetUploadUI(form) {
        var bar = progressBar(form);
        if (bar) {
            bar.value = 0;
            bar.classList.add('hidden');
        }
        setStatus(form, '');
    }

    function swapFileList(html) {
        var target = document.getElementById('file-content');
        if (!target || !window.htmx) return;
        // htmx's swap parses + inserts via its own pipeline (same handling
        // used by every other admin response). Same-origin authed endpoint.
        window.htmx.swap(target, html, { swapStyle: 'outerHTML' });
    }

    async function uploadOneFile(form, file, prefix) {
        var initForm = new FormData();
        initForm.set('prefix', prefix);
        initForm.set('name', file.name);
        initForm.set('size', String(file.size));
        initForm.set('contentType', file.type || 'application/octet-stream');

        var initRes = await fetch('/_admin/files/multipart/init', {
            method: 'POST',
            body: initForm,
        });
        if (!initRes.ok) throw new Error('init failed');
        var init = await initRes.json();

        if (init.uploadId === null) {
            await refreshListing(prefix);
            return;
        }

        liveUploads.set(init.uploadId, init.key);
        var partSize = init.partSize;
        var total = Math.max(1, Math.ceil(file.size / partSize));
        var parts = new Array(total);
        var loaded = 0;

        try {
            var nextPart = 1;
            async function worker() {
                while (true) {
                    var n = nextPart++;
                    if (n > total) return;
                    var start = (n - 1) * partSize;
                    var end = Math.min(start + partSize, file.size);
                    var blob = file.slice(start, end);
                    var url =
                        '/_admin/files/multipart/part?uploadId=' +
                        encodeURIComponent(init.uploadId) +
                        '&key=' +
                        encodeURIComponent(init.key) +
                        '&part=' +
                        n;
                    var res = await fetch(url, { method: 'PUT', body: blob });
                    if (!res.ok) throw new Error('part ' + n + ' failed');
                    var part = await res.json();
                    parts[n - 1] = part;
                    loaded += blob.size;
                    setProgress(form, (loaded / file.size) * 100);
                }
            }
            var workers = [];
            for (var i = 0; i < Math.min(PARALLEL_PARTS, total); i++) {
                workers.push(worker());
            }
            await Promise.all(workers);

            var completeRes = await fetch('/_admin/files/multipart/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uploadId: init.uploadId,
                    key: init.key,
                    parts: parts,
                }),
            });
            if (!completeRes.ok) {
                throw new Error('complete failed');
            }
            liveUploads.delete(init.uploadId);
            swapFileList(await completeRes.text());
        } catch (err) {
            liveUploads.delete(init.uploadId);
            try {
                await fetch('/_admin/files/multipart/abort', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uploadId: init.uploadId,
                        key: init.key,
                    }),
                });
            } catch (_) {}
            throw err;
        }
    }

    async function refreshListing(prefix) {
        var url = prefix
            ? '/_admin/files/list?prefix=' + encodeURIComponent(prefix)
            : '/_admin/files/list';
        var res = await fetch(url);
        if (!res.ok) return;
        swapFileList(await res.text());
    }

    async function handleDropzoneUpload(form, files) {
        var prefix = form.getAttribute('data-prefix') || '';
        form.classList.add('htmx-request');
        try {
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                setStatus(
                    form,
                    'Uploading ' +
                        file.name +
                        ' (' +
                        (i + 1) +
                        '/' +
                        files.length +
                        ')…',
                );
                setProgress(form, 0);
                await uploadOneFile(form, file, prefix);
            }
            fallbackToast(
                'success',
                'Uploaded ' +
                    files.length +
                    ' file' +
                    (files.length === 1 ? '' : 's') +
                    '.',
            );
        } catch (err) {
            fallbackToast(
                'error',
                err && err.message ? err.message : 'Upload failed.',
            );
        } finally {
            form.classList.remove('htmx-request');
            resetUploadUI(form);
            var input = form.querySelector('[data-dropzone-input]');
            if (input) input.value = '';
        }
    }

    function bindDropzone(zone) {
        if (zone.__dzBound) return;
        zone.__dzBound = true;
        var fileInput = zone.querySelector('[data-dropzone-input]');
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
            handleDropzoneUpload(zone, dt.files);
        });
        fileInput.addEventListener('change', function () {
            if (!fileInput.files || fileInput.files.length === 0) return;
            handleDropzoneUpload(zone, fileInput.files);
        });
        zone.addEventListener('submit', function (e) {
            e.preventDefault();
        });
    }

    function bindAllDropzones(root) {
        (root || document)
            .querySelectorAll('[data-dropzone]')
            .forEach(bindDropzone);
    }

    bindAllDropzones(document);

    // ---------- tab-close safety ----------
    window.addEventListener('beforeunload', function (e) {
        if (liveUploads.size === 0) return;
        e.preventDefault();
        e.returnValue = '';
        return '';
    });
    window.addEventListener('pagehide', function () {
        if (liveUploads.size === 0) return;
        liveUploads.forEach(function (key, uploadId) {
            try {
                var body = JSON.stringify({ uploadId: uploadId, key: key });
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(
                        '/_admin/files/multipart/abort',
                        new Blob([body], { type: 'application/json' }),
                    );
                } else {
                    fetch('/_admin/files/multipart/abort', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: body,
                        keepalive: true,
                    });
                }
            } catch (_) {}
        });
    });
})();
