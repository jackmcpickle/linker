/**
 * Read a form field as a string. `FormData.get` returns `string | File | null`;
 * file entries and missing fields collapse to the fallback.
 */
export function field(form: FormData, name: string, fallback = ''): string {
    const value = form.get(name);
    return typeof value === 'string' ? value : fallback;
}

/** Read a checkbox field. Unchecked boxes are absent from the payload. */
export function checked(form: FormData, name: string): boolean {
    const value = form.get(name);
    return value === 'on' || value === 'true' || value === '1';
}
