// Spot-check: public /start response for a sectioned public quiz must carry
// the real Cloudinary questionImage for the image-based question, and the
// image URL must be publicly fetchable. Usage: node scripts/verifyPublicQuizImageApi.js <shareToken> [baseUrl]
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const shareToken = process.argv[2];
const baseUrl = process.argv[3] || `http://localhost:${process.env.PORT || 3000}`;
if (!shareToken) { console.error('shareToken required'); process.exit(1); }

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Guest = require('../models/Guest');
    const { signGuestToken } = require('../middleware/guestAuth');
    const guest = await Guest.findOneAndUpdate(
        { phone: `+9199${Date.now().toString().slice(-8)}` },
        { $set: { name: 'Image API Verify', email: `api-verify-${Date.now()}@eyeconic.test`, emailVerifiedAt: new Date(), lastActiveAt: new Date() } },
        { new: true, upsert: true }
    );
    await mongoose.disconnect();

    const res = await fetch(`${baseUrl}/api/public/quiz/${shareToken}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signGuestToken(guest._id)}` },
        body: JSON.stringify({ guestId: `api-verify-${Date.now()}`, deviceInfo: 'image-api-verify' }),
    });
    const body = await res.json();
    const imgQ = (body.quiz?.questions || []).find((q) => q.questionImage);
    const checks = [];
    const check = (ok, label, extra = '') => { checks.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`); };

    check(res.status === 201 || res.status === 200, `start returned ${res.status}`, body.message || '');
    check(!!imgQ, 'start payload contains an image-based question');
    if (imgQ) {
        check(imgQ.questionImage.includes('res.cloudinary.com'), 'questionImage is a Cloudinary URL', imgQ.questionImage.split('/').pop());
        const imgRes = await fetch(imgQ.questionImage);
        check(imgRes.status === 200 && (imgRes.headers.get('content-type') || '').startsWith('image/'),
            'image publicly fetchable without auth', `${imgRes.status} ${imgRes.headers.get('content-type')}`);
        check(!imgQ.questionImage.includes('question-image-placeholder'), 'not the placeholder asset');
    }
    process.exit(checks.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
