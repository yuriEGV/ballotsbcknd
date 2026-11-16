const stores = new Map();

function getClientIp(req) {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return String(forwarded[0]).trim() || "unknown";
    }
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || "unknown";
}

/**
 * Lightweight zero-dependency sliding-window rate limiter.
 * Prevents credential brute forcing, OTP spraying, and endpoint abuse.
 */
export function createRateLimiter({
    windowMs = 15 * 60 * 1000,
    max = 20,
    keyPrefix = "api",
    message = "Demasiadas solicitudes seguidas. Intenta nuevamente en unos minutos."
} = {}) {
    if (!stores.has(keyPrefix)) {
        stores.set(keyPrefix, new Map());
    }
    const bucketMap = stores.get(keyPrefix);

    return (req, res, next) => {
        if (process.env.NODE_ENV === "test" && req.headers?.["x-test-rate-limit"] !== "1") {
            return next();
        }

        const now = Date.now();
        const ip = getClientIp(req);
        const key = `${keyPrefix}:${ip}`;
        const windowStart = now - windowMs;

        let timestamps = bucketMap.get(key) || [];
        timestamps = timestamps.filter((ts) => ts > windowStart);

        if (timestamps.length >= max) {
            const retryAfterSec = Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000));
            res.setHeader("Retry-After", String(retryAfterSec));
            return res.status(429).json({
                success: false,
                message
            });
        }

        timestamps.push(now);
        bucketMap.set(key, timestamps);

        if (bucketMap.size > 5000) {
            for (const [k, list] of bucketMap.entries()) {
                if (list.every((ts) => ts <= windowStart)) {
                    bucketMap.delete(k);
                }
            }
        }

        next();
    };
}

export const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 25,
    keyPrefix: "auth",
    message: "Demasiados intentos de acceso. Espera unos minutos antes de reintentar."
});

export const publicActionRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    keyPrefix: "public-action",
    message: "Límite de solicitudes por minuto excedido. Intenta en breve."
});
