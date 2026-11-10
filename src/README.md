# 速驱智控安卓工程

独立安装标识为 `cn.suqu.smartcontrol`。采用 Vue3／uni-app 本地页面和安卓 Java 蓝牙桥接，参考程序只读，新应用沿用其桌面原图标，使用独立签名。

## 检查与构建

在本目录执行：

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run test:package
```

构建需要 JDK17、安卓 Platform35 和 Build Tools35。默认使用本机已存在的 `%LOCALAPPDATA%\REA-Android-Tools`，可用 `SUQU_ANDROID_TOOLS` 指定；网页编译器优先本目录依赖，可用 `SUQU_NODE_MODULES` 指向同版本依赖目录。

正式产物位于 `dist/速驱智控-1.0.0.apk`，对应 JSON 包含签名核验和文件校验值。`private/` 中的密钥和凭据不得删除、覆盖或提交；后续覆盖安装应沿用同一签名。构建输出、依赖、密钥和本机截图均已忽略，不进入代码提交。

## 开发约定

通过公开应用操作测试真实会话路径，仅在原生系统、时间和文件等边界替换外部能力。每项 issue 按红、绿、复核、记录、提交推送顺序推进。

代码修改标记从 `//20261110-0` 开始按实施 issue 递增。函数注释使用英文；C 的 `u8/u16/u32` 规则适用于 C，Java／JavaScript 使用其合法语言类型，蓝牙数据在平台边界以字节值传输。

当前阶段的功能及验证范围以根目录程序修改记录和本地 issues 进度为准；没有实机证据的项目不宣称已通过真实蓝牙验证。
