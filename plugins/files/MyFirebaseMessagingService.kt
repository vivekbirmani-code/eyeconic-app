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
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "=== FCM message received ===")
        Log.d(TAG, "Data keys: ${remoteMessage.data.keys.joinToString()}")

        val data = remoteMessage.data

        // Case 1: flat data payload (direct or Expo-forwarded)
        val flatType = data["type"]
        if (!flatType.isNullOrBlank()) {
            handleByType(
                type = flatType,
                title = data["title"] ?: remoteMessage.notification?.title ?: "Eyeconic",
                body = data["body"] ?: data["message"] ?: remoteMessage.notification?.body ?: "",
                callerName = data["callerName"] ?: data["initiatorName"] ?: "Incoming Call"
            )
            return
        }

        // Case 2: Expo sometimes wraps custom payload in data["body"] as JSON string
        val bodyJsonString = data["body"]
        if (!bodyJsonString.isNullOrBlank()) {
            try {
                val bodyJson = JSONObject(bodyJsonString)
                val wrappedData = bodyJson.optJSONObject("data") ?: JSONObject()
                val wrappedType = wrappedData.optString("type", bodyJson.optString("type", ""))

                if (wrappedType.isNotBlank()) {
                    val title = bodyJson.optString("title", remoteMessage.notification?.title ?: "Eyeconic")
                    val message = bodyJson.optString("message", remoteMessage.notification?.body ?: "")
                    val callerName = wrappedData.optString(
                        "callerName",
                        wrappedData.optString("initiatorName", "Incoming Call")
                    )

                    handleByType(wrappedType, title, message, callerName)
                    return
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed parsing wrapped body JSON", e)
            }
        }

        // Case 3: default Expo notification flow
        super.onMessageReceived(remoteMessage)
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "FCM token refreshed: ${token.take(20)}...")
        super.onNewToken(token)
    }

    private fun handleByType(type: String, title: String, body: String, callerName: String) {
        when (type.lowercase(Locale.US)) {
            "incoming_call", "call" -> {
                try {
                    Log.d(TAG, "Incoming call payload -> starting call foreground service")
                    CallForegroundService.start(applicationContext, callerName)
                } catch (e: Exception) {
                    Log.e(TAG, "Call service start failed, posting fallback call notification", e)
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
                postNotification(
                    channelId = GROUP_CHANNEL_ID,
                    channelName = GROUP_CHANNEL_NAME,
                    channelDescription = "Notifications for group messages and activity",
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
            .build()

        try {
            NotificationManagerCompat.from(this)
                .notify(System.currentTimeMillis().toInt(), notification)
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
                }
                manager.createNotificationChannel(channel)
            }
        }
    }
}

