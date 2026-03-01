import jwt from 'jsonwebtoken';

/**
 * Optional JWT middleware — attaches req.user if token is present.
 * Does NOT block the request if no token is provided.
 */
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || '123456789qwertyuio');
            req.user = decoded;
        } catch {
            // token invalid or expired — proceed without user
        }
    }
    next();
};

/**
 * Required JWT middleware — blocks request with 401 if no valid token.
 */
export const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No autorizado. Token requerido.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || '123456789qwertyuio');
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado.' });
    }
};

/**
 * Admin-only middleware — blocks if not role=admin.
 */
export const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso restringido a administradores.' });
    }
    next();
};
