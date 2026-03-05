package com.anonymous.neetmentorshipapp

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.util.Log
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WakeUpModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WakeUpModule"

    @ReactMethod
    fun activate() {
        Log.d("Eyeconic", "WakeUpModule.activate() called from JS")
        
        // Fix: Use reactApplicationContext.currentActivity
        val activity: Activity? = reactApplicationContext.currentActivity
        if (activity == null) {
            Log.w("Eyeconic", "WakeUpModule.activate(): No current activity — using service instead")
            return
        }

        // Fix: Use Context.KEYGUARD_SERVICE
        val keyguardManager = reactApplicationContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

        // Fix: Use runOnUiThread properly via activity
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                activity.setShowWhenLocked(true)
                activity.setTurnScreenOn(true)
                keyguardManager.requestDismissKeyguard(activity, null)
            } else {
                @Suppress("DEPRECATION")
                activity.window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                )
            }
        }
    }

    @ReactMethod
    fun dismissCallNotification() {
        Log.d("Eyeconic", "WakeUpModule.dismissCallNotification() called from JS")
        CallForegroundService.stop(reactApplicationContext)
    }
}
