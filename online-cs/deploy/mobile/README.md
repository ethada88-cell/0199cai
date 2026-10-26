# 0199 原生 App 打包（Git）

| 包 | 说明 | Android 包名 | iOS Bundle ID |
|----|------|--------------|---------------|
| **seat0199**（0199客服） | **原生访客端**：内置 100 座席代号，原生聊天 UI + API/WebSocket，**无 WebView** | `com.ojy0871.seat0199` | `com.ojy0871.seat0199` |
| **app0199**（0199彩票） | 仍为 WebView 壳，打开 `_m/0199w/` | `com.ojy0871.app0199` | `com.ojy0871.app0199` |

Seat0199 内置 `assets/seats.json` / iOS `seats.json`（100 个 `name` + `code`）。

## 用 Git 环境打包（推荐）

```bash
export ANDROID_HOME=/tmp/android-sdk
bash online-cs/deploy/mobile/scripts/env-pack.sh
```

## 本地重打 Seat0199 APK

```bash
cd online-cs/deploy/mobile/android/seat0199
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleRelease
```

产物：`app/build/outputs/apk/release/app-release.apk`

签名：`seat0199.keystore`，alias `app0199`，密码 `app0199store`。

## iOS IPA

本环境为 Linux，本地无法出已签名 IPA。用 GitHub Actions 企业签 / 未签名导出，见 `ios/GITHUB-IPA.md`。
