const express = require('express');
const prisma = require('../config/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Get all settings (public - for frontend to read promo bar, etc.)
router.get('/', async (req, res) => {
    try {
        const settings = await prisma.setting.findMany();
        // Convert to key-value object
        const settingsObj = {};
        settings.forEach(s => {
            try {
                settingsObj[s.key] = JSON.parse(s.value);
            } catch {
                settingsObj[s.key] = s.value;
            }
        });
        res.json(settingsObj);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get settings' });
    }
});

// Get a single setting
router.get('/:key', async (req, res) => {
    try {
        const setting = await prisma.setting.findUnique({
            where: { key: req.params.key }
        });
        if (!setting) {
            return res.json({ value: null });
        }
        try {
            res.json({ value: JSON.parse(setting.value) });
        } catch {
            res.json({ value: setting.value });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get setting' });
    }
});

// Update or create a setting (Admin only)
router.post('/', auth, adminOnly, async (req, res) => {
    try {
        const { key, value } = req.body;
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        const setting = await prisma.setting.upsert({
            where: { key },
            update: { value: stringValue },
            create: { key, value: stringValue }
        });

        res.json(setting);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update setting' });
    }
});

// Update multiple settings (Admin only)
router.post('/bulk', auth, adminOnly, async (req, res) => {
    try {
        const { settings } = req.body;

        const results = await Promise.all(
            Object.entries(settings).map(([key, value]) => {
                const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                return prisma.setting.upsert({
                    where: { key },
                    update: { value: stringValue },
                    create: { key, value: stringValue }
                });
            })
        );

        res.json({ message: 'Settings updated', count: results.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update settings' });
    }
});

module.exports = router;
