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
import java.util.Locale

class MyFirebaseMessagingService : ExpoFirebaseMessagingService() {

    companion object {
        private const val TAG = "Eyeconic"

        private const val GROUP_CHANNEL_ID = "eyeconic_group_channel"
        private const val GROUP_CHANNEL_NAME = "Group Notifications"

        private const val QUIZ_CHANNEL_ID = "eyeconic_quiz_channel"
        private const val QUIZ_CHANNEL_NAME = "Quiz Notifications"

        private const val DEFAULT_CHANNEL_ID = "eyeconic_default_channel"
        private const val DEFAULT_CHANNEL_NAME = "General Notifications"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "=== FCM message received ===")
        Log.d(TAG, "Data keys: ${remoteMessage.data.keys.joinToString()}")
        Log.d(TAG, "Has notification payload: ${remoteMessage.notification != null}")

        val data = remoteMessage.data

        // ---- Case 1: Flat data payload (direct FCM from Admin SDK) ----
        // Firebase Admin SDK sends data as flat key-value pairs in remoteMessage.data
        val flatType = data["type"]
        if (!flatType.isNullOrBlank()) {
            Log.d(TAG, "Case 1: Flat data type = $flatType")
            val title = data["title"] ?: remoteMessage.notification?.title ?: "Eyeconic"
            val body = data["body"] ?: data["message"] ?: remoteMessage.notification?.body ?: ""
            val callerName = data["callerName"] ?: data["initiatorName"] ?: "Incoming Call"

            handleByType(
                type = flatType,
                title = title,
                body = body,
                callerName = callerName,
                data = data
            )
            return
        }

        // ---- Case 2: Expo Push API wraps payload in data["body"] as JSON string ----
        val bodyJsonString = data["body"]
        if (!bodyJsonString.isNullOrBlank()) {
            try {
                val bodyJson = JSONObject(bodyJsonString)

                // Expo may nest under a "data" key, or put fields at root
                val wrappedData = bodyJson.optJSONObject("data") ?: bodyJson
                val wrappedType = wrappedData.optString("type", "")

                if (wrappedType.isNotBlank()) {
                    Log.d(TAG, "Case 2: Expo-wrapped type = $wrappedType")
                    val title = wrappedData.optString("title",
                        bodyJson.optString("title",
                            remoteMessage.notification?.title ?: "Eyeconic"))
                    val message = wrappedData.optString("message",
                        wrappedData.optString("body",
                            bodyJson.optString("message",
                                remoteMessage.notification?.body ?: "")))
                    val callerName = wrappedData.optString("callerName",
                        wrappedData.optString("initiatorName", "Incoming Call"))

                    handleByType(wrappedType, title, message, callerName, data)
                    return
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed parsing wrapped body JSON", e)
            }
        }

        // ---- Case 3: Notification-only message (has notification field but no data type) ----
        // When Admin SDK sends notification+data messages AND the app is in
        // foreground, onMessageReceived fires. Post it ourselves.
        val notification = remoteMessage.notification
        if (notification != null) {
            Log.d(TAG, "Case 3: Notification payload, title=${notification.title}")
            postNotification(
                channelId = DEFAULT_CHANNEL_ID,
                channelName = DEFAULT_CHANNEL_NAME,
                channelDescription = "General app notifications",
                title = notification.title ?: "Eyeconic",
                body = notification.body ?: ""
            )
            return
        }

        // ---- Case 4: Unrecognized — let Expo handle it ----
        Log.d(TAG, "Case 4: Falling through to Expo default handler")
        super.onMessageReceived(remoteMessage)
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "FCM token refreshed: ${token.take(20)}...")
        super.onNewToken(token)
    }

    private fun handleByType(
        type: String,
        title: String,
        body: String,
        callerName: String,
        data: Map<String, String> = emptyMap()
    ) {
        Log.d(TAG, "handleByType: type=$type, title=$title, body=$body")

        when (type.lowercase(Locale.US)) {
            "incoming_call", "call" -> {
                try {
                    Log.d(TAG, "Starting CallForegroundService for caller: $callerName")
                    CallForegroundService.start(applicationContext, callerName)
                } catch (e: Exception) {
                    Log.e(TAG, "Call service start failed, posting fallback notification", e)
                    CallForegroundService.postIncomingCallNotification(applicationContext, callerName)
                }
            }
            "group", "message", "notification", "group_message" -> {
                postNotification(
                    channelId = GROUP_CHANNEL_ID,
                    channelName = GROUP_CHANNEL_NAME,
                    channelDescription = "Notifications for group messages and activity",
                    title = if (title.isBlank()) "New Message" else title,
                    body = if (body.isBlank()) "You have a new message" else body
                )
            }
            "quiz_assigned", "quiz_completed", "quiz", "test" -> {
                postNotification(
                    channelId = QUIZ_CHANNEL_ID,
                    channelName = QUIZ_CHANNEL_NAME,
                    channelDescription = "Notifications for assigned and completed quizzes",
                    title = if (title.isBlank()) "Quiz Update" else title,
                    body = if (body.isBlank()) "You have a new quiz notification" else body
                )
            }
            else -> {
                Log.d(TAG, "Unknown type '$type', posting as general notification")
                postNotification(
                    channelId = DEFAULT_CHANNEL_ID,
                    channelName = DEFAULT_CHANNEL_NAME,
                    channelDescription = "General app notifications",
                    title = if (title.isBlank()) "Eyeconic" else title,
                    body = if (body.isBlank()) "You have a new notification" else body
                )
            }
        }
    }

    private fun postNotification(
        channelId: String,
        channelName: String,
        channelDescription: String,
        title: String,
        body: String
    ) {
        createChannel(channelId, channelName, channelDescription)

        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build()

        try {
            NotificationManagerCompat.from(this)
                .notify(System.currentTimeMillis().toInt(), notification)
            Log.d(TAG, "Notification posted: $title")
        } catch (e: SecurityException) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted", e)
        }
    }

    private fun createChannel(channelId: String, channelName: String, description: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(channelId) == null) {
                val channel = NotificationChannel(
                    channelId,
                    channelName,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    this.description = description
                    enableVibration(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                }
                manager.createNotificationChannel(channel)
                Log.d(TAG, "Created notification channel: $channelId")
            }
        }
    }
}

