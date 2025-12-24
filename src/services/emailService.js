const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// Asset paths for email icons
const successIconPath = path.join(__dirname, '../assets/success.png');
const deliveryTruckIconPath = path.join(__dirname, '../assets/delivery-truck.png');
const deliveryBikeIconPath = path.join(__dirname, '../assets/delivery-bike.png');
const hourglassIconPath = path.join(__dirname, '../assets/hourglass.png');
const boxIconPath = path.join(__dirname, '../assets/box.png');
const logoPath = path.join(__dirname, '../assets/logo.png');

// Create transporter - Configure with your email service
const createTransporter = () => {
    if (process.env.EMAIL_SERVICE === 'gmail') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD,
            },
        });
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });
};

const transporter = createTransporter();

// Get frontend URL
const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

// Format price in INR
const formatPrice = (price) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
    }).format(price);
};

// Format date
const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};

// Get product image URL
const getProductImageUrl = (images) => {
    if (!images || images.length === 0) return null;
    const img = images[0];
    if (img.startsWith('http')) return img;
    return `${getFrontendUrl()}${img}`;
};

// Generate order items HTML with product images
const generateItemsHtml = (items) => {
    return items.map(item => {
        const imageUrl = getProductImageUrl(item.product?.images);
        const imageHtml = imageUrl
            ? `<img src="${imageUrl}" alt="${item.product?.name || 'Product'}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; margin-right: 12px;" />`
            : `<div style="width: 60px; height: 60px; background: #f3f4f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-size: 24px;">📦</div>`;

        return `
        <tr>
            <td style="padding: 16px 12px; border-bottom: 1px solid #e5e7eb;">
                <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td style="vertical-align: middle;">
                            ${imageHtml}
                        </td>
                        <td style="vertical-align: middle;">
                            <p style="margin: 0; font-weight: 600; color: #111827; font-size: 14px;">${item.product?.name || 'Product'}</p>
                            <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Qty: ${item.quantity}</p>
                        </td>
                    </tr>
                </table>
            </td>
            <td style="padding: 16px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #111827;">
                ${formatPrice(Number(item.price) * item.quantity)}
            </td>
        </tr>
    `;
    }).join('');
};

// Order confirmation email template
const getOrderConfirmationHtml = (order, user) => {
    const subtotal = order.items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
    const viewOrderUrl = `${getFrontendUrl()}/order-confirmation/${order.id}`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafb;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <!-- Header -->
        <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px; text-align: center;">
                <img src="cid:logo" alt="Infinite Creations" style="height: 40px; margin-bottom: 8px;" />
                <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Infinite Creations</h1>
                <p style="margin: 8px 0 0; color: #e0e7ff; font-size: 14px;">Premium Online Store</p>
            </td>
        </tr>

        <!-- Main Content -->
        <tr>
            <td style="padding: 40px 32px;">
                <!-- Success Icon -->
                <div style="text-align: center; margin-bottom: 32px;">
                    <img src="cid:successIcon" alt="Success" style="width: 80px; height: 80px;" />
                </div>

                <h2 style="margin: 0 0 8px; text-align: center; color: #059669; font-size: 24px;">Order Placed Successfully!</h2>
                <p style="margin: 0 0 32px; text-align: center; color: #6b7280;">
                    Thank you for your order, ${user?.name || 'Customer'}! We've received your order and will process it soon. You will receive a confirmation once your order is confirmed.
                </p>

                <!-- View Order Button -->
                <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${viewOrderUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                        View Order Details
                    </a>
                </div>

                <!-- Order Info -->
                <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td style="padding: 6px 0;">
                                <span style="color: #6b7280;">Order Number:</span>
                            </td>
                            <td style="text-align: right; font-weight: 600; color: #4f46e5;">
                                ${order.orderNumber}
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0;">
                                <span style="color: #6b7280;">Order Date:</span>
                            </td>
                            <td style="text-align: right; color: #111827;">
                                ${formatDate(order.createdAt)}
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0;">
                                <span style="color: #6b7280;">Payment Method:</span>
                            </td>
                            <td style="text-align: right; color: #111827;">
                                ${order.paymentMethod || 'N/A'}${order.paymentType ? ` (${order.paymentType})` : ''}
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0;">
                                <span style="color: #6b7280;">Payment Status:</span>
                            </td>
                            <td style="text-align: right; font-weight: 600; color: ${order.paymentStatus === 'PAID' ? '#059669' : '#f59e0b'};">
                                ${order.paymentStatus || 'PENDING'}
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- Items Table -->
                <h3 style="margin: 0 0 16px; color: #111827; font-size: 16px;">Order Items</h3>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                    <thead>
                        <tr style="background: #f9fafb;">
                            <th style="padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; text-transform: uppercase;">Item</th>
                            <th style="padding: 12px; text-align: right; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; text-transform: uppercase;">Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${generateItemsHtml(order.items)}
                    </tbody>
                </table>

                <!-- Order Summary -->
                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border-radius: 12px; padding: 20px; border: 1px solid #bbf7d0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td style="padding: 6px 0; color: #6b7280;">Subtotal</td>
                            <td style="text-align: right; color: #111827;">${formatPrice(subtotal)}</td>
                        </tr>
                        ${order.discount > 0 ? `
                        <tr>
                            <td style="padding: 6px 0; color: #059669;">Discount ${order.couponCode ? `(${order.couponCode})` : ''}</td>
                            <td style="text-align: right; color: #059669;">-${formatPrice(order.discount)}</td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td style="padding: 6px 0; color: #6b7280;">Shipping</td>
                            <td style="text-align: right; color: #059669; font-weight: 600;">FREE</td>
                        </tr>
                        <tr>
                            <td style="padding: 16px 0 6px; font-size: 20px; font-weight: bold; color: #111827; border-top: 2px solid #bbf7d0;">Total</td>
                            <td style="padding: 16px 0 6px; text-align: right; font-size: 20px; font-weight: bold; color: #059669; border-top: 2px solid #bbf7d0;">${formatPrice(order.totalAmount)}</td>
                        </tr>
                    </table>
                </div>

                <!-- Shipping Address -->
                <div style="margin-top: 24px;">
                    <h3 style="margin: 0 0 12px; color: #111827; font-size: 16px;">📍 Shipping Address</h3>
                    <div style="background: #f9fafb; border-radius: 12px; padding: 16px; color: #374151; border: 1px solid #e5e7eb;">
                        <p style="margin: 0; font-weight: 600;">${order.shippingName}</p>
                        <p style="margin: 4px 0 0;">${order.shippingAddress}</p>
                        <p style="margin: 4px 0 0;">${order.shippingCity}, ${order.shippingState} - ${order.shippingZip}</p>
                        <p style="margin: 4px 0 0;">📞 ${order.shippingPhone}</p>
                    </div>
                </div>

                <!-- Track Order Button -->
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${getFrontendUrl()}/profile/orders" style="display: inline-block; padding: 12px 24px; background: #f3f4f6; color: #374151; text-decoration: none; border-radius: 8px; font-weight: 600;">
                        Track Your Order →
                    </a>
                </div>
            </td>
        </tr>

        <!-- Footer -->
        <tr>
            <td style="background: #1f2937; padding: 32px; text-align: center;">
                <p style="margin: 0 0 8px; color: #ffffff; font-size: 16px; font-weight: 600;">Infinite Creations</p>
                <p style="margin: 0 0 16px; color: #9ca3af; font-size: 14px;">Premium Quality Products</p>
                <p style="margin: 0; color: #6b7280; font-size: 12px;">
                    Questions? Contact us at support@infinitecreations.com
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
};

// Get status icon CID
const getStatusIconCid = (status) => {
    switch (status) {
        case 'DELIVERED': return 'successIcon';
        case 'OUT_OF_DELIVERY': return 'deliveryBikeIcon';
        case 'SHIPPED': return 'deliveryTruckIcon';
        case 'CONFIRMED': return 'boxIcon';
        case 'CANCELLED': return 'boxIcon';
        default: return 'hourglassIcon';
    }
};

// Order status update email template
const getStatusUpdateHtml = (order, user, newStatus) => {
    const statusMessages = {
        PENDING: 'Your order has been placed',
        CONFIRMED: 'Your order has been confirmed',
        PROCESSING: 'Your order is being processed',
        SHIPPED: 'Your order has been shipped',
        OUT_OF_DELIVERY: 'Your order is out for delivery',
        DELIVERED: 'Your order has been delivered',
        CANCELLED: 'Your order has been cancelled',
    };

    const statusSubMessages = {
        PENDING: 'We are reviewing your order. You will receive an update once confirmed.',
        CONFIRMED: 'Your order is confirmed and will be shipped soon.',
        SHIPPED: `Estimated delivery in ${order.estimatedDeliveryDays || 5} days.`,
        OUT_OF_DELIVERY: 'Your order is on the way! It will be delivered today.',
        DELIVERED: 'Thank you for shopping with us!',
        CANCELLED: 'If you have any questions, please contact support.',
    };

    const statusColors = {
        PENDING: '#f59e0b',
        CONFIRMED: '#3b82f6',
        PROCESSING: '#8b5cf6',
        SHIPPED: '#6366f1',
        OUT_OF_DELIVERY: '#f97316',
        DELIVERED: '#059669',
        CANCELLED: '#ef4444',
    };

    const trackingUrl = order.trackingToken ? `${getFrontendUrl()}/track/${order.trackingToken}` : `${getFrontendUrl()}/order-confirmation/${order.id}`;
    const statusIconCid = getStatusIconCid(newStatus);
    const showTrackButton = ['CONFIRMED', 'SHIPPED', 'OUT_OF_DELIVERY'].includes(newStatus);
    const showDeliveryDays = ['CONFIRMED', 'SHIPPED'].includes(newStatus);

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Status Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; background: #f9fafb;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background: #fff;">
        <!-- Header -->
        <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px; text-align: center;">
                <img src="cid:logo" alt="Infinite Creations" style="height: 40px; margin-bottom: 8px;" />
                <h1 style="margin: 0; color: #fff; font-size: 24px;">Order Update</h1>
            </td>
        </tr>
        
        <!-- Status Icon & Message -->
        <tr>
            <td style="padding: 40px 32px; text-align: center;">
                <img src="cid:${statusIconCid}" alt="${newStatus}" style="width: 80px; height: 80px; margin-bottom: 24px;" />
                
                <h2 style="margin: 0 0 8px; color: ${statusColors[newStatus] || '#111827'}; font-size: 24px;">
                    ${statusMessages[newStatus] || 'Order Update'}
                </h2>
                <p style="margin: 0 0 8px; color: #6b7280; font-size: 16px;">
                    Order: <strong style="color: #4f46e5;">${order.orderNumber}</strong>
                </p>
                <p style="margin: 0 0 16px; color: #9ca3af; font-size: 14px;">
                    ${statusSubMessages[newStatus] || ''}
                </p>
                
                ${showDeliveryDays ? `
                <div style="display: inline-block; padding: 8px 16px; background: #f0fdf4; border-radius: 20px; margin-bottom: 24px;">
                    <span style="color: #059669; font-weight: 600;">📦 Estimated Delivery: ${order.estimatedDeliveryDays || 5} days</span>
                </div>
                ` : ''}
                
                ${showTrackButton ? `
                <div style="margin-top: 24px;">
                    <a href="${trackingUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                        Track Your Order
                    </a>
                </div>
                ` : `
                <div style="margin-top: 24px;">
                    <a href="${trackingUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                        View Order Details
                    </a>
                </div>
                `}
            </td>
        </tr>

        <!-- Order Items Preview -->
        <tr>
            <td style="padding: 0 32px 32px;">
                <div style="background: #f9fafb; border-radius: 12px; padding: 20px;">
                    <h3 style="margin: 0 0 16px; color: #111827; font-size: 14px;">Order Summary</h3>
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td style="color: #6b7280; padding: 4px 0;">Items:</td>
                            <td style="text-align: right; color: #111827; font-weight: 600;">${order.items?.length || 0} product(s)</td>
                        </tr>
                        ${order.couponCode ? `
                        <tr>
                            <td style="color: #059669; padding: 4px 0;">Coupon Applied:</td>
                            <td style="text-align: right; color: #059669; font-weight: 600;">${order.couponCode}</td>
                        </tr>
                        ` : ''}
                        ${order.discount > 0 ? `
                        <tr>
                            <td style="color: #059669; padding: 4px 0;">Discount:</td>
                            <td style="text-align: right; color: #059669; font-weight: 600;">-${formatPrice(order.discount)}</td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td style="color: #6b7280; padding: 4px 0;">Total:</td>
                            <td style="text-align: right; color: #059669; font-weight: 600; font-size: 18px;">${formatPrice(order.totalAmount)}</td>
                        </tr>
                    </table>
                </div>
            </td>
        </tr>
        
        <!-- Footer -->
        <tr>
            <td style="background: #1f2937; padding: 24px; text-align: center;">
                <p style="margin: 0 0 8px; color: #ffffff; font-size: 14px; font-weight: 600;">Infinite Creations</p>
                <p style="margin: 0; color: #9ca3af; font-size: 12px;">© ${new Date().getFullYear()} All rights reserved.</p>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
};

// Get email attachments for order confirmation (only logo and success icon)
const getOrderConfirmationAttachments = () => {
    const attachments = [];

    if (fs.existsSync(logoPath)) {
        attachments.push({ filename: 'logo.png', path: logoPath, cid: 'logo' });
    }
    if (fs.existsSync(successIconPath)) {
        attachments.push({ filename: 'success.png', path: successIconPath, cid: 'successIcon' });
    }

    return attachments;
};

// Get email attachments for status update (logo + specific status icon)
const getStatusUpdateAttachments = (status) => {
    const attachments = [];

    if (fs.existsSync(logoPath)) {
        attachments.push({ filename: 'logo.png', path: logoPath, cid: 'logo' });
    }

    // Only attach the icon needed for this status
    if (status === 'DELIVERED' && fs.existsSync(successIconPath)) {
        attachments.push({ filename: 'success.png', path: successIconPath, cid: 'successIcon' });
    } else if (status === 'OUT_OF_DELIVERY' && fs.existsSync(deliveryBikeIconPath)) {
        attachments.push({ filename: 'delivery-bike.png', path: deliveryBikeIconPath, cid: 'deliveryBikeIcon' });
    } else if (status === 'SHIPPED' && fs.existsSync(deliveryTruckIconPath)) {
        attachments.push({ filename: 'delivery-truck.png', path: deliveryTruckIconPath, cid: 'deliveryTruckIcon' });
    } else if ((status === 'CONFIRMED' || status === 'CANCELLED') && fs.existsSync(boxIconPath)) {
        attachments.push({ filename: 'box.png', path: boxIconPath, cid: 'boxIcon' });
    } else if (fs.existsSync(hourglassIconPath)) {
        attachments.push({ filename: 'hourglass.png', path: hourglassIconPath, cid: 'hourglassIcon' });
    }

    return attachments;
};

// Send order confirmation email
const sendOrderConfirmationEmail = async (order, user, invoicePdf = null) => {
    try {
        const attachments = getOrderConfirmationAttachments();

        // Attach invoice PDF if provided
        if (invoicePdf) {
            attachments.push({
                filename: `Invoice-${order.orderNumber}.pdf`,
                content: invoicePdf,
                contentType: 'application/pdf',
            });
        }

        const mailOptions = {
            from: `"Infinite Creations" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: `✅ Order Placed Successfully - ${order.orderNumber}`,
            html: getOrderConfirmationHtml(order, user),
            attachments,
        };

        const result = await transporter.sendMail(mailOptions);
        console.log(`✉️ Order confirmation email sent to ${user.email}`);
        return { success: true, messageId: result.messageId };
    } catch (error) {
        console.error('Failed to send order confirmation email:', error);
        return { success: false, error: error.message };
    }
};

// Send order status update email
const sendOrderStatusUpdateEmail = async (order, user, newStatus) => {
    try {
        const attachments = getStatusUpdateAttachments(newStatus);

        const mailOptions = {
            from: `"Infinite Creations" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: `📦 Order ${newStatus} - ${order.orderNumber}`,
            html: getStatusUpdateHtml(order, user, newStatus),
            attachments,
        };

        await transporter.sendMail(mailOptions);
        console.log(`✉️ Order status update email sent to ${user.email}`);
        return { success: true };
    } catch (error) {
        console.error('Failed to send status update email:', error);
        return { success: false, error: error.message };
    }
};

// Verify email configuration
const verifyEmailConfig = async () => {
    try {
        await transporter.verify();
        console.log('✅ Email service configured successfully');
        return true;
    } catch (error) {
        console.error('❌ Email configuration error:', error.message);
        return false;
    }
};

module.exports = {
    sendOrderConfirmationEmail,
    sendOrderStatusUpdateEmail,
    verifyEmailConfig,
};
