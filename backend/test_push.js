const fetch = require('node-fetch'); // If needed, though node 18+ has fetch built-in

const testToken = process.argv[2]; // Pass token as arg

if (!testToken) {
    console.log("Usage: node test_push.js <expo_push_token>");
    process.exit(1);
}

async function testPush() {
    const message = {
        to: testToken,
        priority: 'high',
        // NO top-level title, NO top-level body. This makes it a "data-only" message.
        data: {
            type: 'incoming_call', // MUST be a string
            callerName: 'Test Caller',
            // DO NOT put title/message here if you want it to be purely data without triggering Expo's default handling
            custom_payload_test: 'yes'
        }
    };

    console.log("Sending payload:", JSON.stringify(message, null, 2));

    try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        const result = await response.json();
        console.log('Result:', result);
    } catch (error) {
        console.error('Error:', error);
    }
}

testPush();
