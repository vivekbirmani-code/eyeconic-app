package com.anonymous.neetmentorshipapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Extends ExpoFirebaseMessagingService so that standard Expo push notifications
 * still work. Our priority=1 intent filter ensures we receive FCM messages first.
 *
 * When the backend sends via Firebase Admin SDK (direct FCM data message), all
 * fields land flat in remoteMessage.data — e.g. data["type"] = "incoming_call".
 *
 * When the backend falls back to Expo Push API, the payload is wrapped in a JSON
 * string inside remoteMessage.data["body"]. We handle both formats.
 */
class MyFirebaseMessagingService : ExpoFirebaseMessagingService() {

    companion object {
        private const val GROUP_CHANNEL_ID = "eyeconic_group_channel"
        private const val GROUP_CHANNEL_NAME = "Group Notifications"
        private const val TAG = "Eyeconic"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "=== FCM message received ===")
        Log.d(TAG, "From: ${remoteMessage.from}")
        Log.d(TAG, "Data keys: ${remoteMessage.data.keys.joinToString()}")

        // ---------------------------------------------------------------
        // CASE 1: Data-only message sent via Firebase Admin SDK (preferred)
        //         All custom fields are flat in remoteMessage.data
        // ---------------------------------------------------------------
        val directType = remoteMessage.data["type"]
        if (!directType.isNullOrBlank()) {
            Log.d(TAG, "Direct FCM data message — type=$directType")
            handleByType(
                type = directType,
                title = remoteMessage.data["title"] ?: "Eyeconic",
                body = remoteMessage.data["body"] ?: remoteMessage.data["message"] ?: "",
                callerName = remoteMessage.data["callerName"] ?: remoteMessage.data["initiatorName"] ?: "Incoming Call"
            )
            return
        }

        // ---------------------------------------------------------------
        // CASE 2: Expo Push API delivery (legacy / fallback)
        //         Expo wraps the data as a JSON string inside data["body"]
        // ---------------------------------------------------------------
        val expoBodyString = remoteMessage.data["body"]
        if (!expoBodyString.isNullOrBlank()) {
            Log.d(TAG, "Expo format payload — trying to parse body JSON")
            try {
                val jsonBody = JSONObject(expoBodyString)
                val title = remoteMessage.notification?.title ?: jsonBody.optString("title", "Eyeconic")
                val message = remoteMessage.notification?.body ?: jsonBody.optString("message", "")
                val customData = jsonBody.optJSONObject("data") ?: JSONObject()
                val type = customData.optString("type")
                val callerName = customData.optString("callerName", 
                    customData.optString("initiatorName", "Incoming Call"))

                Log.d(TAG, "Expo body parsed — type=$type")
                if (type.isNotBlank()) {
                    handleByType(type, title, message, callerName)
                    return
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse Expo body JSON", e)
            }
        }

        // ---------------------------------------------------------------
        // CASE 3: Standard Expo notification (notification block present)
        //         Let Expo handle it normally.
        // ---------------------------------------------------------------
        Log.d(TAG, "Standard notification — passing to Expo")
        super.onMessageReceived(remoteMessage)
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "FCM token refreshed: ${token.take(20)}...")
        // Always notify Expo's layer too
        super.onNewToken(token)
    }

    // ------------------------------------------------------------------
    // Route by type
    // ------------------------------------------------------------------

    private fun handleByType(type: String, title: String, body: String, callerName: String) {
        when (type) {
            "incoming_call", "call" -> {
                Log.d(TAG, "Call notification → starting CallForegroundService")
                CallForegroundService.start(applicationContext, callerName)
            }
            "group", "message", "notification" -> {
                Log.d(TAG, "Group/message notification → posting native heads-up")
                postGroupNotification(title, body)
                // Also pass to Expo so JS listeners fire when app is alive
                // Note: we can't re-invoke super here; the notification is already delivered natively.
            }
            else -> {
                Log.d(TAG, "Unknown type '$type' → nothing to do natively")
            }
        }
    }

    // ------------------------------------------------------------------
    // Native notification for group/message type
    // ------------------------------------------------------------------

    private fun postGroupNotification(title: String, body: String) {
        createGroupChannel()

        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, System.currentTimeMillis().toInt(), openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, GROUP_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

        try {
            NotificationManagerCompat.from(this)
                .notify(System.currentTimeMillis().toInt(), notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted", e)
        }
    }

    private fun createGroupChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(GROUP_CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    GROUP_CHANNEL_ID,
                    GROUP_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Notifications for group messages and activity"
                    enableVibration(true)
                }
                manager.createNotificationChannel(channel)
            }
        }
    }
}
