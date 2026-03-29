package com.eyeconicbydrlalla.mentorship

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BatteryOptimizationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BatteryOptimizationModule"

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true)
                return
            }
            // Fix: Use Context.POWER_SERVICE instead of ReactApplicationContext.POWER_SERVICE
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            val packageName = reactApplicationContext.packageName
            promise.resolve(pm.isIgnoringBatteryOptimizations(packageName))
        } catch (e: Exception) {
            Log.e("Eyeconic", "BatteryOptimizationModule: Error checking status", e)
            promise.reject("ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true)
                return
            }

            val packageName = reactApplicationContext.packageName
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager

            if (pm.isIgnoringBatteryOptimizations(packageName)) {
                Log.d("Eyeconic", "BatteryOptimizationModule: Already whitelisted")
                promise.resolve(true)
                return
            }

            // Fix: Use reactApplicationContext.currentActivity
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                Log.w("Eyeconic", "BatteryOptimizationModule: No activity to start intent")
                promise.reject("NO_ACTIVITY", "No current activity available")
                return
            }

            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                activity.startActivity(intent)
                promise.resolve(false)
            } catch (e: Exception) {
                Log.w("Eyeconic", "BatteryOptimizationModule: Direct intent failed, falling back", e)
                try {
                    val fallbackIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    activity.startActivity(fallbackIntent)
                    promise.resolve(false)
                } catch (e2: Exception) {
                    promise.reject("FAILED", e2.message, e2)
                }
            }
        } catch (e: Exception) {
            Log.e("Eyeconic", "BatteryOptimizationModule: Unexpected error", e)
            promise.reject("ERROR", e.message, e)
        }
    }
}
