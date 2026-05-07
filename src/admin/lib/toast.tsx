import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Toast, type ToastLevel } from '../views/components/toast';

// Render an error toast as an HTMX response. HX-Reswap: none keeps the
// triggering element's target untouched; the OOB swap injects the toast.
export function toastError(
    c: Context,
    message: string,
    status: ContentfulStatusCode = 400,
) {
    c.header('HX-Reswap', 'none');
    return c.html(
        <Toast
            level="error"
            message={message}
        />,
        status,
    );
}

// Wrap a successful response body with an OOB toast appended.
export function withToast(body: unknown, level: ToastLevel, message: string) {
    return (
        <>
            {body}
            <Toast
                level={level}
                message={message}
            />
        </>
    );
}

// Build a raw Response carrying an OOB error toast — used outside Hono's
// Context (e.g. from the top-level fetch handler's catch block).
export function htmxToastResponse(message: string, status = 500): Response {
    const body = (
        <Toast
            level="error"
            message={message}
        />
    ) as unknown as string;
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'HX-Reswap': 'none',
            'Cache-Control': 'no-store',
        },
    });
}
