const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../config/prisma');
const { auth } = require('../middleware/auth');

const router = express.Router();

// ============================================
// RAZORPAY CONFIGURATION
// ============================================
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_RrGR3gXME1jPYg';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'nBzHIMILklH6HP6aWwge8NWx';

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// ============================================
// PHONEPE CONFIGURATION (v2 API with OAuth)
// ============================================
const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID || 'M232DJKRETJBN_2512140355';
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || 'ZDRkNDI4MDQtYzdlNi00MDJjLWEzNjQtMGQ3NWNkOWQ2YzQy';
const PHONEPE_MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || 'M232DJKRETJBN';
const PHONEPE_ENV = process.env.PHONEPE_ENV || 'UAT';

// PhonePe API URLs (v2 API)
const PHONEPE_BASE_URL = PHONEPE_ENV === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/pg'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

// Token cache for PhonePe OAuth
let phonePeTokenCache = {
    accessToken: null,
    expiresAt: 0
};

// Get PhonePe OAuth access token
async function getPhonePeAccessToken() {
    // Check if we have a valid cached token (with 60s buffer)
    if (phonePeTokenCache.accessToken && Date.now() < phonePeTokenCache.expiresAt - 60000) {
        return phonePeTokenCache.accessToken;
    }

    try {
        const params = new URLSearchParams();
        params.append('client_id', PHONEPE_CLIENT_ID);
        params.append('client_secret', PHONEPE_CLIENT_SECRET);
        params.append('client_version', '1');
        params.append('grant_type', 'client_credentials');

        const response = await axios.post(
            `${PHONEPE_BASE_URL}/v1/oauth/token`,
            params,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data && response.data.access_token) {
            phonePeTokenCache = {
                accessToken: response.data.access_token,
                expiresAt: response.data.expires_at || (Date.now() + 3600000) // Default 1 hour if not provided
            };
            console.log('PhonePe OAuth token obtained successfully');
            return phonePeTokenCache.accessToken;
        } else {
            throw new Error('Failed to get access token from PhonePe');
        }
    } catch (error) {
        console.error('PhonePe OAuth error:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with PhonePe: ' + (error.response?.data?.message || error.message));
    }
}

// ============================================
// RAZORPAY ROUTES
// ============================================

// Create Razorpay order
router.post('/razorpay/create-order', auth, async (req, res) => {
    try {
        const { orderId, amount } = req.body;

        if (!orderId || !amount) {
            return res.status(400).json({ message: 'Order ID and amount are required' });
        }

        // Verify order exists and belongs to user
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: req.user.userId
            }
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Create Razorpay order (amount in paise)
        const razorpayOrder = await razorpay.orders.create({
            amount: Math.round(amount * 100), // Convert to paise
            currency: 'INR',
            receipt: order.orderNumber,
            notes: {
                orderId: orderId,
                orderNumber: order.orderNumber
            }
        });

        // Update order with Razorpay order ID
        await prisma.order.update({
            where: { id: orderId },
            data: { paymentId: razorpayOrder.id }
        });

        res.json({
            id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            key: RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Razorpay create order error:', error);
        res.status(500).json({
            message: 'Failed to create Razorpay order',
            error: error.message
        });
    }
});

// Verify Razorpay payment
router.post('/razorpay/verify', auth, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId, paymentType } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            // Mark as failed if verification params are missing
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    failureReason: 'Missing payment verification parameters'
                }
            });
            return res.status(400).json({ message: 'Missing payment verification parameters' });
        }

        // Verify signature
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(sign)
            .digest('hex');

        if (razorpay_signature !== expectedSign) {
            // Mark as failed if signature invalid
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    failureReason: 'Invalid payment signature'
                }
            });
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        // Update order payment status (order stays PENDING until admin confirms)
        const order = await prisma.order.update({
            where: { id: orderId },
            data: {
                status: 'PENDING', // Order stays pending until admin confirms
                paymentStatus: 'PAID',
                paymentMethod: 'RAZORPAY',
                paymentType: paymentType || 'Online Payment', // Credit Card, Debit Card, UPI, Net Banking, Wallet
                paymentId: razorpay_payment_id,
                paidAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Payment verified successfully',
            order
        });
    } catch (error) {
        console.error('Razorpay verify error:', error);

        // Mark order as failed
        if (req.body.orderId) {
            await prisma.order.update({
                where: { id: req.body.orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    failureReason: error.message || 'Payment verification failed'
                }
            }).catch(e => console.error('Failed to update order status:', e));
        }

        res.status(500).json({
            message: 'Payment verification failed',
            error: error.message
        });
    }
});

// Get Razorpay config
router.get('/razorpay/config', (req, res) => {
    res.json({
        key: RAZORPAY_KEY_ID
    });
});

// ============================================
// PHONEPE ROUTES (v2 API with OAuth)
// ============================================

// Create PhonePe payment (v2 API)
router.post('/phonepe/create-order', auth, async (req, res) => {
    try {
        const { orderId, amount } = req.body;

        if (!orderId || !amount) {
            return res.status(400).json({ message: 'Order ID and amount are required' });
        }

        // Verify order exists and belongs to user
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: req.user.userId
            }
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Get OAuth access token
        const accessToken = await getPhonePeAccessToken();

        const merchantOrderId = `IC_${order.orderNumber}_${Date.now()}`;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        // v2 API payload format
        const payload = {
            merchantOrderId: merchantOrderId,
            amount: Math.round(amount * 100), // Amount in paise
            expireAfter: 1200, // 20 minutes expiry
            metaInfo: {
                udf1: orderId,
                udf2: order.orderNumber,
                udf3: req.user.userId
            },
            paymentFlow: {
                type: 'PG_CHECKOUT',
                message: `Payment for Order #${order.orderNumber}`,
                merchantUrls: {
                    redirectUrl: `${frontendUrl}/payment/phonepe/callback?orderId=${orderId}&merchantOrderId=${merchantOrderId}`
                }
            }
        };

        console.log('PhonePe v2 API request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(
            `${PHONEPE_BASE_URL}/checkout/v2/pay`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${accessToken}`
                }
            }
        );

        console.log('PhonePe v2 API response:', JSON.stringify(response.data, null, 2));

        // Update order with PhonePe transaction ID
        await prisma.order.update({
            where: { id: orderId },
            data: { paymentId: merchantOrderId }
        });

        // v2 API response format
        if (response.data && response.data.redirectUrl) {
            res.json({
                success: true,
                data: response.data,
                redirectUrl: response.data.redirectUrl,
                orderId: response.data.orderId
            });
        } else if (response.data && response.data.state === 'PENDING') {
            res.json({
                success: true,
                data: response.data,
                redirectUrl: response.data.redirectUrl
            });
        } else {
            res.status(400).json({
                success: false,
                message: response.data?.message || 'Failed to create PhonePe payment'
            });
        }
    } catch (error) {
        console.error('PhonePe create order error:', error.response?.data || error);
        res.status(500).json({
            message: 'Failed to create PhonePe order',
            error: error.response?.data?.message || error.response?.data?.error || error.message
        });
    }
});

// Verify PhonePe payment status (v2 API)
router.post('/phonepe/verify', auth, async (req, res) => {
    try {
        const { orderId, merchantOrderId, paymentType } = req.body;

        if (!orderId || !merchantOrderId) {
            return res.status(400).json({ message: 'Order ID and merchant order ID are required' });
        }

        // Get OAuth access token
        const accessToken = await getPhonePeAccessToken();

        // Check payment status with PhonePe v2 API
        const response = await axios.get(
            `${PHONEPE_BASE_URL}/checkout/v2/order/${merchantOrderId}/status`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${accessToken}`
                }
            }
        );

        console.log('PhonePe status response:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.state === 'COMPLETED') {
            // Determine payment type from response
            const detectedPaymentType = response.data.paymentDetails?.paymentMode || paymentType || 'UPI';

            // Update order payment status (order stays PENDING until admin confirms)
            const order = await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'PENDING', // Order stays pending until admin confirms
                    paymentStatus: 'PAID',
                    paymentMethod: 'PHONEPE',
                    paymentType: detectedPaymentType,
                    paymentId: response.data.orderId || merchantOrderId,
                    paidAt: new Date()
                }
            });

            res.json({
                success: true,
                message: 'Payment verified successfully',
                order
            });
        } else if (response.data && response.data.state === 'FAILED') {
            // Mark order as failed
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    paymentMethod: 'PHONEPE',
                    failureReason: response.data.errorCode || 'Payment failed'
                }
            });

            res.status(400).json({
                success: false,
                message: 'Payment failed',
                status: response.data.state,
                errorCode: response.data.errorCode
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Payment not completed',
                status: response.data?.state || 'UNKNOWN'
            });
        }
    } catch (error) {
        console.error('PhonePe verify error:', error.response?.data || error);

        // Mark order as failed
        if (req.body.orderId) {
            await prisma.order.update({
                where: { id: req.body.orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    paymentMethod: 'PHONEPE',
                    failureReason: error.response?.data?.message || error.message || 'Payment verification failed'
                }
            }).catch(e => console.error('Failed to update order status:', e));
        }

        res.status(500).json({
            message: 'Payment verification failed',
            error: error.response?.data?.message || error.message
        });
    }
});

// PhonePe webhook handler
router.post('/phonepe/webhook', async (req, res) => {
    try {
        console.log('PhonePe Webhook:', req.body);

        // Verify and process the webhook
        const { response } = req.body;
        if (response) {
            const decodedResponse = JSON.parse(Buffer.from(response, 'base64').toString('utf8'));
            console.log('Decoded PhonePe response:', decodedResponse);

            if (decodedResponse.code === 'PAYMENT_SUCCESS') {
                // Update order based on merchantTransactionId
                const transactionId = decodedResponse.data?.merchantTransactionId;
                if (transactionId) {
                    await prisma.order.updateMany({
                        where: { paymentId: transactionId },
                        data: {
                            status: 'CONFIRMED',
                            paymentStatus: 'PAID',
                            paymentMethod: 'PHONEPE',
                            paidAt: new Date()
                        }
                    });
                }
            }
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('PhonePe webhook error:', error);
        res.status(500).json({ message: 'Webhook processing failed' });
    }
});

// ============================================
// PAYPAL ROUTES
// ============================================

// PayPal configuration using checkout-server-sdk (more stable)
const paypal = require('@paypal/checkout-server-sdk');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'AXxYm06incVAHfk-JpeLxnrKfUE6_go0v7jNrfEpwCIu4X2Adwh653JrKqlwP2n18lW9i0CT38NwLcS_';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'ELlnSqpQbBVf9A5fVd4HryjLnPHldRzeuSGVA1klBGpxWV-7MV1vRG0V0EMtljkirFiKZ1ra0C3HqdNW';

// Create PayPal environment
function createPayPalClient() {
    const environment = new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
    return new paypal.core.PayPalHttpClient(environment);
}

const paypalClient = createPayPalClient();

// Create PayPal order
router.post('/paypal/create-order', auth, async (req, res) => {
    try {
        const { orderId, amount, currency = 'USD' } = req.body;

        if (!orderId || !amount) {
            return res.status(400).json({ message: 'Order ID and amount are required' });
        }

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: req.user.userId
            }
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                reference_id: orderId,
                description: `Infinite Creations Order #${order.orderNumber}`,
                amount: {
                    currency_code: currency,
                    value: String(Number(amount).toFixed(2))
                }
            }],
            application_context: {
                brand_name: 'Infinite Creations',
                landing_page: 'BILLING',
                user_action: 'PAY_NOW',
                return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
                cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancel`
            }
        });

        const response = await paypalClient.execute(request);

        await prisma.order.update({
            where: { id: orderId },
            data: { paypalOrderId: response.result.id }
        });

        res.json({
            id: response.result.id,
            status: response.result.status,
            links: response.result.links
        });
    } catch (error) {
        console.error('PayPal create order error:', error);
        res.status(500).json({
            message: 'Failed to create PayPal order',
            error: error.message
        });
    }
});

// Capture PayPal payment
router.post('/paypal/capture-order', auth, async (req, res) => {
    try {
        const { paypalOrderId, orderId } = req.body;

        if (!paypalOrderId) {
            return res.status(400).json({ message: 'PayPal order ID is required' });
        }

        const request = new paypal.orders.OrdersCaptureRequest(paypalOrderId);
        request.requestBody({});

        const response = await paypalClient.execute(request);

        if (response.result.status === 'COMPLETED') {
            // Determine payment type from PayPal response
            const paymentSource = response.result.payment_source;
            let paymentType = 'PayPal';
            if (paymentSource?.card) {
                paymentType = paymentSource.card.brand ? `${paymentSource.card.brand} Card` : 'Card';
            } else if (paymentSource?.paypal) {
                paymentType = 'PayPal Wallet';
            }

            const order = await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'PENDING', // Order stays pending until admin confirms
                    paymentStatus: 'PAID',
                    paymentMethod: 'PAYPAL',
                    paymentType: paymentType,
                    paymentId: response.result.id,
                    paidAt: new Date()
                }
            });

            res.json({
                success: true,
                message: 'Payment captured successfully',
                order,
                captureId: response.result.purchase_units?.[0]?.payments?.captures?.[0]?.id
            });
        } else {
            // Mark as failed
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    paymentMethod: 'PAYPAL',
                    failureReason: `Payment status: ${response.result.status}`
                }
            });

            res.status(400).json({
                success: false,
                message: 'Payment not completed',
                status: response.result.status
            });
        }
    } catch (error) {
        console.error('PayPal capture error:', error);

        // Mark order as failed
        if (req.body.orderId) {
            await prisma.order.update({
                where: { id: req.body.orderId },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED',
                    paymentMethod: 'PAYPAL',
                    failureReason: error.message || 'Payment capture failed'
                }
            }).catch(e => console.error('Failed to update order status:', e));
        }

        res.status(500).json({
            message: 'Failed to capture payment',
            error: error.message
        });
    }
});

// Legacy routes - redirect to new routes
router.post('/create-order', auth, (req, res, next) => {
    req.url = '/paypal/create-order';
    router.handle(req, res, next);
});

router.post('/capture-order', auth, (req, res, next) => {
    req.url = '/paypal/capture-order';
    router.handle(req, res, next);
});

// Get payment config (all gateways)
router.get('/config', (req, res) => {
    res.json({
        razorpay: {
            key: RAZORPAY_KEY_ID
        },
        phonepe: {
            merchantId: PHONEPE_MERCHANT_ID
        },
        paypal: {
            clientId: process.env.PAYPAL_CLIENT_ID || 'AXxYm06incVAHfk-JpeLxnrKfUE6_go0v7jNrfEpwCIu4X2Adwh653JrKqlwP2n18lW9i0CT38NwLcS_'
        }
    });
});

module.exports = router;
