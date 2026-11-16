import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwt.js";

/**
 * Optional JWT middleware — attaches req.user if a valid token is present.
 * Does NOT block the request if no token is provided.
 */
export const optionalAuth = (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
            req.user = jwt.verify(token, getJwtSecret());
        } catch {
            // Token invalid or expired — proceed without user
        }
    }
    next();
};

/**
 * Required JWT middleware — blocks request with 401 if no valid token.
 */
export const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "No autorizado. Token requerido." });
    }
    const token = authHeader.split(" ")[1];
    try {
        req.user = jwt.verify(token, getJwtSecret());
        next();
    } catch {
        return res.status(401).json({ success: false, message: "Token inválido o expirado." });
    }
};

/**
 * Admin-only middleware — blocks if not role=admin.
 */
export const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Acceso restringido a administradores." });
    }
    next();
};

/**
 * Voter-only middleware — ensures the bearer token belongs to an authenticated voter.
 */
export const requireVoter = (req, res, next) => {
    if (!req.user || req.user.role !== "voter") {
        return res.status(403).json({ success: false, message: "Token de votante inválido." });
    }
    next();
};

/**
 * Citizen-only middleware — ensures bearer token belongs to an authenticated Plaza Ciudadana account.
 */
export const requireCitizen = (req, res, next) => {
    if (!req.user || req.user.role !== "citizen") {
        return res.status(403).json({ success: false, message: "Sesión ciudadana requerida." });
    }
    next();
};

/**
 * Allows authenticated platform users (admin/organizer/observer) OR Plaza Ciudadana accounts,
 * while explicitly blocking single-election booth voter tokens.
 */
export const requirePlatformOrCitizen = (req, res, next) => {
    const allowed = ["admin", "organizer", "observer", "citizen"];
    if (!req.user || !allowed.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: "Debes ingresar al sistema para acceder a esta sección." });
    }
    next();
};
