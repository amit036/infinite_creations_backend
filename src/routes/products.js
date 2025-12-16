const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Multer config for file uploads - use memory storage for compression
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) cb(null, true);
        else cb(new Error('Only image files allowed'));
    }
});

// Compress and upload image to Supabase
async function processAndSaveImage(file) {
    const filename = `products/${uuid()}.webp`;

    // Resize and convert to WebP buffer
    const buffer = await sharp(file.buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
        .from('infinite-creations')
        .upload(filename, buffer, {
            contentType: 'image/webp',
            cacheControl: '3600',
            upsert: false
        });

    if (error) {
        console.error('Supabase Upload Error:', error);
        throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
        .from('infinite-creations')
        .getPublicUrl(filename);

    return publicUrlData.publicUrl;
}

// Get all products
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 12, search, category, featured, includeInactive } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let where = { active: true };

        // Check for admin token to allow fetching inactive products
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.split(' ')[1];
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, process.env.JWT_SECRET);

                if (decoded.role === 'ADMIN' && (includeInactive === 'true' || includeInactive === true)) {
                    delete where.active; // Remove active filter for admin
                }
            } catch (e) {
                // Ignore invalid token
            }
        }

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (category) {
            where.category = { slug: category };
        }

        if (featured === 'true') {
            where.featured = true;
        }

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                skip,
                take: parseInt(limit),
                include: { category: true },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.product.count({ where }),
        ]);

        res.json({
            data: products,
            meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get products' });
    }
});

// Get featured products
router.get('/featured', async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { featured: true, active: true },
            include: { category: true },
            take: 8,
        });
        res.json(products);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get featured products' });
    }
});

// Get single product by slug
router.get('/:slug', async (req, res) => {
    try {
        const product = await prisma.product.findUnique({
            where: { slug: req.params.slug },
            include: { category: true },
        });

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Only show inactive products to admins
        if (!product.active) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const token = authHeader.split(' ')[1];
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    if (decoded.role !== 'ADMIN') {
                        return res.status(404).json({ message: 'Product not found' });
                    }
                } catch (e) {
                    return res.status(404).json({ message: 'Product not found' });
                }
            } else {
                return res.status(404).json({ message: 'Product not found' });
            }
        }

        res.json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get product' });
    }
});

// Upload product images (Admin only) with compression
router.post('/upload-images', auth, adminOnly, upload.array('images', 10), async (req, res) => {
    try {
        if (!req.files?.length) {
            return res.status(400).json({ message: 'No images uploaded' });
        }

        // Process and compress each image
        const imagePromises = req.files.map(file => processAndSaveImage(file));
        const images = await Promise.all(imagePromises);

        res.json({ images });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to upload images' });
    }
});

// Create product (Admin only)
router.post('/', auth, adminOnly, upload.array('images', 5), async (req, res) => {
    try {
        const { name, slug, description, price, salePrice, stock, categoryId, featured, active } = req.body;

        // Upload images if any
        let images = [];
        if (req.files && req.files.length > 0) {
            const imagePromises = req.files.map(file => processAndSaveImage(file));
            images = await Promise.all(imagePromises);
        }

        const product = await prisma.product.create({
            data: {
                name,
                slug,
                description,
                price: parseFloat(price),
                salePrice: salePrice ? parseFloat(salePrice) : null,
                stock: parseInt(stock) || 0,
                categoryId: categoryId || null,
                featured: featured === 'true',
                active: active === 'true' || active === true,
                images,
            },
            include: { category: true },
        });

        res.status(201).json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to create product' });
    }
});

// Update product (Admin only)
router.patch('/:id', auth, adminOnly, async (req, res) => {
    try {
        const { name, slug, description, price, salePrice, stock, categoryId, featured, active, images } = req.body;
        const data = {};

        if (name) data.name = name;
        if (slug) data.slug = slug;
        if (description !== undefined) data.description = description;
        if (price) data.price = parseFloat(price);
        if (salePrice !== undefined) data.salePrice = salePrice ? parseFloat(salePrice) : null;
        if (stock !== undefined) data.stock = parseInt(stock);
        if (categoryId !== undefined) data.categoryId = categoryId || null;
        if (featured !== undefined) data.featured = featured === true || featured === 'true';
        if (active !== undefined) data.active = active === true || active === 'true';
        if (images !== undefined) data.images = images;

        const product = await prisma.product.update({
            where: { id: req.params.id },
            data,
            include: { category: true },
        });

        res.json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update product' });
    }
});

// Delete product (Admin only)
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Find product to get images
        const product = await prisma.product.findUnique({ where: { id } });

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // 2. Delete images from Storage
        if (product.images && product.images.length > 0) {
            const filesToDelete = product.images
                .filter(url => url.includes('infinite-creations'))
                .map(url => {
                    const parts = url.split('/infinite-creations/');
                    return parts.length > 1 ? parts[1] : null;
                })
                .filter(Boolean);

            if (filesToDelete.length > 0) {
                const { error } = await supabase.storage.from('infinite-creations').remove(filesToDelete);
                if (error) console.error('Failed to delete images from storage:', error);
            }
        }

        // 3. Delete from DB
        await prisma.product.delete({ where: { id } });
        res.json({ message: 'Product deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete product' });
    }
});

module.exports = router;
