import User from "../models/User.js";

const ALLOWED_ROLES = new Set(["admin", "organizer", "observer"]);

function normalizeRole(rawRole) {
    if (rawRole === undefined || rawRole === null || rawRole === "") return null;
    const lowered = String(rawRole).trim().toLowerCase();
    if (lowered === "client" || lowered === "cliente") return "organizer";
    if (!ALLOWED_ROLES.has(lowered)) {
        const err = new Error(`Rol inválido "${rawRole}". Usa admin, organizer u observer.`);
        err.statusCode = 400;
        throw err;
    }
    return lowered;
}

function sanitizeUser(userDoc) {
    const obj = typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };
    delete obj.password;
    return obj;
}

/**
 * Admin: Get all users
 */
export const getUsers = async (_req, res) => {
    try {
        const users = await User.find().select("-password").sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: users });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * Admin: Create a new user with explicit role (organizer, admin, observer)
 * POST /api/users
 */
export const createUser = async (req, res) => {
    try {
        const { username, email, password, organization = "", role = "organizer", country = "Chile" } = req.body;

        const cleanUsername = String(username || "").trim();
        const cleanEmail = String(email || "").trim();
        if (!cleanUsername || !cleanEmail || !password) {
            return res.status(400).json({
                success: false,
                message: "Nombre de usuario, correo y contraseña son obligatorios."
            });
        }
        if (String(password).length < 6) {
            return res.status(400).json({
                success: false,
                message: "La contraseña debe tener al menos 6 caracteres."
            });
        }

        const resolvedRole = normalizeRole(role) || "organizer";
        const existing = await User.findOne({ $or: [{ email: cleanEmail }, { username: cleanUsername }] });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "Ya existe un usuario con ese correo o nombre de usuario."
            });
        }

        const user = await User.create({
            username: cleanUsername,
            email: cleanEmail,
            password: String(password),
            organization: String(organization || "").trim(),
            country: String(country || "Chile").trim() || "Chile",
            role: resolvedRole
        });

        res.status(201).json({ success: true, data: sanitizeUser(user) });
    } catch (err) {
        const status = err.statusCode || (err.code === 11000 ? 409 : err.name === "ValidationError" ? 400 : 500);
        res.status(status).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * Admin: Update user (username, email, organization, role, optional password)
 * PUT /api/users/:id
 */
export const updateUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        const { username, email, organization, country, role, password } = req.body;

        if (username !== undefined) {
            const cleanUsername = String(username).trim();
            if (!cleanUsername) {
                return res.status(400).json({ success: false, message: "El nombre de usuario no puede estar vacío." });
            }
            if (cleanUsername !== user.username) {
                const dupUser = await User.findOne({ username: cleanUsername, _id: { $ne: user._id } });
                if (dupUser) {
                    return res.status(409).json({ success: false, message: "Ese nombre de usuario ya está en uso." });
                }
            }
            user.username = cleanUsername;
        }

        if (email !== undefined) {
            const cleanEmail = String(email).trim();
            if (!cleanEmail) {
                return res.status(400).json({ success: false, message: "El correo no puede estar vacío." });
            }
            if (cleanEmail !== user.email) {
                const dupEmail = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
                if (dupEmail) {
                    return res.status(409).json({ success: false, message: "Ese correo ya está en uso." });
                }
            }
            user.email = cleanEmail;
        }

        if (organization !== undefined) {
            user.organization = String(organization || "").trim();
        }

        if (country !== undefined && String(country).trim()) {
            user.country = String(country).trim();
        }

        if (role !== undefined) {
            user.role = normalizeRole(role);
        }

        if (password !== undefined && String(password).length > 0) {
            if (String(password).length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "La nueva contraseña debe tener al menos 6 caracteres."
                });
            }
            user.password = String(password);
        }

        await user.save();
        res.status(200).json({ success: true, data: sanitizeUser(user) });
    } catch (err) {
        const status = err.statusCode || (err.code === 11000 ? 409 : err.name === "ValidationError" ? 400 : 500);
        res.status(status).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * Admin: Delete user
 */
export const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        res.status(200).json({ success: true, message: "Usuario eliminado" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
};
