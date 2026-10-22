# 薪澈

薪澈读取个人 Excel 工资表和工资单图片，在本机识别并分析应发、扣款和实发金额，提供个人薪资、花销记录及月度预算。界面采用石墨蓝、雾青与柔金配色，支持跟随系统或手动切换深浅主题。

## Project review

The original project is a Node.js/Express web app packaged as a Windows executable with `pkg`. It has no Android application or APK build configuration. The page also loaded Excel, chart, and icon libraries from public CDNs, so a WebView wrapper would not work reliably offline. Payroll records were stored by the Node server under the Windows user profile, which is not available to an Android app.

This iteration adds a Capacitor Android app, bundles the web libraries with the app, and stores records in the device's IndexedDB. Existing records served by the desktop app are imported into IndexedDB on first load. APK records stay on that device and are not synchronized with the desktop app or cloud. The Android launcher name is **薪澈**, its application ID is `com.wwhooo.Skye.RayRoll`, and the current preview APK is `1.3.0` (version code `4`). The launcher, app header and splash screens use a minimalist prism-and-R mark based on the first APK icon. The project is licensed under MIT; see `LICENSE` and the in-app third-party notices. The package remains private to npm.

## Build an Android APK

Install Node.js 20 or later, JDK 21, and Android SDK Platform 36 with Android Build Tools. Accept the Android SDK licenses in the local SDK installation, then run these commands in this directory:

```powershell
npm install
npm run android:init
npm run android:apk
```

The preview debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. It is signed with the local Android debug key and is for evaluation; public stable distribution requires a separately managed release signing key. After the Android project has been initialized once, use `npm run android:apk` for subsequent builds. Android Studio can open the project with `npm run android:debug`.

To build a release APK, configure a signing key in the Android Gradle project and run `npm run android:apk:release`.

## Desktop app

The Windows executable build remains available with `npm run package`. Start the development server with `npm start`.

## Windows local test

No phone is needed to review the mobile layout or recognition flows. Start the app in PowerShell from this project directory:

```powershell
npm.cmd install
npm.cmd run prepare:web
npm.cmd start
```

Open `http://localhost:3000` in Microsoft Edge. Use Edge DevTools' device toolbar and set the viewport to 480 × 1050 to review the large-screen phone layout. The desktop UI check script can exercise the page through Edge's remote debugging endpoint (`9222`):

```powershell
node scripts/check-local-ui.js
```

It checks 320 px and 480 px mobile viewports, local assets, Chinese OCR with labels and values on separate lines and a cross-month pay period, Excel parsing across multiple worksheets and repeated or changed table blocks, date precedence, non-person note rows, and recovery after a malformed workbook. OCR locally enlarges small images and caps oversized images while leaving clear, normal-sized images untouched. OCR language data and JavaScript dependencies are bundled locally by `prepare:web`; images and spreadsheet contents are processed in the browser and saved records stay in local IndexedDB.

Excel import scans every worksheet for one or more payroll table blocks, including repeated headers and different tables on the same sheet. It recognizes common Chinese/English payroll labels, dates and month columns, and keeps clearly named company-specific income and deduction columns for review. Month selection prefers an explicit payroll month, then the end or start of the pay period, then pay date, and finally the file or sheet title. OCR accepts labels and values on the same or adjacent lines and uses the same month priority. Deduction amounts are normalized to positive values. When several records match the selected person and month, expense reconciliation uses the most recently saved salary record. The review screen shows detected pay items before saving; unusual layouts and low-quality images still need manual review.

## Rights and privacy

Review `COMPLIANCE_REVIEW.md` before distributing a build. The product name **薪澈** is a working name and has not received trademark clearance or final user confirmation. The app includes a local privacy summary and third-party license notices under Settings; complete publisher contact details and a jurisdiction-specific review before public release.
