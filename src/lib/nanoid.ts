import { customAlphabet } from 'nanoid';

// Hostname-safe alphabet: lowercase alphanumerics only (no underscore, no hyphen
// to dodge subdomain edge-cases). 36^10 ≈ 2^51 entropy.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const TOKEN_LENGTH = 10;

export const generateToken = customAlphabet(ALPHABET, TOKEN_LENGTH);

export function isValidToken(s: string): boolean {
    if (s.length !== TOKEN_LENGTH) return false;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        const isLower = c >= 97 && c <= 122;
        const isDigit = c >= 48 && c <= 57;
        if (!isLower && !isDigit) return false;
    }
    return true;
}
