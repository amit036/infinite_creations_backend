const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting seed...');

    // Clear existing data
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.wishlistItem.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.coupon.deleteMany();
    await prisma.address.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.user.deleteMany();

    // Create admin user
    const adminPassword = await bcrypt.hash('password123', 10);
    const admin = await prisma.user.create({
        data: {
            email: 'admin@shop.com',
            password: adminPassword,
            name: 'Admin User',
            role: 'ADMIN',
        },
    });
    console.log('✅ Admin:', admin.email);

    // Create regular user
    const userPassword = await bcrypt.hash('password123', 10);
    const user = await prisma.user.create({
        data: {
            email: 'user@shop.com',
            password: userPassword,
            name: 'John Doe',
            phone: '+91 98765 43210',
        },
    });
    console.log('✅ User:', user.email);

    // Create categories
    const categories = await Promise.all([
        prisma.category.create({
            data: { name: 'Electronics', slug: 'electronics', description: 'Latest gadgets and tech' },
        }),
        prisma.category.create({
            data: { name: 'Clothing', slug: 'clothing', description: 'Fashion and apparel' },
        }),
        prisma.category.create({
            data: { name: 'Home & Living', slug: 'home-living', description: 'Home decor and furniture' },
        }),
        prisma.category.create({
            data: { name: 'Accessories', slug: 'accessories', description: 'Bags, watches and more' },
        }),
    ]);
    console.log('✅ Created', categories.length, 'categories');

    // Create products with multiple images (using placeholder URLs)
    const products = [
        {
            name: 'Premium Wireless Headphones',
            slug: 'premium-wireless-headphones',
            description: 'High-quality wireless headphones with active noise cancellation, 30-hour battery life, and premium sound quality. Perfect for music lovers and professionals.',
            price: 12999.00,
            salePrice: 9999.00,
            stock: 50,
            images: [
                'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
                'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=500',
                'https://images.unsplash.com/photo-1524678606370-a47ad25cb82a?w=500',
            ],
            featured: true,
            categoryId: categories[0].id,
        },
        {
            name: 'Smart Watch Pro',
            slug: 'smart-watch-pro',
            description: 'Advanced smartwatch with health monitoring, GPS, water resistance and 7-day battery. Stay connected and healthy on the go.',
            price: 24999.00,
            salePrice: 19999.00,
            stock: 30,
            images: [
                'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
                'https://images.unsplash.com/photo-1617043786394-f977fa12eddf?w=500',
                'https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=500',
            ],
            featured: true,
            categoryId: categories[0].id,
        },
        {
            name: 'Premium Cotton T-Shirt',
            slug: 'cotton-tshirt',
            description: 'Soft organic cotton t-shirt with a comfortable fit. Available in multiple colors. Perfect for everyday casual wear.',
            price: 1499.00,
            salePrice: 999.00,
            stock: 200,
            images: [
                'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500',
                'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=500',
                'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=500',
            ],
            featured: false,
            categoryId: categories[1].id,
        },
        {
            name: 'Designer Denim Jacket',
            slug: 'denim-jacket',
            description: 'Classic denim jacket with modern styling. Features vintage wash and premium stitching. A wardrobe essential for all seasons.',
            price: 4999.00,
            salePrice: null,
            stock: 75,
            images: [
                'https://images.unsplash.com/photo-1551537482-f2075a1d41f2?w=500',
                'https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?w=500',
            ],
            featured: true,
            categoryId: categories[1].id,
        },
        {
            name: 'Minimalist Desk Lamp',
            slug: 'desk-lamp',
            description: 'Modern LED desk lamp with adjustable brightness and color temperature. USB charging port included. Perfect for home office.',
            price: 2499.00,
            salePrice: 1999.00,
            stock: 100,
            images: [
                'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500',
                'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=500',
                'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?w=500',
            ],
            featured: false,
            categoryId: categories[2].id,
        },
        {
            name: 'Premium Throw Blanket',
            slug: 'throw-blanket',
            description: 'Luxuriously soft throw blanket made from ultra-soft microfiber. Perfect for cozy evenings. Machine washable.',
            price: 3499.00,
            salePrice: null,
            stock: 60,
            images: [
                'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500',
                'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=500',
            ],
            featured: false,
            categoryId: categories[2].id,
        },
        {
            name: 'Leather Messenger Bag',
            slug: 'leather-messenger-bag',
            description: 'Handcrafted genuine leather messenger bag with laptop compartment. Multiple pockets for organization. Professional look for work and travel.',
            price: 7999.00,
            salePrice: 5999.00,
            stock: 40,
            images: [
                'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500',
                'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500',
                'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500',
            ],
            featured: true,
            categoryId: categories[3].id,
        },
        {
            name: 'Classic Aviator Sunglasses',
            slug: 'aviator-sunglasses',
            description: 'Timeless aviator sunglasses with UV400 protection. Premium metal frame with adjustable nose pads for comfort.',
            price: 2999.00,
            salePrice: 2499.00,
            stock: 80,
            images: [
                'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=500',
                'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=500',
            ],
            featured: false,
            categoryId: categories[3].id,
        },
        {
            name: 'Wireless Bluetooth Speaker',
            slug: 'bluetooth-speaker',
            description: '360° surround sound Bluetooth speaker with deep bass. IPX7 waterproof, 24-hour playtime. Perfect for indoor and outdoor use.',
            price: 5999.00,
            salePrice: 4499.00,
            stock: 45,
            images: [
                'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=500',
                'https://images.unsplash.com/photo-1589003077984-894e133dabab?w=500',
            ],
            featured: true,
            categoryId: categories[0].id,
        },
        {
            name: 'Ergonomic Office Chair',
            slug: 'ergonomic-chair',
            description: 'Premium ergonomic office chair with lumbar support, adjustable armrests, and breathable mesh back. Work comfortably all day.',
            price: 15999.00,
            salePrice: 12999.00,
            stock: 25,
            images: [
                'https://images.unsplash.com/photo-1580480055273-228ff5388ef8?w=500',
                'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?w=500',
                'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=500',
            ],
            featured: true,
            categoryId: categories[2].id,
        },
    ];

    for (const product of products) {
        await prisma.product.create({ data: product });
    }
    console.log('✅ Created', products.length, 'products');

    // Create coupons
    const coupons = await Promise.all([
        prisma.coupon.create({
            data: {
                code: 'WELCOME10',
                description: '10% off your first order',
                discountType: 'percentage',
                discountValue: 10,
                maxUses: 1000,
                active: true,
            },
        }),
        prisma.coupon.create({
            data: {
                code: 'SAVE500',
                description: '₹500 off orders over ₹5000',
                discountType: 'fixed',
                discountValue: 500,
                minOrderValue: 5000,
                maxUses: 100,
                active: true,
            },
        }),
        prisma.coupon.create({
            data: {
                code: 'FLASH25',
                description: '25% off - Limited Time!',
                discountType: 'percentage',
                discountValue: 25,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                active: true,
            },
        }),
    ]);
    console.log('✅ Created', coupons.length, 'coupons');

    // Create default settings
    const defaultSettings = [
        { key: 'promoBarEnabled', value: 'true' },
        { key: 'promoBarMessage', value: '🎉 Free shipping on orders over ₹2,000 | Use code WELCOME10 for 10% off!' },
        { key: 'promoBarBgColor', value: '#4f46e5' },
        { key: 'promoBarTextColor', value: '#ffffff' },
        { key: 'freeShippingThreshold', value: '2000' },
        { key: 'defaultShippingCost', value: '99' },
        { key: 'paymentMethods', value: JSON.stringify({ paypal: true, cod: true }) },
    ];

    for (const setting of defaultSettings) {
        await prisma.setting.create({ data: setting });
    }
    console.log('✅ Created', defaultSettings.length, 'default settings');

    console.log('✅ Seeding completed!');
    console.log('\n📋 Demo Coupons:');
    console.log('   WELCOME10 - 10% off');
    console.log('   SAVE500 - ₹500 off orders over ₹5000');
    console.log('   FLASH25 - 25% off (expires in 7 days)');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
