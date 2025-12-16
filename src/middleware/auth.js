const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const admin = require('../config/firebase'); // Firebase Admin
const prisma = require('../config/prisma');

const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];

        // 1. Try Legacy/Admin Custom JWT Check
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                userId: decoded.sub,
                email: decoded.email,
                role: decoded.role,
                name: decoded.name,
            };
            return next();
        } catch (jwtError) {
            // Token is likely not a custom JWT, proceed to Supabase check
        }

        // 2. Try Firebase Token (Preferred for Users)
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);

            // Sync Firebase User to Local DB
            let user = await prisma.user.findUnique({ where: { email: decodedToken.email } });

            if (!user) {
                // Auto-register new Firebase User
                user = await prisma.user.create({
                    data: {
                        email: decodedToken.email,
                        name: decodedToken.name || decodedToken.email.split('@')[0],
                        role: 'USER',
                        password: '',
                        avatar: decodedToken.picture || null
                    }
                });
            }

            req.user = {
                userId: user.id,
                email: user.email,
                role: user.role,
                name: user.name,
            };
            return next();
        } catch (firebaseError) {
            // Not a valid Firebase token, fall through to Supabase or Error
        }

        // 3. Verify Supabase Token (Backup/Legacy)
        const { data: { user: sbUser }, error } = await supabase.auth.getUser(token);

        if (error || !sbUser) {
            console.log('❌ Auth Verification Failed (JWT/Firebase/Supabase)');
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        // Sync Supabase User ... (existing logic)

        // 3. User is valid in Supabase -> Sync with Local Database
        // We find the user by email, or create them if they don't exist.
        // NOTE: We do NOT update the role from Supabase metadata to prevent privilege escalation.

        let user = await prisma.user.findUnique({ where: { email: sbUser.email } });

        if (!user) {
            // New User Registration (Auto-Register)
            user = await prisma.user.create({
                data: {
                    email: sbUser.email,
                    name: sbUser.user_metadata?.full_name || sbUser.email.split('@')[0],
                    role: 'USER', // Always default to USER
                    password: '', // external auth
                    avatar: sbUser.user_metadata?.avatar_url || null
                }
            });
        }

        req.user = {
            userId: user.id,
            email: user.email,
            role: user.role, // Uses DB role (so Admins can log in too if they exist)
            name: user.name,
        };

        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        return res.status(500).json({ message: 'Authentication Failed' });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

module.exports = { auth, adminOnly };
