import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { getJwtSecret } from "../config/jwt.js";

export const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            error: "Not authorized"
        });
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        req.user = await User.findById(decoded.id).select("-password");
        if (!req.user) {
            return res.status(401).json({ success: false, error: "Not authorized" });
        }
        next();
    } catch {
        res.status(401).json({
            success: false,
            error: "Token invalid"
        });
    }
};

export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: "User role not authorized"
            });
        }
        next();
    };
};
