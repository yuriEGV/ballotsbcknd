import Coupon from '../models/Coupon.js';

export const validateCoupon = async (req, res) => {
    try {
        const cleanCode = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";

        if (!cleanCode) {
            return res.status(400).json({ message: 'El código del cupón es requerido.' });
        }

        const coupon = await Coupon.findOne({
            code: cleanCode,
            isActive: true
        });

        if (!coupon) {
            return res.status(404).json({ message: 'Cupón inválido o inactivo.' });
        }

        if (coupon.validUntil && new Date() > new Date(coupon.validUntil)) {
            return res.status(400).json({ message: 'El cupón ha expirado.' });
        }

        res.status(200).json({
            success: true,
            discountPercentage: coupon.discountPercentage
        });

    } catch (error) {
        console.error('Validate coupon error:', error);
        res.status(500).json({ message: 'Error interno al validar el cupón.' });
    }
};

export const createCoupon = async (req, res) => {
    try {
        const { code, discountPercentage, validUntil } = req.body || {};
        const cleanCode = String(code || "").trim().toUpperCase();
        const discount = Number(discountPercentage);

        if (!cleanCode) {
            return res.status(400).json({ message: 'El código del cupón es requerido.' });
        }
        if (!Number.isFinite(discount) || discount < 1 || discount > 100) {
            return res.status(400).json({ message: 'El porcentaje de descuento debe estar entre 1 y 100.' });
        }

        const existing = await Coupon.findOne({ code: cleanCode });
        if (existing) {
            return res.status(400).json({ message: 'El código de cupón ya existe.' });
        }

        const newCoupon = new Coupon({
            code: cleanCode,
            discountPercentage: discount,
            validUntil
        });

        await newCoupon.save();
        res.status(201).json({ success: true, coupon: newCoupon });
    } catch (error) {
        console.error('Create coupon error:', error);
        res.status(500).json({ message: 'Error interno al crear el cupón.' });
    }
};

export const getAllCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: coupons });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const toggleCouponStatus = async (req, res) => {
    try {
        const coupon = await Coupon.findById(req.params.id);
        if (!coupon) return res.status(404).json({ success: false, message: "Cupón no encontrado" });
        coupon.isActive = !coupon.isActive;
        await coupon.save();
        res.status(200).json({ success: true, data: coupon });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteCoupon = async (req, res) => {
    try {
        await Coupon.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: "Cupón eliminado" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
