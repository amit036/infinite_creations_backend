const express = require('express');
const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// All order routes require authentication
router.use(auth);

// Create order (accepts items from frontend for client-side cart)
router.post('/', async (req, res) => {
    try {
        const {
            shippingName, shippingAddress, shippingCity, shippingState, shippingZip, shippingPhone,
            couponCode, items, paymentMethod
        } = req.body;

        // Items should come from the frontend (client-side cart)
        if (!items || items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        // Validate and get product details
        const cartItems = [];
        for (const item of items) {
            const product = await prisma.product.findUnique({ where: { id: item.id } });
            if (!product) {
                return res.status(400).json({ message: `Product not found: ${item.name}` });
            }
            if (product.stock < item.quantity) {
                return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
            }
            cartItems.push({
                product,
                quantity: item.quantity,
                price: product.salePrice || product.price,
            });
        }

        // Calculate subtotal
        let subtotal = cartItems.reduce((sum, item) => {
            return sum + Number(item.price) * item.quantity;
        }, 0);

        // Apply coupon if provided
        let discount = 0;
        let appliedCoupon = null;
        if (couponCode) {
            appliedCoupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
            if (appliedCoupon && appliedCoupon.active) {
                if (appliedCoupon.discountType === 'percentage') {
                    discount = (subtotal * Number(appliedCoupon.discountValue)) / 100;
                } else {
                    discount = Math.min(Number(appliedCoupon.discountValue), subtotal);
                }
            }
        }

        const totalAmount = subtotal - discount;

        // Create order with transaction
        const order = await prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
                data: {
                    orderNumber: `ORD-${Date.now()}-${uuid().slice(0, 4).toUpperCase()}`,
                    userId: req.user.userId,
                    totalAmount,
                    discount,
                    couponCode: appliedCoupon?.code || null,
                    paymentMethod: paymentMethod || 'COD',
                    paymentStatus: paymentMethod === 'PAYPAL' ? 'PENDING' : 'COD_PENDING',
                    shippingName,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZip,
                    shippingPhone,
                    items: {
                        create: cartItems.map(item => ({
                            productId: item.product.id,
                            quantity: item.quantity,
                            price: item.price,
                        })),
                    },
                },
                include: { items: { include: { product: true } } },
            });

            // Update stock
            for (const item of cartItems) {
                await tx.product.update({
                    where: { id: item.product.id },
                    data: { stock: { decrement: item.quantity } },
                });
            }

            // Update coupon usage
            if (appliedCoupon) {
                await tx.coupon.update({
                    where: { id: appliedCoupon.id },
                    data: { usedCount: { increment: 1 } },
                });
            }

            return newOrder;
        });

        res.status(201).json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to create order' });
    }
});

// Get user's orders
router.get('/my-orders', async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: req.user.userId },
            include: { items: { include: { product: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get orders' });
    }
});

// Get all orders (Admin only)
router.get('/', adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {};
        if (status) where.status = status;

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                skip,
                take: parseInt(limit),
                include: {
                    customer: { select: { name: true, email: true } },
                    items: { include: { product: true } },
                },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.order.count({ where }),
        ]);

        res.json({
            data: orders,
            meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get orders' });
    }
});

// Get single order
router.get('/:id', async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                customer: { select: { name: true, email: true } },
                items: { include: { product: true } },
            },
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Check if user owns the order or is admin
        if (order.userId !== req.user.userId && req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get order' });
    }
});

// Update order status (Admin only)
router.patch('/:id/status', adminOnly, async (req, res) => {
    try {
        const { status } = req.body;
        const order = await prisma.order.update({
            where: { id: req.params.id },
            data: { status },
        });
        res.json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update order' });
    }
});

module.exports = router;
