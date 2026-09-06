/**
 * Mints a verified guest (lead) + guest session token for harness use.
 * Creates the Guest through the model (never raw insertOne — schema defaults
 * and validation must apply). Prints { guestToken, guestId } as JSON.
 *
 * Usage: node scripts/mintGuestToken.js --phone +919999000011 [--name Image Pipeline Verify]
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { signGuestToken } = require('../middleware/guestAuth');

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

(async () => {
    const phone = argValue('--phone', `+9199${Date.now().toString().slice(-8)}`);
    const name = argValue('--name', 'Image Pipeline Verify');

    await mongoose.connect(process.env.MONGODB_URI);
    const Guest = require('../models/Guest');

    const guest = await Guest.findOneAndUpdate(
        { phone },
        {
            $set: {
                name,
                email: argValue('--email', `image-verify-${Date.now()}@eyeconic.test`),
                emailVerifiedAt: new Date(),
                source: 'web',
                lastActiveAt: new Date(),
            },
        },
        { new: true, upsert: true }
    );

    console.log(JSON.stringify({
        guestToken: signGuestToken(guest._id),
        guestId: String(guest._id),
        phone: guest.phone,
    }));
    await mongoose.disconnect();
})().catch((err) => {
    console.error('Mint failed:', err.message);
    process.exit(1);
});
