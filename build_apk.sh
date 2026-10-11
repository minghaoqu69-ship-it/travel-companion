#!/bin/bash
# 构建 Android APK（debug）
# 用法：bash build_apk.sh
# 依赖：Android SDK（ANDROID_HOME）、JDK 17、Gradle 8.x
set -e

# 定位到脚本所在目录，避免依赖绝对路径
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 如本机路径不同，可在执行前 export 覆盖，例如：
#   export ANDROID_HOME=$HOME/Android/Sdk
#   export GRADLE_BIN=/opt/gradle-8.9/bin/gradle
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export GRADLE_OPTS="-Xmx2g"
export GRADLE_BIN="${GRADLE_BIN:-gradle}"

# 同步最新 H5 资源到 assets
mkdir -p "$ROOT/android/app/src/main/assets"
cp "$ROOT"/webapp/index.html "$ROOT"/webapp/app.js "$ROOT"/webapp/styles.css \
   "$ROOT"/android/app/src/main/assets/

cd "$ROOT/android"
echo "== 开始构建 debug APK =="
"$GRADLE_BIN" assembleDebug --no-daemon --stacktrace
echo "BUILD_EXIT=$?"
echo "== 产物 =="
ls -la app/build/outputs/apk/debug/ 2>/dev/null
