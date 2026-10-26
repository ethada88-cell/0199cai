# 用 GitHub Actions 打包苹果 IPA

## 企业签（无证书，推荐你这种用法）

GitHub 只负责打出 **未签名 IPA**，你再用平时的企业签工具重签安装。

1. 打开：https://github.com/ethada88-cell/0199cai/actions/workflows/ios-ipa.yml
2. **Run workflow**
   - **Which shell to build**：`seat0199`（坐席）或 `app0199`
   - **IPA export method**：选 **`unsigned`**
3. 等跑完 → Artifacts 下载 `Seat0199-unsigned-ipa`
4. 把下载的 `.ipa` 丢进你的企业签平台重签即可

不需要配置任何 Apple Secrets。

## 自有证书签名（ad-hoc / development）

若不用企业签、要用自己的 Apple 证书：

| Secret | 说明 |
|--------|------|
| `IOS_CERTIFICATE_P12_BASE64` | `.p12` 的 base64 |
| `IOS_CERTIFICATE_PASSWORD` | p12 密码 |
| `IOS_PROVISION_PROFILE_BASE64` | `.mobileprovision` 的 base64 |
| `IOS_TEAM_ID` | Team ID |
| `KEYCHAIN_PASSWORD` | 任意随机串 |

export_method 选 `ad-hoc` 或 `development`。

## Bundle ID

- App0199：`com.ojy0871.app0199`（0199彩票 / `_m/0199w`）
- Seat0199：`com.ojy0871.seat0199`（全座席 / `0199cai/?a={代号}`）
