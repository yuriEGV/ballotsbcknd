import mongoose from "mongoose";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeInPlace(target) {
    if (!target || typeof target !== "object") return;
    if (Array.isArray(target)) {
        for (const item of target) sanitizeInPlace(item);
        return;
    }

    for (const key of Object.keys(target)) {
        if (FORBIDDEN_KEYS.has(key) || key.startsWith("$") || key.includes(".")) {
            delete target[key];
        } else {
            sanitizeInPlace(target[key]);
        }
    }
}

/**
 * Strip MongoDB operator keys (`$...`, dotted paths) and prototype pollution keys
 * recursively from request body, query, and URL params.
 */
export const sanitizeNoSqlPayload = (req, _res, next) => {
    if (req.body && typeof req.body === "object") sanitizeInPlace(req.body);
    if (req.query && typeof req.query === "object") sanitizeInPlace(req.query);
    if (req.params && typeof req.params === "object") sanitizeInPlace(req.params);
    next();
};

/**
 * Validate Mongo ObjectId params cleanly with 400 Bad Request before hitting controllers.
 */
export const validateObjectIdParam = (...paramNames) => (req, res, next) => {
    for (const name of paramNames) {
        const val = req.params?.[name];
        if (val !== undefined && !mongoose.Types.ObjectId.isValid(String(val))) {
            return res.status(400).json({
                success: false,
                message: `Identificador inválido en "${name}".`
            });
        }
    }
    next();
};

export const isValidEmail = (email = "") => {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(email).trim());
};

export const isValidCedulaFormat = (normalizedCedula = "") => {
    const val = String(normalizedCedula || "").trim().toUpperCase();
    return val.length >= 6 && val.length <= 15 && /^[0-9A-Z]+$/.test(val);
};

export const setCacheControl = (headerValue) => (_req, res, next) => {
    res.setHeader("Cache-Control", headerValue);
    next();
};
