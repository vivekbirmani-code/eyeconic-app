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

const withWakeUpFiles = (config) => {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const projectRoot = config.modRequest.projectRoot;
            const sourceDir = path.join(projectRoot, 'plugins', 'files');
            const targetDir = path.join(
                projectRoot,
                'android',
                'app',
                'src',
                'main',
                'java',
                'com',
                'anonymous',
                'neetmentorshipapp'
            );

            // Ensure source files exist
            if (!fs.existsSync(sourceDir)) {
                console.warn('WakeUpModule source files not found in plugins/files');
                return config;
            }

            // Copy files
            ['WakeUpModule.kt', 'WakeUpPackage.kt', 'MyFirebaseMessagingService.kt'].forEach(file => {
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

const withWakeUpManifest = (config) => {
    return withAndroidManifest(config, async (config) => {
        const androidManifest = config.modResults;
        const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

        // Add Permissions
        AndroidConfig.Manifest.addPermission(androidManifest, 'android.permission.USE_FULL_SCREEN_INTENT');
        AndroidConfig.Manifest.addPermission(androidManifest, 'android.permission.WAKE_LOCK');

        // Add Service
        // Check if service already exists to avoid duplicates
        const services = mainApplication.service || [];
        const serviceName = '.MyFirebaseMessagingService';

        const existingService = services.find(s => s.$['android:name'] === serviceName);

        if (!existingService) {
            mainApplication.service = [
                ...services,
                {
                    $: {
                        'android:name': serviceName,
                        'android:exported': 'false',
                    },
                    'intent-filter': [
                        {
                            action: [
                                {
                                    $: {
                                        'android:name': 'com.google.firebase.MESSAGING_EVENT',
                                    },
                                },
                            ],
                        },
                    ],
                },
            ];
        }

        return config;
    });
};

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

const withWakeUpMainApplication = (config) => {
    return withMainApplication(config, (config) => {
        const mainApplication = config.modResults.contents;
        const packageImport = `add(WakeUpPackage())`;

        // Check if package is already added
        if (!mainApplication.includes(packageImport)) {
            // Look for getPackages() block and add the package
            // This regex looks for the comment line before or just inside getPackages
            // This is a bit fragile but standard for MainApplication.kt modifications

            // Strategy: Look for "PackageList(this).packages.apply {"
            const targetString = 'PackageList(this).packages.apply {';

            if (mainApplication.includes(targetString)) {
                config.modResults.contents = mainApplication.replace(
                    targetString,
                    `${targetString}\n              add(WakeUpPackage())`
                );
            } else {
                console.warn('Could not find getPackages() block in MainApplication.kt');
            }
        }

        return config;
    });
};

const withWakeUp = (config) => {
    return withPlugins(config, [
        withWakeUpFiles,
        withWakeUpManifest,
        withWakeUpGradle,
        withWakeUpMainApplication,
    ]);
};

module.exports = withWakeUp;
