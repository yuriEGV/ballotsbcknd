import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwt.js";
import { isValidEmail } from "../middleware/security.js";

const sendTokenResponse = (user, statusCode, res) => {
    const token = jwt.sign(
        { id: user._id.toString(), role: user.role, email: user.email },
        getJwtSecret(),
        { expiresIn: "7d" }
    );

    const options = {
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
    };

    res.status(statusCode).cookie("token", token, options).json({
        success: true,
        token,
        user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            organization: user.organization
        }
    });
};

export const register = async (req, res) => {
    try {
        const { username, email, password, organization, country } = req.body || {};

        const cleanUsername = String(username || "").trim();
        const cleanEmail = String(email || "").trim().toLowerCase();

        if (!cleanUsername || !cleanEmail || typeof password !== "string" || !password) {
            return res.status(400).json({ success: false, message: "Todos los campos obligatorios son requeridos" });
        }
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ success: false, message: "Correo electrónico inválido" });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 6 caracteres" });
        }

        const existing = await User.findOne({
            $or: [{ email: cleanEmail }, { email: String(email || "").trim() }, { username: cleanUsername }]
        });
        if (existing) {
            return res.status(400).json({ success: false, message: "El usuario o correo ya existe" });
        }

        // Security: never allow self-assignment of admin role during public signup
        const user = await User.create({
            username: cleanUsername,
            email: cleanEmail,
            password,
            organization: String(organization || "").trim(),
            country: String(country || "Chile").trim() || "Chile",
            role: "organizer"
        });
        sendTokenResponse(user, 201, res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const rawEmail = typeof email === "string" ? email.trim() : "";
        if (!rawEmail || typeof password !== "string" || !password) {
            return res.status(400).json({ success: false, message: "Please provide email and password" });
        }

        const loweredEmail = rawEmail.toLowerCase();
        const user = await User.findOne(
            rawEmail === loweredEmail
                ? { email: loweredEmail }
                : { $or: [{ email: rawEmail }, { email: loweredEmail }] }
        );
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        sendTokenResponse(user, 200, res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password");
        if (!user) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }
        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                organization: user.organization
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const logout = async (_req, res) => {
    res.status(200).json({ success: true, data: {} });
};
