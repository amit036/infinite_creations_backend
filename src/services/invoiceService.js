const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// Asset paths
const logoPath = path.join(__dirname, '../assets/logo.png');
const signaturePath = path.join(__dirname, '../assets/signature.png');
const dejaVuFontPath = path.join(__dirname, '../assets/DejaVuSans.ttf');

// Format price in INR
const formatPrice = (price) => {
    return Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Format date
const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).replace(/\//g, '-');
};

// Generate QR code as buffer
const generateQRCode = async (text) => {
    try {
        const qrBuffer = await QRCode.toBuffer(text, {
            width: 70,
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' }
        });
        return qrBuffer;
    } catch (error) {
        console.error('QR Code generation failed:', error);
        return null;
    }
};

// Generate invoice PDF - Single page, clean layout
const generateInvoicePdf = async (order, user) => {
    // Use stored invoice number or generate from order number
    const invoiceNumber = order.invoiceNumber || `INV-${order.orderNumber.replace('ORD-', '')}`;
    const qrData = invoiceNumber;
    const qrBuffer = await generateQRCode(qrData);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 0,
                bufferPages: false,
                info: {
                    Title: `Tax Invoice - ${invoiceNumber}`,
                    Author: 'Infinite Creations'
                }
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            const W = 595;  // A4 width
            const H = 842;  // A4 height
            const M = 40;   // Left margin
            const CW = W - M - 30;  // Content width

            // ===== LEFT THICK BLUE BORDER =====
            doc.rect(0, 0, 8, H).fill('#4f46e5');

            // ===== HEADER - Tax Invoice =====
            doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e293b')
                .text('Tax Invoice', M, 25, { width: CW, align: 'center' });

            // ===== SELLER INFO (Left) =====
            let y = 50;
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b')
                .text('Sold By: Infinite Creations India Pvt. Ltd.', M, y);
            doc.fontSize(7).font('Helvetica-Oblique').fillColor('#64748b')
                .text('Ship-from Address: Bangalore, Karnataka, India - 560001', M, y + 11);
            doc.fontSize(8).font('Helvetica').fillColor('#1e293b')
                .text('GSTIN - 29ABCDE1234F1Z5', M, y + 22);

            // ===== QR CODE (Right, aligned with seller info) =====
            const qrX = W - 95;
            if (qrBuffer) {
                doc.image(qrBuffer, qrX, y - 5, { width: 60, height: 60 });
            }

            // ===== INVOICE NUMBER BOX (Right, below QR, aligned with QR) =====
            const invoiceBoxY = y + 60;
            const boxWidth = 130;
            const boxX = qrX - 55; // Align with QR code
            doc.rect(boxX, invoiceBoxY, boxWidth, 26).fill('#fef3c7');
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#92400e')
                .text('Invoice Number #', boxX + 8, invoiceBoxY + 5);
            doc.fontSize(8).font('Helvetica').fillColor('#1e293b')
                .text(invoiceNumber, boxX + 8, invoiceBoxY + 15);

            // ===== DASHED SEPARATOR LINE =====
            y = invoiceBoxY + 34;
            doc.moveTo(M, y).lineTo(W - 30, y)
                .dash(4, { space: 2 })
                .strokeColor('#cbd5e1').lineWidth(1).stroke()
                .undash();

            // ===== ORDER DETAILS | BILL TO | SHIP TO =====
            y += 12;

            // Column 1: Order Details
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b');
            doc.text('Order ID:', M, y);
            doc.font('Helvetica').fontSize(7).text(order.orderNumber, M, y + 10);

            doc.font('Helvetica-Bold').fontSize(8).text('Order Date:', M, y + 24);
            doc.font('Helvetica').text(formatDate(order.createdAt), M + 58, y + 24);

            doc.font('Helvetica-Bold').text('Invoice Date:', M, y + 36);
            doc.font('Helvetica').text(formatDate(order.createdAt), M + 62, y + 36);

            // Column 2: Bill To
            const col2X = 195;
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b').text('Bill To', col2X, y);
            doc.font('Helvetica-Bold').text(order.shippingName, col2X, y + 11);
            doc.font('Helvetica').fontSize(7).fillColor('#64748b');
            doc.text(order.shippingAddress, col2X, y + 22, { width: 125 });
            doc.text(`${order.shippingCity}, ${order.shippingState}`, col2X, y + 44);
            doc.text(order.shippingZip, col2X, y + 54);
            doc.text(`Phone: ${order.shippingPhone}`, col2X, y + 64);

            // Column 3: Ship To
            const col3X = 380;
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b').text('Ship To', col3X, y);
            doc.font('Helvetica-Bold').text(order.shippingName, col3X, y + 11);
            doc.font('Helvetica').fontSize(7).fillColor('#64748b');
            doc.text(order.shippingAddress, col3X, y + 22, { width: 125 });
            doc.text(`${order.shippingCity}, ${order.shippingState}`, col3X, y + 44);
            doc.text(order.shippingZip, col3X, y + 54);
            doc.text(`Phone: ${order.shippingPhone}`, col3X, y + 64);

            // ===== TOTAL ITEMS =====
            y += 85;
            doc.moveTo(M, y).lineTo(W - 30, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b')
                .text(`Total Items: ${order.items.length}`, M, y + 6);

            // ===== ITEMS TABLE =====
            y += 22;

            // Table header
            doc.rect(M, y, CW, 18).fill('#f1f5f9');

            doc.fontSize(7).font('Helvetica-Bold').fillColor('#374151');
            doc.text('Product', M + 5, y + 5);
            doc.text('Description', M + 70, y + 5, { width: 150 });
            doc.text('Qty', 290, y + 5, { width: 35, align: 'center' });
            doc.text('Price', 335, y + 5, { width: 55, align: 'right' });
            doc.text('Discount', 400, y + 5, { width: 50, align: 'right' });
            doc.text('Total', 460, y + 5, { width: 55, align: 'right' });

            // Table rows
            y += 18;
            const rowHeight = 24;

            order.items.forEach((item, i) => {
                const itemTotal = Number(item.price) * item.quantity;
                const rowY = y + (i * rowHeight);

                doc.moveTo(M, rowY + rowHeight).lineTo(W - 30, rowY + rowHeight)
                    .strokeColor('#e2e8f0').lineWidth(0.5).stroke();

                doc.fillColor('#1e293b').fontSize(7).font('Helvetica');
                doc.text('General', M + 5, rowY + 7);

                doc.font('Helvetica-Bold').fontSize(7);
                const name = (item.product?.name || 'Product').substring(0, 32);
                doc.text(name, M + 70, rowY + 7, { width: 150 });

                doc.font('Helvetica').fontSize(8);
                doc.text(String(item.quantity), 290, rowY + 7, { width: 35, align: 'center' });
                doc.text(formatPrice(item.price), 335, rowY + 7, { width: 55, align: 'right' });

                const itemDiscount = order.discount ? (order.discount / order.items.length) : 0;
                doc.fillColor('#059669');
                doc.text(`-${formatPrice(itemDiscount)}`, 400, rowY + 7, { width: 50, align: 'right' });

                doc.font('Helvetica-Bold').fillColor('#1e293b');
                doc.text(formatPrice(itemTotal - itemDiscount), 460, rowY + 7, { width: 55, align: 'right' });
            });

            // ===== TOTALS ROW =====
            y = y + (order.items.length * rowHeight);
            doc.rect(M, y, CW, 20).fill('#f8fafc');
            doc.moveTo(M, y + 20).lineTo(W - 30, y + 20).strokeColor('#4f46e5').lineWidth(1).stroke();

            doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b');
            doc.text('Total', M + 70, y + 6, { width: 150 });
            doc.text(String(order.items.reduce((s, i) => s + i.quantity, 0)), 290, y + 6, { width: 35, align: 'center' });

            const subtotal = order.items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
            doc.text(formatPrice(subtotal), 335, y + 6, { width: 55, align: 'right' });
            doc.fillColor('#059669');
            doc.text(`-${formatPrice(order.discount || 0)}`, 400, y + 6, { width: 50, align: 'right' });
            doc.fillColor('#1e293b');
            doc.text(formatPrice(order.totalAmount), 460, y + 6, { width: 55, align: 'right' });

            // ===== GRAND TOTAL (with ₹ symbol using DejaVuSans font) =====
            y += 35;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e293b');
            doc.text('Grand Total', M, y, { width: 280, align: 'right' });
            // Use DejaVuSans font for Rupee symbol
            doc.fontSize(14).font(dejaVuFontPath).fillColor('#4f46e5');
            doc.text('₹' + formatPrice(order.totalAmount), 340, y, { width: 175, align: 'right' });
            // Reset to Helvetica for remaining text
            doc.font('Helvetica');

            // ===== PAYMENT INFO =====
            y += 25;
            doc.fontSize(8).font('Helvetica').fillColor('#64748b');

            // Payment Method & Type
            const paymentMethod = order.paymentMethod || 'N/A';
            const paymentType = order.paymentType || '';
            const paymentDisplay = paymentType ? `${paymentMethod} (${paymentType})` : paymentMethod;

            doc.text(`Payment Method: ${paymentDisplay}`, M, y);

            // Payment Status with color coding
            const statusColors = {
                'PAID': '#059669',
                'PENDING': '#f59e0b',
                'FAILED': '#dc2626',
                'COD_PENDING': '#3b82f6'
            };
            const statusColor = statusColors[order.paymentStatus] || '#64748b';
            doc.fillColor(statusColor).font('Helvetica-Bold');
            doc.text(`Payment Status: ${order.paymentStatus || 'N/A'}`, M + 250, y);
            doc.font('Helvetica').fillColor('#64748b');

            // Transaction ID if available
            if (order.paymentId) {
                y += 12;
                doc.text(`Transaction ID: ${order.paymentId}`, M, y);
            }

            // ===== COMPANY NAME & SIGNATURE =====
            y += 50;
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b')
                .text('Infinite Creations India Pvt. Ltd.', 330, y, { width: 185, align: 'right' });

            if (fs.existsSync(signaturePath)) {
                doc.image(signaturePath, W - 160, y + 12, { width: 100, height: 50 });
            }

            doc.fontSize(7).font('Helvetica').fillColor('#64748b')
                .text('Authorized Signatory', 330, y + 45, { width: 185, align: 'right' });

            // ===== FOOTER - FIXED AT BOTTOM =====
            const footerY = H - 55;  // Fixed 55px from bottom

            doc.moveTo(M, footerY).lineTo(W - 30, footerY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, M, footerY + 8, { width: 28, height: 28 });
            }

            doc.fontSize(10).font('Helvetica-Bold').fillColor('#4f46e5')
                .text('Infinite Creations', M + 34, footerY + 12);
            doc.fontSize(7).font('Helvetica').fillColor('#64748b')
                .text('Thank You!', M + 34, footerY + 24);

            doc.fontSize(7).fillColor('#64748b')
                .text('support@infinitecreations.com | +91 1800-123-4567', 260, footerY + 18, { width: 255, align: 'right' });

            // End document
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

module.exports = { generateInvoicePdf };
