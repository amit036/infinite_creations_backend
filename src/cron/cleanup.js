const cron = require('node-cron');
const prisma = require('../config/prisma');
const supabase = require('../config/supabase');

const BUCKET = 'infinite-creations';

const runCleanup = async () => {
    console.log('🧹 Running Storage Cleanup Job...');

    try {
        // 1. Get all file paths from DB
        const users = await prisma.user.findMany({ select: { avatar: true } });
        const products = await prisma.product.findMany({ select: { images: true } });

        const validPaths = new Set();

        users.forEach(u => {
            if (u.avatar && u.avatar.includes(BUCKET)) {
                // Extract relative path from URL
                // URL: https://xyz.supabase.co/storage/v1/object/public/infinite-creations/avatars/foo.webp
                // Path: avatars/foo.webp
                const parts = u.avatar.split(`/${BUCKET}/`);
                if (parts.length > 1) validPaths.add(parts[1]);
            }
        });

        products.forEach(p => {
            p.images.forEach(img => {
                if (img && img.includes(BUCKET)) {
                    const parts = img.split(`/${BUCKET}/`);
                    if (parts.length > 1) validPaths.add(parts[1]);
                }
            });
        });

        console.log(`ℹ️ Found ${validPaths.size} valid files in Database.`);

        // 2. List all files in Storage (Products and Avatars)
        // Note: Supabase list is paginated (limit 100 by default). We need to loop.

        let allStorageFiles = [];
        const folders = ['products', 'avatars'];

        for (const folder of folders) {
            let hasMore = true;
            let offset = 0;
            const limit = 100;

            while (hasMore) {
                const { data, error } = await supabase.storage
                    .from(BUCKET)
                    .list(folder, { limit, offset });

                if (error) {
                    console.error(`❌ Error listing ${folder}:`, error);
                    break;
                }

                if (!data || data.length === 0) {
                    hasMore = false;
                } else {
                    // Filter out .emptyFolderPlaceholder if any
                    const files = data
                        .filter(f => f.name !== '.emptyFolderPlaceholder')
                        .map(f => `${folder}/${f.name}`); // users/avatar.webp

                    allStorageFiles = [...allStorageFiles, ...files];

                    if (data.length < limit) hasMore = false;
                    offset += limit;
                }
            }
        }

        console.log(`ℹ️ Found ${allStorageFiles.length} files in Storage.`);

        // 3. Find Orphans
        const orphans = allStorageFiles.filter(path => !validPaths.has(path));

        if (orphans.length > 0) {
            console.log(`🗑️ Deleting ${orphans.length} orphaned files...`);
            // Delete in chunks of 50
            const chunkSize = 50;
            for (let i = 0; i < orphans.length; i += chunkSize) {
                const chunk = orphans.slice(i, i + chunkSize);
                const { error } = await supabase.storage.from(BUCKET).remove(chunk);
                if (error) console.error('❌ Error deleting chunk:', error);
            }
            console.log('✅ Cleanup complete.');
        } else {
            console.log('✅ No orphaned files found.');
        }

    } catch (error) {
        console.error('❌ Cleanup Job Failed:', error);
    }
};

// Run everyday at 3 AM
cron.schedule('0 3 * * *', runCleanup);

// If running this file directly, execute immediately
if (require.main === module) {
    runCleanup()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = runCleanup;
