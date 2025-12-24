const express = require('express');
const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { sendOrderConfirmationEmail, sendOrderStatusUpdateEmail } = require('../services/emailService');
const { generateInvoicePdf } = require('../services/invoiceService');

const router = express.Router();

// ===== PUBLIC ORDER TRACKING (No auth required) =====
// This MUST be before router.use(auth) to work without authentication
router.get('/track/:trackingToken', async (req, res) => {
    try {
        const token = req.params.trackingToken;

        // Try to find by trackingToken first, then by orderNumber (for older orders)
        let order = await prisma.order.findUnique({
            where: { trackingToken: token },
            include: {
                items: {
                    include: {
                        product: {
                            select: { id: true, name: true, images: true, price: true, salePrice: true }
                        }
                    }
                },
                tracking: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        // If not found by trackingToken, try orderNumber
        if (!order) {
            order = await prisma.order.findUnique({
                where: { orderNumber: token },
                include: {
                    items: {
                        include: {
                            product: {
                                select: { id: true, name: true, images: true, price: true, salePrice: true }
                            }
                        }
                    },
                    tracking: {
                        orderBy: { createdAt: 'desc' }
                    }
                }
            });
        }

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Return order without sensitive user info
        res.json({
            id: order.id,
            orderNumber: order.orderNumber,
            trackingToken: order.trackingToken,
            status: order.status,
            totalAmount: order.totalAmount,
            discount: order.discount,
            couponCode: order.couponCode,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            estimatedDeliveryDays: order.estimatedDeliveryDays,
            shippingName: order.shippingName,
            shippingCity: order.shippingCity,
            shippingState: order.shippingState,
            shippingZip: order.shippingZip,
            items: order.items,
            tracking: order.tracking,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get tracking info' });
    }
});

// All order routes below require authentication
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
            // Generate unique invoice number and tracking token
            const invoiceNumber = `INV-${Date.now().toString().slice(-10)}`;
            const trackingToken = `TRK${Date.now().toString(36).toUpperCase()}${uuid().slice(0, 6).toUpperCase()}`;

            const newOrder = await tx.order.create({
                data: {
                    orderNumber: `ORD-${Date.now()}-${uuid().slice(0, 4).toUpperCase()}`,
                    invoiceNumber,
                    trackingToken,
                    userId: req.user.userId,
                    totalAmount,
                    discount,
                    couponCode: appliedCoupon?.code || null,
                    paymentMethod: paymentMethod || 'COD',
                    paymentStatus: paymentMethod === 'PAYPAL' ? 'PENDING' : 'COD_PENDING',
                    estimatedDeliveryDays: 5,
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

            // Auto-add "Order Received" tracking
            await tx.orderTracking.create({
                data: {
                    orderId: newOrder.id,
                    status: 'Order Received',
                    description: 'Your order has been placed successfully'
                }
            });

            return newOrder;
        });

        // Send order confirmation email with invoice (async, don't block response)
        (async () => {
            try {
                const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
                if (user && user.email) {
                    const invoicePdf = await generateInvoicePdf(order, user);
                    await sendOrderConfirmationEmail(order, user, invoicePdf);
                }
            } catch (emailError) {
                console.error('Failed to send order confirmation email:', emailError);
            }
        })();

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

// Download order invoice PDF (MUST be before /:id to prevent route conflict)
router.get('/:id/invoice', async (req, res) => {
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

        // Generate PDF
        const pdfBuffer = await generateInvoicePdf(order, order.customer);

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Invoice-${order.orderNumber}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to generate invoice' });
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

// First tracking status for each order status
const FIRST_TRACKING_STATUS = {
    CONFIRMED: 'Order Confirmed',
    SHIPPED: 'Ready for Pickup',
    OUT_OF_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Order Cancelled'
};

// Update order status (Admin only)
router.patch('/:id/status', adminOnly, async (req, res) => {
    try {
        const { status } = req.body;
        const orderId = req.params.id;

        const order = await prisma.order.update({
            where: { id: orderId },
            data: { status },
            include: {
                customer: true,
                items: { include: { product: true } }
            },
        });

        // Auto-add first tracking status for the new order status
        const firstTrackingStatus = FIRST_TRACKING_STATUS[status];
        if (firstTrackingStatus) {
            await prisma.orderTracking.create({
                data: {
                    orderId,
                    status: firstTrackingStatus,
                    description: null
                }
            });
        }

        // Send status update email (async, don't block response)
        if (order.customer && order.customer.email) {
            sendOrderStatusUpdateEmail(order, order.customer, status).catch(err => {
                console.error('Failed to send status update email:', err);
            });
        }

        res.json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update order' });
    }
});

// ===== ORDER TRACKING UPDATES (Admin only) =====

// Mapping: tracking status -> order status change
const TRACKING_TO_ORDER_STATUS = {
    'Order Processing': 'CONFIRMED',
    'Order Confirmed': 'CONFIRMED',
    'Packed': 'SHIPPED',
    'Handed to Courier': 'SHIPPED',
    'Out for Delivery': 'OUT_OF_DELIVERY',
    'Delivered': 'DELIVERED'
};

// Add tracking update
router.post('/:id/tracking', adminOnly, async (req, res) => {
    try {
        const { status, description, location } = req.body;
        const orderId = req.params.id;

        // Create tracking entry
        const tracking = await prisma.orderTracking.create({
            data: {
                orderId,
                status,
                description,
                location
            }
        });

        // Check if this tracking status should update the order status
        const newOrderStatus = TRACKING_TO_ORDER_STATUS[status];
        if (newOrderStatus) {
            const order = await prisma.order.findUnique({ where: { id: orderId } });

            // Only update if moving forward in status
            const statusOrder = ['PENDING', 'CONFIRMED', 'SHIPPED', 'OUT_OF_DELIVERY', 'DELIVERED'];
            const currentIndex = statusOrder.indexOf(order.status);
            const newIndex = statusOrder.indexOf(newOrderStatus);

            if (newIndex > currentIndex) {
                const updatedOrder = await prisma.order.update({
                    where: { id: orderId },
                    data: { status: newOrderStatus },
                    include: {
                        customer: true,
                        items: { include: { product: true } }
                    }
                });

                // Send status update email
                if (updatedOrder.customer && updatedOrder.customer.email) {
                    sendOrderStatusUpdateEmail(updatedOrder, updatedOrder.customer, newOrderStatus).catch(err => {
                        console.error('Failed to send status update email:', err);
                    });
                }

                return res.status(201).json({
                    tracking,
                    orderStatusUpdated: true,
                    newOrderStatus
                });
            }
        }

        res.status(201).json({ tracking, orderStatusUpdated: false });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add tracking update' });
    }
});

// Get tracking updates for an order
router.get('/:id/tracking', adminOnly, async (req, res) => {
    try {
        const tracking = await prisma.orderTracking.findMany({
            where: { orderId: req.params.id },
            orderBy: { createdAt: 'desc' }
        });

        res.json(tracking);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to get tracking updates' });
    }
});

// Delete tracking update
router.delete('/tracking/:trackingId', adminOnly, async (req, res) => {
    try {
        await prisma.orderTracking.delete({
            where: { id: req.params.trackingId }
        });

        res.json({ message: 'Tracking update deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete tracking update' });
    }
});

module.exports = router;
