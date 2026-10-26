# 0199 原生壳打包（Git）

WebView 原生壳，按入口分两个包：

| 包 | 打开地址 | Android 包名 | iOS Bundle ID |
|----|----------|--------------|---------------|
| **app0199**（0199彩票） | `https://cs.ojy0871.com/_m/0199w/` | `com.ojy0871.app0199` | `com.ojy0871.app0199` |
| **seat0199**（0199客服 / 坐席 eddqc） | `https://cs.ojy0871.com/c/0199cai/?a=eddqc` | `com.ojy0871.seat0199` | `com.ojy0871.seat0199` |

## 用 Git 环境打包（推荐）

在已配置 Android SDK 的 Cloud Agent / 本地环境，从仓库源码编译 APK 并归档：

```bash
export ANDROID_HOME=/tmp/android-sdk   # 按实际 SDK 路径修改
bash online-cs/deploy/mobile/scripts/env-pack.sh
```

## 仅 Git 源码归档

在仓库根目录执行：

```bash
bash online-cs/deploy/mobile/scripts/git-pack.sh
```

会在 `online-cs/deploy/mobile/dist/` 生成：

- `app0199-android-src.zip` / `seat0199-android-src.zip`
- `App0199-ios-src.zip` / `Seat0199-ios-src.zip`
- `mobile-0199-all.zip`（整包）

也可手动：

```bash
git archive --format=zip HEAD:online-cs/deploy/mobile -o mobile-0199-all.zip
```

克隆仓库后，GitHub / Origin 网页上也可 **Code → Download ZIP**。

## 已打好的 Android APK

见 `dist/`：

- `app0199-release.apk`
- `seat0199-release.apk`

签名密钥同目录（更新请用同一 keystore）：

- `app0199.keystore` — alias `app0199`，密码 `app0199store`
- `seat0199.keystore` — alias `seat0199`，密码 `seat0199store`

## 本地重打 APK

```bash
cd online-cs/deploy/mobile/android/app0199   # 或 seat0199
# 写入 SDK 路径
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleRelease
```

产物：`app/build/outputs/apk/release/app-release.apk`

## iOS IPA

本环境是 Linux，**无法产出已签名 IPA**。请用 Mac + Xcode：

1. 打开 `ios/App0199/App0199/App0199.xcodeproj` 或 `ios/Seat0199/Seat0199/Seat0199.xcodeproj`
2. 选择 Apple Team → Product → Archive → 导出 IPA
