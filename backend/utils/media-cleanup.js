const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const Message = require('../models/Message');

// Configure Cloudinary (it usually picks up env vars, but we can be explicit if needed)
// Assuming env vars are loaded in server.js

const cleanupExpiredMedia = async () => {
    try {
        console.log('Running media cleanup job...');

        // 10 days ago
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() - 10);

        // Find messages older than 10 days that have attachments
        // We only care about attachments that are NOT yet marked as expired/deleted
        // But since we don't have a specific status field in attachments, we check checking creation time
        // and if the URL is still valid (not expired placeholder)

        // Actually, checking messages created < 10 days ago is easier.
        // We will query messages where createdAt < expiryDate AND attachments is not empty

        const messages = await Message.find({
            createdAt: { $lt: expiryDate },
            attachments: { $exists: true, $not: { $size: 0 } }
        });

        let deletedCount = 0;

        for (const msg of messages) {
            let msgUpdated = false;
            const updatedAttachments = [];

            for (const att of msg.attachments) {
                // If it's already a placeholder or explicitly marked, skip
                if (att.url.includes('expired_media_placeholder') || att.publicId === 'expired') {
                    updatedAttachments.push(att);
                    continue;
                }

                try {
                    // Delete from Cloudinary
                    console.log(`Deleting asset: ${att.publicId}`);
                    await cloudinary.uploader.destroy(att.publicId);

                    updatedAttachments.push({
                        ...att.toObject(),
                        url: '', // Or a placeholder URL
                        publicId: 'expired',
                        name: `${att.name} (Expired)`
                    });
                    msgUpdated = true;
                    deletedCount++;
                } catch (err) {
                    console.error(`Failed to delete asset ${att.publicId}:`, err);
                    updatedAttachments.push(att); // Keep original if failed
                }
            }

            if (msgUpdated) {
                msg.attachments = updatedAttachments;
                await msg.save();
            }
        }

        if (deletedCount > 0) {
            console.log(`Cleanup complete. Deleted ${deletedCount} expired attachments.`);
        } else {
            console.log('No expired media found.');
        }

    } catch (error) {
        console.error('Media cleanup error:', error);
    }
};

module.exports = { cleanupExpiredMedia };
