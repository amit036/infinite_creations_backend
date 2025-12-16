const express = require('express');
const prisma = require('../config/prisma');
const { auth } = require('../middleware/auth');

const router = express.Router();

// All cart routes require authentication
router.use(auth);

// Get user's cart
router.get('/', async (req, res) => {
    try {
        const items = await prisma.cartItem.findMany({
            where: { userId: req.user.userId },
            include: { product: { include: { category: true } } },
            orderBy: { createdAt: 'desc' },
        });

        const total = items.reduce((sum, item) => {
            const price = item.product.salePrice || item.product.price;
            return sum + Number(price) * item.quantity;
        }, 0);

        res.json({ items, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get cart' });
    }
});

// Add to cart
router.post('/add', async (req, res) => {
    try {
        const { productId, quantity = 1 } = req.body;

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const existing = await prisma.cartItem.findUnique({
            where: { userId_productId: { userId: req.user.userId, productId } },
        });

        let item;
        if (existing) {
            item = await prisma.cartItem.update({
                where: { id: existing.id },
                data: { quantity: existing.quantity + quantity },
                include: { product: true },
            });
        } else {
            item = await prisma.cartItem.create({
                data: { userId: req.user.userId, productId, quantity },
                include: { product: true },
            });
        }

        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add to cart' });
    }
});

// Update quantity
router.patch('/:productId', async (req, res) => {
    try {
        const { quantity } = req.body;

        if (quantity <= 0) {
            await prisma.cartItem.delete({
                where: { userId_productId: { userId: req.user.userId, productId: req.params.productId } },
            });
            return res.json({ message: 'Item removed' });
        }

        const item = await prisma.cartItem.update({
            where: { userId_productId: { userId: req.user.userId, productId: req.params.productId } },
            data: { quantity },
            include: { product: true },
        });

        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update cart' });
    }
});

// Remove from cart
router.delete('/:productId', async (req, res) => {
    try {
        await prisma.cartItem.delete({
            where: { userId_productId: { userId: req.user.userId, productId: req.params.productId } },
        });
        res.json({ message: 'Item removed' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to remove from cart' });
    }
});

// Clear cart
router.delete('/', async (req, res) => {
    try {
        await prisma.cartItem.deleteMany({ where: { userId: req.user.userId } });
        res.json({ message: 'Cart cleared' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to clear cart' });
    }
});

module.exports = router;
