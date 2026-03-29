package com.eyeconicbydrlalla.mentorship

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject

/**
 * Intercepts raw FCM messages broadcast by Google Play Services BEFORE they are
 * routed to FirebaseMessagingService. This guarantees we can process "killed state"
 * data-only messages even if Expo's service tries to swallow them.
 */
class FcmDirectReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d("Eyeconic", "FcmDirectReceiver: Received intent action = $action")

        if (action == "com.google.android.c2dm.intent.RECEIVE") {
            val bodyString = intent.getStringExtra("body")
            val typeStr = intent.getStringExtra("type")
            
            Log.d("Eyeconic", "FcmDirectReceiver: data.type = $typeStr, data.body = $bodyString")

            // Case 1: Expo nested JSON payload
            if (!bodyString.isNullOrBlank()) {
                try {
                    val jsonBody = JSONObject(bodyString)
                    val customData = jsonBody.optJSONObject("data") ?: JSONObject()
                    val type = customData.optString("type")
                    val callerName = customData.optString("callerName", customData.optString("initiatorName", "Incoming Call"))
                    
                    if (type == "incoming_call" || type == "call") {
                        Log.d("Eyeconic", "FcmDirectReceiver: Detected nested call! Starting foreground service.")
                        CallForegroundService.start(context, callerName)
                        abortBroadcast() // Stop other receivers from getting this
                        return
                    }
                } catch (e: Exception) {
                    Log.e("Eyeconic", "FcmDirectReceiver: Failed to parse body JSON", e)
                }
            }

            // Case 2: Flat payload or top-level type matching
            if (typeStr == "incoming_call" || typeStr == "call") {
                val callerName = intent.getStringExtra("callerName") ?: intent.getStringExtra("initiatorName") ?: "Incoming Call"
                Log.d("Eyeconic", "FcmDirectReceiver: Detected flat call! Starting foreground service.")
                CallForegroundService.start(context, callerName)
                abortBroadcast() // Stop other receivers
                return
            }
        }
    }
}
