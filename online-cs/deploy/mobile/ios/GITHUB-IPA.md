# 用 GitHub Actions 打包苹果 IPA

可以。GitHub 托管的 **macOS runner**（`macos-14`）能跑 Xcode，导出可安装 IPA。  
**前提：** 仓库 Secrets 里放好 Apple 签名材料；没有证书只能编译，打不出可装设备的 IPA。

## 1. 推到 GitHub

把本仓库推到你的 GitHub（例如 `ethada88-cell`），并确认包含：

- `online-cs/deploy/mobile/ios/`
- `.github/workflows/ios-ipa.yml`

## 2. 配置 Secrets（Settings → Secrets and variables → Actions）

| Secret | 说明 |
|--------|------|
| `IOS_CERTIFICATE_P12_BASE64` | 发布证书 `.p12` 的 base64（`base64 -i cert.p12 \| pbcopy`） |
| `IOS_CERTIFICATE_PASSWORD` | 该 p12 密码 |
| `IOS_PROVISION_PROFILE_BASE64` | `.mobileprovision` 的 base64 |
| `IOS_TEAM_ID` | Apple Team ID（10 位） |
| `KEYCHAIN_PASSWORD` | 临时钥匙串密码（可自定一串随机字符） |

生成 base64（macOS）：

```bash
base64 -i YourCert.p12 | pbcopy
base64 -i YourProfile.mobileprovision | pbcopy
```

证书类型需与导出方式匹配：

- **development** → iOS Development 证书 + Development 描述文件  
- **ad-hoc** → Apple Distribution / iOS Distribution + Ad Hoc 描述文件  

Bundle ID 须与描述文件一致：

- App0199：`com.ojy0871.app0199`
- Seat0199：`com.ojy0871.seat0199`

若两个 App 描述文件不同，可先只打一个；或拆成两套 Secret（当前工作流共用一套 profile，一次跑一个 app）。

## 3. 触发构建

GitHub → **Actions** → **Build iOS IPA** → **Run workflow**

- `app`：`app0199` / `seat0199` / `both`
- `export_method`：`ad-hoc` 或 `development`

结束后在该 run 的 **Artifacts** 下载 `.ipa`。

## 4. 安装

- Ad Hoc：设备 UDID 须写进描述文件，用 Apple Configurator / 爱思助手等安装  
- Development：仅开发设备  
- 上架 App Store：需另改 `export_method` 为 `app-store` 并准备对应证书（当前模板未默认开启）

## 本地对照命令

```bash
# 仅在 Mac 上
cd online-cs/deploy/mobile/ios/App0199/App0199
xcodebuild -scheme App0199 -configuration Release \
  -archivePath /tmp/App0199.xcarchive archive
xcodebuild -exportArchive \
  -archivePath /tmp/App0199.xcarchive \
  -exportPath /tmp/App0199-ipa \
  -exportOptionsPlist ../../exportOptions.ad-hoc.plist
```
