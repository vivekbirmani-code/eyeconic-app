const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { auth } = require('../middleware/auth');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/', auth, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }

        // Convert buffer to base64
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        let dataURI = "data:" + req.file.mimetype + ";base64," + b64;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'eyeconic_app',
            resource_type: 'auto'
        });

        res.json({
            success: true,
            url: result.secure_url,
            public_id: result.public_id
        });

    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({
            message: 'Image upload failed',
            error: error.message
        });
    }
});

// Chat file upload - Max 10MB
router.post('/chat', auth, upload.single('file'), async (req, res) => {
    try {
        console.log('=== Chat Upload Request ===');
        if (!req.file) {
            console.log('Error: No file in request');
            return res.status(400).json({ message: 'No file provided' });
        }

        console.log('File details:', {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        });

        // Check file size (10MB = 10 * 1024 * 1024 bytes)
        const MAX_SIZE = 10 * 1024 * 1024;
        if (req.file.size > MAX_SIZE) {
            console.log(`Error: File too large (${req.file.size} > ${MAX_SIZE})`);
            return res.status(400).json({ message: 'File too large. Max limit is 10MB.' });
        }

        // Allowed MIME types
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // xlsx
        ];

        if (!allowedTypes.includes(req.file.mimetype)) {
            console.log(`Error: Invalid mimetype ${req.file.mimetype}`);
            return res.status(400).json({
                message: `Invalid file type: ${req.file.mimetype}. Only Images, PDF, Docs, and Excel are allowed.`
            });
        }

        // Convert buffer to base64
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        let dataURI = "data:" + req.file.mimetype + ";base64," + b64;

        // Determine resource type
        let resourceType = 'auto'; // Let Cloudinary decide (image, video, raw)
        // Note: For PDFs and Docs, 'auto' usually works but sometimes 'raw' is safer for non-images if auto fails.
        // However, auto is generally best for Images/Videos/PDFs. Cloudinary treats PDFs as images often.
        // For Excel/Word, it might be 'raw'.

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'eyeconic_chat_uploads',
            resource_type: 'auto',
            use_filename: true,
            unique_filename: true
        });

        res.json({
            success: true,
            url: result.secure_url,
            public_id: result.public_id,
            name: req.file.originalname,
            size: req.file.size,
            mimeType: req.file.mimetype,
            resource_type: result.resource_type
        });

    } catch (error) {
        console.error('Chat Upload Error:', error);
        res.status(500).json({
            message: 'File upload failed',
            error: error.message
        });
    }
});

module.exports = router;
