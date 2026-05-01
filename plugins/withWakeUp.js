const {
    withAndroidManifest,
    withAppBuildGradle,
    withProjectBuildGradle,
    withMainApplication,
    withDangerousMod,
    withPlugins,
    AndroidConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Copy all Kotlin source files from plugins/files/ to the android source dir
// ---------------------------------------------------------------------------
const withWakeUpFiles = (config) => {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const projectRoot = config.modRequest.projectRoot;
            const sourceDir = path.join(projectRoot, 'plugins', 'files');
            const androidConfig = config.android || {};
            const packageName = androidConfig.package || 'com.eyeconicbydrlalla.mentorship';
            const packagePath = packageName.split('.').join(path.sep);

            const targetDir = path.join(
                projectRoot,
                'android', 'app', 'src', 'main', 'java',
                packagePath
            );

            // Ensure target directory exists for copyFileSync
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            if (!fs.existsSync(sourceDir)) {
                console.warn('WakeUpModule source files not found in plugins/files');
                return config;
            }

            const filesToCopy = [
                'WakeUpModule.kt',
                'WakeUpPackage.kt',
                'MyFirebaseMessagingService.kt',
                'FcmDirectReceiver.kt',
                'CallForegroundService.kt',
                'BootReceiver.kt',
                'BatteryOptimizationModule.kt',
                'BatteryOptimizationPackage.kt',
            ];

            filesToCopy.forEach(file => {
                const sourceFile = path.join(sourceDir, file);
                const targetFile = path.join(targetDir, file);
                if (fs.existsSync(sourceFile)) {
                    fs.copyFileSync(sourceFile, targetFile);
                } else {
                    console.warn(`Source file missing: ${sourceFile}`);
                }
            });

            // Copy google-services.json to android/app/ for Firebase
            const gsSource = path.join(sourceDir, 'google-services.json');
            const gsTarget = path.join(projectRoot, 'android', 'app', 'google-services.json');
            if (fs.existsSync(gsSource)) {
                fs.copyFileSync(gsSource, gsTarget);
                console.log('google-services.json copied to android/app/');
            } else {
                console.warn('google-services.json not found in plugins/files/ — Firebase FCM will not work!');
            }

            return config;
        },
    ]);
};

// ---------------------------------------------------------------------------
// 2. Update AndroidManifest.xml with new permissions, service, and receiver
// ---------------------------------------------------------------------------
const withWakeUpManifest = (config) => {
    return withAndroidManifest(config, async (config) => {
        const androidManifest = config.modResults;
        const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

        // --- Permissions ---
        if (!androidManifest.manifest['uses-permission']) {
            androidManifest.manifest['uses-permission'] = [];
        }

        const permissionsToAdd = [
            'android.permission.WAKE_LOCK',
            // Android 13+ required to post notifications
            'android.permission.POST_NOTIFICATIONS',
            // Android 14+ foreground service permission for ringing call notification service
            'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
            // Required for battery optimization exemption dialog
            'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        ];

        permissionsToAdd.forEach(permissionName => {
            const hasPermission = androidManifest.manifest['uses-permission'].some(
                (p) => p.$ && p.$['android:name'] === permissionName
            );
            if (!hasPermission) {
                androidManifest.manifest['uses-permission'].push({
                    $: { 'android:name': permissionName }
                });
            }
        });

        // --- Remove Expo's own ExpoFirebaseMessagingService (our subclass replaces it) ---
        const services = mainApplication.service || [];
        mainApplication.service = services.filter(
            s => s.$['android:name'] !== 'expo.modules.notifications.service.ExpoFirebaseMessagingService'
        );

        // --- FCM Service ---
        const addServiceIfMissing = (name, attrs, intentFilters) => {
            const existing = mainApplication.service.find(s => s.$['android:name'] === name);
            if (!existing) {
                mainApplication.service.push({
                    $: { 'android:name': name, ...attrs },
                    ...(intentFilters ? { 'intent-filter': intentFilters } : {}),
                });
            }
        };

        // Firebase Messaging Service — high priority to win over any remaining library services
        addServiceIfMissing(
            '.MyFirebaseMessagingService',
            { 'android:exported': 'false' },
            [{
                $: { 'android:priority': '100' },
                action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }]
            }]
        );

        // CallForegroundService — stopWithTask=false keeps it alive after swipe-kill
        addServiceIfMissing(
            '.CallForegroundService',
            {
                'android:exported': 'false',
                'android:foregroundServiceType': 'mediaPlayback',
                'android:stopWithTask': 'false',
            }
        );

        // --- BootReceiver ---
        if (!mainApplication.receiver) {
            mainApplication.receiver = [];
        }
        const bootReceiverName = '.BootReceiver';
        const existingBootReceiver = mainApplication.receiver.find(
            r => r.$['android:name'] === bootReceiverName
        );
        if (!existingBootReceiver) {
            mainApplication.receiver.push({
                $: {
                    'android:name': bootReceiverName,
                    'android:enabled': 'true',
                    'android:exported': 'false',
                },
                'intent-filter': [
                    {
                        action: [
                            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
                            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
                        ],
                        category: [
                            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
                        ],
                    },
                ],
            });
        }

        // --- FcmDirectReceiver (Intercept FCM before Expo service) ---
        const fcmReceiverName = '.FcmDirectReceiver';
        const existingFcmReceiver = mainApplication.receiver.find(
            r => r.$['android:name'] === fcmReceiverName
        );
        if (!existingFcmReceiver) {
            mainApplication.receiver.push({
                $: {
                    'android:name': fcmReceiverName,
                    'android:enabled': 'true',
                    'android:exported': 'true',
                    'android:permission': 'com.google.android.c2dm.permission.SEND',
                },
                'intent-filter': [
                    {
                        $: { 'android:priority': '999' },
                        action: [
                            { $: { 'android:name': 'com.google.android.c2dm.intent.RECEIVE' } },
                        ],
                    },
                ],
            });
        }

        return config;
    });
};

// ---------------------------------------------------------------------------
// 3. Add Firebase Messaging dependency + google-services plugin to app/build.gradle
// ---------------------------------------------------------------------------
const withWakeUpGradle = (config) => {
    return withAppBuildGradle(config, (config) => {
        let buildGradle = config.modResults.contents;

        // Add firebase-messaging dependency
        const dependency = `implementation 'com.google.firebase:firebase-messaging:23.4.0'`;
        if (!buildGradle.includes(dependency)) {
            buildGradle = buildGradle.replace(
                /dependencies\s*{/,
                `dependencies {\n    ${dependency}`
            );
        }

        // Apply google-services plugin conditionally
        const gsPlugin = `apply plugin: 'com.google.gms.google-services'`;
        const gsConditional = `// Apply google-services plugin only when google-services.json exists
if (file('google-services.json').exists()) {
    apply plugin: 'com.google.gms.google-services'
}`;
        if (!buildGradle.includes('google.gms.google-services')) {
            buildGradle = buildGradle + `\n${gsConditional}\n`;
        }

        config.modResults.contents = buildGradle;
        return config;
    });
};

// ---------------------------------------------------------------------------
// 4. Add google-services classpath to root build.gradle
// ---------------------------------------------------------------------------
const withGoogleServicesClasspath = (config) => {
    return withProjectBuildGradle(config, (config) => {
        let buildGradle = config.modResults.contents;

        const classpath = `classpath('com.google.gms:google-services:4.4.0')`;
        if (!buildGradle.includes('com.google.gms:google-services')) {
            buildGradle = buildGradle.replace(
                /dependencies\s*{/,
                `dependencies {\n        ${classpath}`
            );
        }

        config.modResults.contents = buildGradle;
        return config;
    });
};

// ---------------------------------------------------------------------------
// 5. Register WakeUpPackage + BatteryOptimizationPackage in MainApplication
// ---------------------------------------------------------------------------
const withWakeUpMainApplication = (config) => {
    return withMainApplication(config, (config) => {
        let mainApplication = config.modResults.contents;

        // Register WakeUpPackage
        if (!mainApplication.includes('add(WakeUpPackage())')) {
            const targetString = 'PackageList(this).packages.apply {';
            if (mainApplication.includes(targetString)) {
                mainApplication = mainApplication.replace(
                    targetString,
                    `${targetString}\n              add(WakeUpPackage())`
                );
            } else {
                console.warn('Could not find getPackages() block in MainApplication.kt');
            }
        }

        // Register BatteryOptimizationPackage
        if (!mainApplication.includes('add(BatteryOptimizationPackage())')) {
            const targetString = 'add(WakeUpPackage())';
            if (mainApplication.includes(targetString)) {
                mainApplication = mainApplication.replace(
                    targetString,
                    `${targetString}\n              add(BatteryOptimizationPackage())`
                );
            } else {
                console.warn('Could not find WakeUpPackage() registration in MainApplication.kt');
            }
        }

        config.modResults.contents = mainApplication;
        return config;
    });
};

// ---------------------------------------------------------------------------
// Main plugin export
// ---------------------------------------------------------------------------
const withWakeUp = (config) => {
    return withPlugins(config, [
        withWakeUpFiles,
        withWakeUpManifest,
        withWakeUpGradle,
        withGoogleServicesClasspath,
        withWakeUpMainApplication,
    ]);
};

module.exports = withWakeUp;
