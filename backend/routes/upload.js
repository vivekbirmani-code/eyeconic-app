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

        // Determine resource type based on mimetype:
        // - Images → 'image' so Cloudinary can process/serve them correctly
        // - PDFs, Word docs, Excel → 'raw' so they get a /raw/upload/ URL
        //   which is a plain file delivery that browsers can open/download without issues.
        const isImage = req.file.mimetype.startsWith('image/');
        const uploadResourceType = isImage ? 'image' : 'raw';

        // For raw (non-image) files, we must explicitly include the original file extension
        // in the public_id. Cloudinary uses the public_id to build the download URL, and
        // without the extension the downloaded file has no format (e.g. "s9ltu7o2" vs "file.pdf").
        const nodePath = require('path');
        const originalExt = nodePath.extname(req.file.originalname);          // e.g. ".pdf"
        const baseName = nodePath.basename(req.file.originalname, originalExt)
            .replace(/[^a-zA-Z0-9_-]/g, '_')               // sanitize
            .substring(0, 60);                              // cap length
        const publicId = isImage
            ? undefined                                                        // auto-generate for images
            : `${baseName}_${Date.now()}`;                                     // OMIT originalExt to bypass Cloudinary's raw PDF delivery block

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'eyeconic_chat_uploads',
            resource_type: uploadResourceType,
            ...(publicId ? { public_id: publicId } : { use_filename: true, unique_filename: true })
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

// Download proxy - fetches files from Cloudinary using API credentials and streams to client.
// Android Chrome cannot open direct Cloudinary URLs (ERR_INVALID_RESPONSE),
// so we fetch server-side with Basic Auth and pipe to the browser.
router.get('/download-proxy', auth, async (req, res) => {
    try {
        const { url, name } = req.query;

        if (!url) {
            return res.status(400).json({ message: 'Missing url parameter' });
        }

        // Only allow Cloudinary URLs for security
        if (!url.startsWith('https://res.cloudinary.com/')) {
            return res.status(403).json({ message: 'Only Cloudinary URLs are allowed' });
        }

        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        console.log(`[download-proxy] Attempting to fetch URL: ${url}`);

        // Fetch from Cloudinary with Basic Auth using our API credentials
        const response = await fetch(url, {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64')
            }
        });

        console.log(`[download-proxy] Auth fetch status: ${response.status}`);

        if (!response.ok) {
            console.log(`[download-proxy] Auth fetch failed. Trying without auth...`);
            // If authenticated fetch fails, try without auth (public resources)
            const publicResponse = await fetch(url);
            console.log(`[download-proxy] Public fetch status: ${publicResponse.status}`);

            if (!publicResponse.ok) {
                const errorText = await publicResponse.text().catch(() => 'no text');
                console.error(`[download-proxy] Cloudinary returned ${publicResponse.status}: ${errorText}`);

                let errorMessage = `Cloudinary returned ${publicResponse.status}`;
                if (publicResponse.status === 401 || publicResponse.status === 400) {
                    if (url.toLowerCase().endsWith('.pdf') || url.toLowerCase().endsWith('.zip')) {
                        errorMessage = "Cloudinary blocked this PDF/ZIP file. To fix this for previously uploaded files, please enable 'Allow delivery of PDF and ZIP files' in your Cloudinary Security settings. (Note: New uploads will now work automatically without this setting).";
                    }
                }

                return res.status(502).json({ message: errorMessage });
            }
            // Stream public response
            const ct = publicResponse.headers.get('content-type') || 'application/octet-stream';
            const fn = name || 'download';
            res.setHeader('Content-Type', ct);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fn)}"`);
            const { Readable } = require('stream');
            Readable.fromWeb(publicResponse.body).pipe(res);
            return;
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const fileName = name || 'download';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Cache-Control', 'private, max-age=3600');

        // Stream body to client
        const { Readable } = require('stream');
        Readable.fromWeb(response.body).pipe(res);

    } catch (error) {
        console.error('Download proxy error:', error);
        res.status(500).json({ message: 'Download failed', error: error.message });
    }
});

module.exports = router;
