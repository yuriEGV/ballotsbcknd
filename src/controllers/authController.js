import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwt.js";

const sendTokenResponse = (user, statusCode, res) => {
    const token = jwt.sign(
        { id: user._id.toString(), role: user.role, email: user.email },
        getJwtSecret(),
        { expiresIn: "30d" }
    );

    const options = {
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        httpOnly: true
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
        const { username, email, password, organization, country } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: "Todos los campos obligatorios son requeridos" });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 6 caracteres" });
        }

        const existing = await User.findOne({ $or: [{ email }, { username }] });
        if (existing) {
            return res.status(400).json({ success: false, message: "El usuario o correo ya existe" });
        }

        // Security: never allow self-assignment of admin role during public signup
        const user = await User.create({
            username,
            email,
            password,
            organization: organization || "",
            country: country || "Chile",
            role: "organizer"
        });
        sendTokenResponse(user, 201, res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Please provide email and password" });
        }

        const user = await User.findOne({ email });
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
