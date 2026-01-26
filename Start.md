On Cloud
eas build --platform android --profile preview --clear-cache

For LocalHost
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease

 APK LOCATION
android/app/build/outputs/apk/release/app-release.apk

npx expo prebuild --clean
npx expo prebuild --platform android

Excellent! The build is working now. Here's what you need to know about making changes going forward:

For Normal App Code Changes
When you modify your app code (files in app/, components/, context/, etc.):

Just rebuild:
powershell
cd C:\Apps\Eyeconic\android
./gradlew assembleRelease
The APK will be generated at:
C:\Apps\Eyeconic\android\app\build\outputs\apk\release\app-release.apk
⚠️ IMPORTANT: About the Fixes I Made
I had to modify files in node_modules/ to fix the build:

node_modules/expo-linear-gradient/android/build.gradle
node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle
These changes will be lost if you:

Run npm install or npm ci
Run npx expo prebuild --clean
Delete and reinstall node_modules
To Preserve the Fixes
Option 1: Use patch-package (Recommended)

powershell
# Install patch-package
npm install --save-dev patch-package
# Create patches for the modified packages
npx patch-package expo-linear-gradient
npx patch-package expo-modules-core
# Add to package.json scripts
Then add this to your 
package.json
 scripts section:

json
"postinstall": "patch-package"
Option 2: Avoid prebuild --clean

Don't run npx expo prebuild --clean unless absolutely necessary
If you must run it, manually reapply the fixes afterward
Quick Reference
Build release APK:

powershell
cd android
./gradlew assembleRelease
Clean build:

powershell
./gradlew clean assembleRelease
Find your APK:

android\app\build\outputs\apk\release\app-release.apk
Would you like me to set up patch-package for you to automatically preserve these fixes?