const express = require('express');
const prisma = require('../config/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            include: { _count: { select: { products: true } } },
            orderBy: { name: 'asc' },
        });
        res.json(categories);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get categories' });
    }
});

// Get category by slug
router.get('/:slug', async (req, res) => {
    try {
        const category = await prisma.category.findUnique({
            where: { slug: req.params.slug },
            include: { _count: { select: { products: true } } },
        });
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get category' });
    }
});

// Create category (Admin only)
router.post('/', auth, adminOnly, async (req, res) => {
    try {
        const { name, slug, description, image } = req.body;
        const category = await prisma.category.create({
            data: { name, slug, description, image },
        });
        res.status(201).json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to create category' });
    }
});

// Update category (Admin only)
router.patch('/:id', auth, adminOnly, async (req, res) => {
    try {
        const { name, slug, description, image } = req.body;
        const category = await prisma.category.update({
            where: { id: req.params.id },
            data: { name, slug, description, image },
        });
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update category' });
    }
});

// Delete category (Admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        await prisma.category.delete({ where: { id: req.params.id } });
        res.json({ message: 'Category deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete category' });
    }
});

module.exports = router;
