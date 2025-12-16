require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
require('./cron/cleanup'); // Start cron jobs


const authRoutes = require('./routes/auth');

// Debug Supabase Connection
const supabase = require('./config/supabase');
(async () => {
    try {
        const { data, error } = await supabase.storage.listBuckets();
        if (error) console.error('❌ Supabase Bucket Check Failed:', error.message);
        else console.log('✅ Connected to Supabase. Available Buckets:', data.map(b => b.name));
    } catch (err) {
        console.error('❌ Supabase Connection Error:', err);
    }
})();

const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const couponRoutes = require('./routes/coupons');
const settingsRoutes = require('./routes/settings');
const paymentRoutes = require('./routes/payments');

const app = express();

// Middleware
app.use(cors({
    origin: '*', // Allow all origins for production testing
    credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/products', productRoutes);
app.use('/categories', categoryRoutes);
app.use('/cart', cartRoutes);
app.use('/orders', orderRoutes);
app.use('/coupons', couponRoutes);
app.use('/settings', settingsRoutes);
app.use('/payments', paymentRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong', error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
