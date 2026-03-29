# Eyeconic Mentorship - Play Store Deployment Guide

This guide provides step-by-step instructions for deploying your app to the Google Play Store and handling future updates.

## Phase 1: Preparation (Required Actions)

### 1. Google Play Console Account
- Go to [Google Play Console](https://play.google.com/console/signup).
- Register for a Developer Account (requires a one-time $25 US registration fee).

### 2. Assets Checklist
You will need the following for the store listing:
- **App Icon**: 512x512 PNG (32-bit with alpha).
- **Feature Graphic**: 1024x500 PNG or JPEG.
- **Screenshots**: At least 2-4 screenshots of the app running (use the `npm run dev` and take screenshots on a phone or emulator).
- **Store Description**: A short and full description highlighting your mentorship features.

### 3. Firebase Configuration
Since we changed the package name to `com.eyeconicbydrlalla.mentorship`, you **must** update your Firebase configuration:
- Generate a new `google-services.json` from the Firebase Console.
- Replace the old file in the project's root folder.

---

## Phase 2: Building the App

We use **EAS (Expo Application Services)** to handle the build process, which ensures the app is signed correctly for the Play Store.

### Step 1: Install EAS CLI
If you haven't already:
```bash
npm install -g eas-cli
```

### Step 2: Login to Expo
```bash
eas login
```

### Step 3: Start the Production Build
This will generate an **AAB (Android App Bundle)**, which is the preferred format for the Play Store:
```bash
eas build --platform android --profile production
```
- During this process, EAS will ask if you want it to handle your **Android Keystore**. Select **Yes** (to let Expo manage your signing keys safely).

---

## Phase 3: Submitting to the Play Store

### 1. Initial Upload
- Once the build finishes, EAS will provide a download link for the `.aab` file.
- Upload this file to the **Internal Testing** or **Production** track in your Google Play Console.

### 2. Complete the App Review
Fill out all the required forms in the console, including:
- **Privacy Policy URL** (You can host this on your website).
- **Content Rating** (survey about the app content).
- **Target Audience** (mostly 18+ for NEET PG).

---

## Phase 4: How to Give Updates

### Option 1: OTA Updates (Over-the-Air)
For changes in your JavaScript code (UI fixes, logic updates), you can push updates **instantly** without users downloading a new APK and without Play Store review:
```bash
npx expo export
eas update --auto
```
*Users will receive the update automatically next time they open the app.*

### Option 2: Binary Updates (New Play Store Version)
If you change your `app.json` (version numbers, package name, native permissions) or update Expo versions:
1.  **Increment** the `version` and `versionCode` in `app.json`.
2.  Run the build command again: `eas build --platform android --profile production`.
3.  Upload the new AAB to the Play Store and submit for review.

---

## Technical Support
If you encounter errors during the build process:
- Run `eas build:check` to verify your configuration.
- Check standard logs in the EAS dashboard.
