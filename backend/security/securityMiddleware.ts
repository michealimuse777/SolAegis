/**
 * Security Middleware — Headers, Input Sanitization, CSRF Protection
 * 
 * 1. Security headers (XSS protection, content-type sniffing, clickjacking)
 * 2. Input sanitization (strip HTML/script tags from all string inputs)
 * 3. CSRF note: Bearer token auth is inherently CSRF-safe (not sent by browser automatically)
 */
import { Request, Response, NextFunction } from "express";

// ─────────── HTML/XSS Sanitizer ───────────

/**
 * Strip HTML tags and dangerous patterns from a string.
 */
function sanitizeString(input: string): string {
    return input
        .replace(/<script[\s\S]*?<\/script>/gi, "")   // Remove <script> blocks
        .replace(/<[^>]*>/g, "")                        // Remove all HTML tags
        .replace(/javascript:/gi, "")                   // Remove javascript: URIs
        .replace(/on\w+\s*=/gi, "")                     // Remove event handlers (onclick=, etc)
        .replace(/data:\s*text\/html/gi, "")            // Remove data:text/html URIs
        .trim();
}

/**
 * Recursively sanitize all string values in an object.
 */
function sanitizeObject(obj: any): any {
    if (typeof obj === "string") return sanitizeString(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (obj && typeof obj === "object") {
        const cleaned: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            cleaned[key] = sanitizeObject(value);
        }
        return cleaned;
    }
    return obj;
}

// ─────────── Middleware ───────────

/**
 * Security headers — protects against XSS, clickjacking, MIME sniffing.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    // Prevent XSS reflection
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Prevent clickjacking
    res.setHeader("X-Frame-Options", "DENY");
    // XSS filter (legacy browsers)
    res.setHeader("X-XSS-Protection", "1; mode=block");
    // Strict referrer policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Permissions policy — disable dangerous APIs
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // Content Security Policy — restrict script/style sources
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*");
    // Prevent MIME type sniffing
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    next();
}

/**
 * Input sanitization middleware — strips HTML/XSS from all request body strings.
 * Runs on POST/PUT/PATCH requests with JSON bodies.
 */
export function inputSanitizer(req: Request, _res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === "object") {
        req.body = sanitizeObject(req.body);
    }
    next();
}

/**
 * Request size limiter — prevents payload bombs.
 * Express json() already has a limit, but this adds an explicit check.
 */
export function payloadSizeGuard(maxBytes: number = 10_000) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const contentLength = parseInt(req.headers["content-length"] || "0", 10);
        if (contentLength > maxBytes) {
            res.status(413).json({ error: `Payload too large. Maximum size: ${Math.round(maxBytes / 1024)}KB` });
            return;
        }
        next();
    };
}
