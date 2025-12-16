const express = require('express');
const prisma = require('../config/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Validate coupon (public - for checkout)
router.post('/validate', auth, async (req, res) => {
    try {
        const { code, subtotal } = req.body;

        const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });

        if (!coupon) {
            return res.status(404).json({ message: 'Invalid coupon code' });
        }

        if (!coupon.active) {
            return res.status(400).json({ message: 'This coupon is no longer active' });
        }

        if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
            return res.status(400).json({ message: 'This coupon has expired' });
        }

        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
            return res.status(400).json({ message: 'This coupon has reached its usage limit' });
        }

        if (coupon.minOrderValue && subtotal < Number(coupon.minOrderValue)) {
            return res.status(400).json({ message: `Minimum order value is $${Number(coupon.minOrderValue).toFixed(2)}` });
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = (subtotal * Number(coupon.discountValue)) / 100;
        } else {
            discount = Math.min(Number(coupon.discountValue), subtotal);
        }

        res.json({
            valid: true,
            code: coupon.code,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            discount: discount.toFixed(2),
            description: coupon.description,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to validate coupon' });
    }
});

// Get all coupons (Admin)
router.get('/', auth, adminOnly, async (req, res) => {
    try {
        const coupons = await prisma.coupon.findMany({
            orderBy: { createdAt: 'desc' },
        });
        res.json(coupons);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get coupons' });
    }
});

// Create coupon (Admin)
router.post('/', auth, adminOnly, async (req, res) => {
    try {
        const { code, description, discountType, discountValue, minOrderValue, maxUses, expiresAt } = req.body;

        const coupon = await prisma.coupon.create({
            data: {
                code: code.toUpperCase(),
                description,
                discountType: discountType || 'percentage',
                discountValue: parseFloat(discountValue),
                minOrderValue: minOrderValue ? parseFloat(minOrderValue) : null,
                maxUses: maxUses ? parseInt(maxUses) : null,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
            },
        });

        res.status(201).json(coupon);
    } catch (error) {
        console.error(error);
        if (error.code === 'P2002') {
            return res.status(400).json({ message: 'Coupon code already exists' });
        }
        res.status(500).json({ message: 'Failed to create coupon' });
    }
});

// Update coupon (Admin)
router.patch('/:id', auth, adminOnly, async (req, res) => {
    try {
        const { code, description, discountType, discountValue, minOrderValue, maxUses, expiresAt, active } = req.body;
        const data = {};

        if (code) data.code = code.toUpperCase();
        if (description !== undefined) data.description = description;
        if (discountType) data.discountType = discountType;
        if (discountValue !== undefined) data.discountValue = parseFloat(discountValue);
        if (minOrderValue !== undefined) data.minOrderValue = minOrderValue ? parseFloat(minOrderValue) : null;
        if (maxUses !== undefined) data.maxUses = maxUses ? parseInt(maxUses) : null;
        if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
        if (active !== undefined) data.active = active;

        const coupon = await prisma.coupon.update({
            where: { id: req.params.id },
            data,
        });

        res.json(coupon);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update coupon' });
    }
});

// Delete coupon (Admin)
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        await prisma.coupon.delete({ where: { id: req.params.id } });
        res.json({ message: 'Coupon deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete coupon' });
    }
});

module.exports = router;
