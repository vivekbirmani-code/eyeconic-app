const cloudinary = require('cloudinary').v2;
require('dotenv').config();

async function testFetch() {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });

    try {
        const dummyPdf = "%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/List []\n/Count 0\n>>\nendobj\ntrailer\n<<\n/Size 3\n/Root 1 0 R\n>>\n%%EOF";
        const dataURI = "data:application/pdf;base64," + Buffer.from(dummyPdf).toString('base64');
        const publicId = `eyeconic_test/test_file_${Date.now()}_pdfdoc`; // NO .pdf EXTENSION!

        console.log("Uploading without .pdf extension...");
        const result = await cloudinary.uploader.upload(dataURI, {
            resource_type: 'raw',
            public_id: publicId
        });

        const url = result.secure_url;
        console.log("URL:", url);

        console.log("Fetching URL directly...");
        let response = await fetch(url);
        console.log("Fetch Status:", response.status);
        if (!response.ok) {
            console.log("Error:", await response.text());
        } else {
            console.log("Success! Extracted PDF size:", (await response.arrayBuffer()).byteLength);
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

testFetch();
