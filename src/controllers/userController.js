import User from '../models/User.js';

/**
 * Admin: Get all users
 */
export const getUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Admin: Update user (role, organization, etc.)
 */
export const updateUser = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).select('-password');
        if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        res.status(200).json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
    }
};
