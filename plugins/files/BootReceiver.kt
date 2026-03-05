package com.anonymous.neetmentorshipapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging

/**
 * BootReceiver ensures that after the device reboots, the app refreshes
 * its FCM token. This guarantees notifications and calls resume delivering
 * even if the user never manually opens the app after a reboot.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }

        Log.d("Eyeconic", "BootReceiver: Device booted, refreshing FCM token")

        // Request a fresh FCM token. The MyFirebaseMessagingService.onNewToken()
        // callback will fire automatically when the token is refreshed.
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.w("Eyeconic", "BootReceiver: FCM token fetch failed", task.exception)
                return@addOnCompleteListener
            }
            val token = task.result
            Log.d("Eyeconic", "BootReceiver: FCM token refreshed: $token")
            // The actual token upload to your backend is handled in
            // MyFirebaseMessagingService.onNewToken() which React Native's
            // expo-notifications module already manages.
        }
    }
}
