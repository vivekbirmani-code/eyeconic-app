package com.anonymous.neetmentorshipapp

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MyFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        
        Log.d("Eyeconic", "Message received from: ${remoteMessage.from}")

        // Check if message contains a data payload.
        // Data messages are handled here in onMessageReceived whether the app is in the foreground or background.
        // For notification messages, this is only called when the app is in the foreground.
        if (remoteMessage.data.isNotEmpty()) {
            Log.d("Eyeconic", "Message data payload: ${remoteMessage.data}")
            val type = remoteMessage.data["type"]
            
            // If the message is a call, trigger the WakeUpModule
            if (type == "call") {
                Log.d("Eyeconic", "Waking up device for incoming call")
                WakeUpModule.activate(applicationContext)
            }
        }
    }
    
    override fun onNewToken(token: String) {
        Log.d("Eyeconic", "Refreshed token: $token")
        // Note: You would typically send this token to your server here
        // But React Native side likely handles token registration
    }
}
