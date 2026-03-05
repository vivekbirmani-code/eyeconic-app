const {
    withAndroidManifest,
    withAppBuildGradle,
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
            const targetDir = path.join(
                projectRoot,
                'android', 'app', 'src', 'main', 'java',
                'com', 'anonymous', 'neetmentorshipapp'
            );

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
            'android.permission.USE_FULL_SCREEN_INTENT',
            'android.permission.WAKE_LOCK',
            // Android 13+ required to post notifications
            'android.permission.POST_NOTIFICATIONS',
            // Android 14+ required for call-type foreground services
            'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
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

        // --- FCM Service ---
        const services = mainApplication.service || [];

        const addServiceIfMissing = (name, attrs, intentFilters) => {
            const existing = services.find(s => s.$['android:name'] === name);
            if (!existing) {
                services.push({
                    $: { 'android:name': name, ...attrs },
                    ...(intentFilters ? { 'intent-filter': intentFilters } : {}),
                });
            }
        };

        // Firebase Messaging Service
        addServiceIfMissing(
            '.MyFirebaseMessagingService',
            { 'android:exported': 'false' },
            [{
                $: { 'android:priority': '1' },
                action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }]
            }]
        );

        // CallForegroundService — stopWithTask=false keeps it alive after swipe-kill
        addServiceIfMissing(
            '.CallForegroundService',
            {
                'android:exported': 'false',
                'android:foregroundServiceType': 'connectedDevice',
                'android:stopWithTask': 'false',
            }
        );

        mainApplication.service = services;

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
// 3. Add Firebase Messaging dependency to app/build.gradle
// ---------------------------------------------------------------------------
const withWakeUpGradle = (config) => {
    return withAppBuildGradle(config, (config) => {
        const buildGradle = config.modResults.contents;
        const dependency = `implementation 'com.google.firebase:firebase-messaging:23.4.0'`;

        if (!buildGradle.includes(dependency)) {
            config.modResults.contents = buildGradle.replace(
                /dependencies\s*{/,
                `dependencies {\n    ${dependency}`
            );
        }

        return config;
    });
};

// ---------------------------------------------------------------------------
// 4. Register WakeUpPackage + BatteryOptimizationPackage in MainApplication
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
        withWakeUpMainApplication,
    ]);
};

module.exports = withWakeUp;
