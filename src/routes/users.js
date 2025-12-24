const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const { auth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const router = express.Router();

// Configure multer for memory storage
const uploadAvatar = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) cb(null, true);
        else cb(new Error('Only image files allowed'));
    }
});

// ... (existing code)

// Upload avatar with error handling
router.get('/me', auth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                avatar: true,
                phone: true,
                createdAt: true,
                _count: {
                    select: {
                        wishlist: true,
                        addresses: true
                    }
                }
            }
        });

        if (!user) return res.status(404).json({ message: 'User not found' });

        // Get orders count separately (excluding CANCELLED and FAILED payment status)
        const ordersCount = await prisma.order.count({
            where: {
                userId: req.user.userId,
                status: { not: 'CANCELLED' },
                paymentStatus: { not: 'FAILED' }
            }
        });

        res.json({
            ...user,
            _count: {
                ...user._count,
                orders: ordersCount
            }
        });
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ message: 'Failed to fetch profile' });
    }
});

// Update profile (name, phone)
router.patch('/me', auth, async (req, res) => {
    try {
        const { name, phone } = req.body;

        const user = await prisma.user.update({
            where: { id: req.user.userId },
            data: {
                name: name || undefined,
                phone: phone || undefined
            },
            select: {
                id: true, email: true, name: true, role: true, avatar: true, phone: true
            }
        });

        res.json(user);
    } catch (error) {
        console.error('Update Profile Error:', error);
        res.status(500).json({ message: 'Failed to update profile' });
    }
});

router.post('/me/avatar', auth, (req, res) => {
    uploadAvatar.single('avatar')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'File too large. Maximum size is 10MB.' });
            }
            return res.status(400).json({ message: err.message || 'Upload failed' });
        }

        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const filename = `avatars/avatar-${req.user.userId}-${Date.now()}.webp`;

            // Delete old avatar if it was a local file (legacy support)
            const currentUser = await prisma.user.findUnique({ where: { id: req.user.userId } });
            if (currentUser.avatar && !currentUser.avatar.startsWith('http')) {
                const oldPath = path.join(__dirname, '../../', currentUser.avatar);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            // Helper to delete old Supabase avatar if exists
            if (currentUser.avatar && currentUser.avatar.includes('supabase')) {
                // Extract path after bucket name (e.g. avatars/filename.webp)
                const oldPath = currentUser.avatar.split('/storage/v1/object/public/infinite-creations/')[1];
                if (oldPath) {
                    await supabase.storage.from('infinite-creations').remove([oldPath]);
                }
            }

            // Compress image
            const buffer = await sharp(req.file.buffer)
                .resize(400, 400, { fit: 'cover', position: 'center' }) // Square crop for avatars
                .webp({ quality: 80 })
                .toBuffer();

            // Upload to Supabase
            const { data, error } = await supabase.storage
                .from('infinite-creations')
                .upload(filename, buffer, {
                    contentType: 'image/webp',
                    upsert: true
                });

            if (error) {
                console.error('Supabase Upload Error:', error);
                throw new Error(`Supabase upload failed: ${error.message}`);
            }

            const { data: publicUrlData } = supabase.storage
                .from('infinite-creations')
                .getPublicUrl(filename);

            // Ensure we get a valid URL
            const avatarUrl = publicUrlData.publicUrl;

            const user = await prisma.user.update({
                where: { id: req.user.userId },
                data: { avatar: avatarUrl },
                select: { id: true, email: true, name: true, phone: true, avatar: true, role: true }
            });
            res.json(user);
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Failed to upload avatar' });
        }
    });
});

// Change password
router.post('/me/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        const validPassword = await bcrypt.compare(currentPassword, user.password);

        if (!validPassword) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: req.user.userId },
            data: { password: hashedPassword }
        });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to change password' });
    }
});

// ============ ADDRESSES ============

// Get all addresses
router.get('/me/addresses', auth, async (req, res) => {
    try {
        const addresses = await prisma.address.findMany({
            where: { userId: req.user.userId },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
        });
        res.json(addresses);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get addresses' });
    }
});

// Add address
router.post('/me/addresses', auth, async (req, res) => {
    try {
        const { label, name, phone, address, city, state, zip, country, isDefault } = req.body;

        // If setting as default, unset other defaults
        if (isDefault) {
            await prisma.address.updateMany({
                where: { userId: req.user.userId },
                data: { isDefault: false }
            });
        }

        const newAddress = await prisma.address.create({
            data: {
                label: label || 'Home',
                name, phone, address, city, state, zip,
                country: country || 'USA',
                isDefault: isDefault || false,
                userId: req.user.userId
            }
        });
        res.status(201).json(newAddress);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add address' });
    }
});

// Update address
router.patch('/me/addresses/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { label, name, phone, address, city, state, zip, country, isDefault } = req.body;

        // Verify ownership
        const existing = await prisma.address.findFirst({
            where: { id, userId: req.user.userId }
        });
        if (!existing) {
            return res.status(404).json({ message: 'Address not found' });
        }

        // If setting as default, unset other defaults
        if (isDefault) {
            await prisma.address.updateMany({
                where: { userId: req.user.userId, NOT: { id } },
                data: { isDefault: false }
            });
        }

        const updated = await prisma.address.update({
            where: { id },
            data: { label, name, phone, address, city, state, zip, country, isDefault }
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update address' });
    }
});

// Delete address
router.delete('/me/addresses/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const existing = await prisma.address.findFirst({
            where: { id, userId: req.user.userId }
        });
        if (!existing) {
            return res.status(404).json({ message: 'Address not found' });
        }

        await prisma.address.delete({ where: { id } });
        res.json({ message: 'Address deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete address' });
    }
});

// Set default address
router.post('/me/addresses/:id/default', auth, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const existing = await prisma.address.findFirst({
            where: { id, userId: req.user.userId }
        });
        if (!existing) {
            return res.status(404).json({ message: 'Address not found' });
        }

        // Unset all defaults
        await prisma.address.updateMany({
            where: { userId: req.user.userId },
            data: { isDefault: false }
        });

        // Set this as default
        const updated = await prisma.address.update({
            where: { id },
            data: { isDefault: true }
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to set default address' });
    }
});

// ============ WISHLIST ============

// Get wishlist
router.get('/me/wishlist', auth, async (req, res) => {
    try {
        const wishlist = await prisma.wishlistItem.findMany({
            where: { userId: req.user.userId },
            include: {
                product: {
                    include: { category: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(wishlist.map(w => w.product));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get wishlist' });
    }
});

// Add to wishlist
router.post('/me/wishlist/:productId', auth, async (req, res) => {
    try {
        const { productId } = req.params;

        // Check if already in wishlist
        const existing = await prisma.wishlistItem.findUnique({
            where: { userId_productId: { userId: req.user.userId, productId } }
        });
        if (existing) {
            return res.json({ message: 'Already in wishlist', inWishlist: true });
        }

        await prisma.wishlistItem.create({
            data: { userId: req.user.userId, productId }
        });
        res.status(201).json({ message: 'Added to wishlist', inWishlist: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add to wishlist' });
    }
});

// Remove from wishlist
router.delete('/me/wishlist/:productId', auth, async (req, res) => {
    try {
        const { productId } = req.params;

        await prisma.wishlistItem.deleteMany({
            where: { userId: req.user.userId, productId }
        });
        res.json({ message: 'Removed from wishlist', inWishlist: false });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to remove from wishlist' });
    }
});

// Check if product is in wishlist
router.get('/me/wishlist/:productId/check', auth, async (req, res) => {
    try {
        const { productId } = req.params;
        const existing = await prisma.wishlistItem.findUnique({
            where: { userId_productId: { userId: req.user.userId, productId } }
        });
        res.json({ inWishlist: !!existing });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to check wishlist' });
    }
});

module.exports = router;
