#!/usr/bin/env bash

# ============================================================
# Android Emulator Setup for Linux (Arch / Pacman)
# ============================================================
set -euo pipefail
IFS=$'\n\t'

# --- Preconfigured Image Template URL ---
readonly TEMPLATE_URL="https://github.com/ImDuck42/random/releases/download/emu/master_userdata.img.gz"

# --- AVD identity ---
readonly AVD_NAME="android_desktop_emu"
readonly SDK_DIR="/opt/android-sdk"
readonly DEVICE_SERIAL="emulator-5554"

# --- Hardware specs ---
readonly RAM_SIZE_MB=16384 # 16 GB RAM
readonly CPU_CORES=4       # 4 CPU cores
readonly DISK_SIZE="30G"   # 30 GB storage
readonly RESOLUTION="1920x1080"

# --- Android SDK paths ---
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$PATH:$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/tools/bin:$SDK_DIR/platform-tools:$SDK_DIR/emulator"

# --- Audio buffer tuning for PipeWire / PulseAudio ---
export QEMU_AUDIO_DRV=pa
export PULSE_LATENCY_MSEC=60
export QEMU_PA_SAMPLES=2048

# --- Terminal colors ---
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

readonly AVD_DIR="$HOME/.android/avd/${AVD_NAME}.avd"
readonly CONFIG_FILE="$AVD_DIR/config.ini"
readonly LOG_FILE="$HOME/.android/emulator.log"

logInfo()  { echo -e "${GREEN}[*] $*${NC}";  }
logWarn()  { echo -e "${YELLOW}[!] $*${NC}"; }
logError() { echo -e "${RED}[!] $*${NC}";    }
logNote()  { echo -e "${CYAN}[i] $*${NC}";   }

# ============================================================
# HELPERS
# ============================================================
setConfigValue() {
  local key="$1"
  local value="$2"
  if [ -f "$CONFIG_FILE" ] && grep -q "^${key}=" "$CONFIG_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$CONFIG_FILE"
  else
    echo "${key}=${value}" >> "$CONFIG_FILE"
  fi
}

detectQtPlatform() {
  if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
    echo "wayland"
  else
    echo "xcb"
  fi
}

checkCpuGovernor() {
  local governorFile="/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"
  if [ -r "$governorFile" ]; then
    local governor
    governor="$(cat "$governorFile")"
    if [ "$governor" != "performance" ]; then
      logNote "CPU governor is '$governor'. For smoother UI/audio, consider: sudo cpupower frequency-set -g performance"
    fi
  fi
}

# ============================================================
# SETUP
# ============================================================
setupEnv() {
  logInfo "Starting Android Emulator Setup..."

  if ! command -v pacman >/dev/null 2>&1; then
    logError "'pacman' not found. This script is designed exclusively for Arch Linux / Pacman-based distros."
    exit 1
  fi

  logWarn "[1/7] Installing dependencies via pacman..."
  sudo pacman -Sy --needed qemu-full android-sdk-cmdline-tools-latest vulkan-tools

  if ! groups "$USER" | grep -q '\bkvm\b'; then
    logWarn "Adding $USER to kvm group..."
    sudo usermod -aG kvm "$USER"
  fi

  logWarn "[2/7] Preparing $SDK_DIR directory..."
  sudo mkdir -p "$SDK_DIR"
  sudo chown -R "$USER:$USER" "$SDK_DIR"

  logWarn "[3/7] Accepting Android SDK licenses..."
  yes | sdkmanager --licenses >/dev/null 2>&1 || true

  logWarn "[4/7] Downloading SDK components (Android 34 with Play Store)..."
  android sdk install      \
    "platform-tools"       \
    "emulator"             \
    "build-tools;34.0.0"   \
    "platforms;android-34" \
    "system-images;android-34;google_apis_playstore;x86_64"

  logWarn "[5/7] Creating Android Virtual Device (AVD)..."
  logNote "You may see a 'Could not load devices from... devices.xml' error below."
  logNote "This is a known bug in Google's system image and is completely harmless. Ignoring..."

  echo "no" | avdmanager create avd                            \
    -k "system-images;android-34;google_apis_playstore;x86_64" \
    -n "$AVD_NAME"                                             \
    --force

  logWarn "[6/7] Downloading preconfigured userdata template from GitHub..."
  local tmpArchive="/tmp/master_userdata.img.gz"

  if curl -L --progress-bar "$TEMPLATE_URL" -o "$tmpArchive"; then
    logNote "Decompressing and applying userdata template..."
    gunzip -c "$tmpArchive" > "$AVD_DIR/userdata-qemu.img"
    rm -f "$tmpArchive"
    logInfo "Template successfully downloaded and applied!"
  else
    logError "Failed to download template from GitHub. Falling back to default blank state."
    rm -f "$tmpArchive"
  fi

  logWarn "[7/7] Applying configuration tweaks (hardware + audio)..."

  setConfigValue "hw.ramSize"              "$RAM_SIZE_MB"
  setConfigValue "hw.cpu.ncore"            "$CPU_CORES"
  setConfigValue "hw.keyboard"             "yes"
  setConfigValue "disk.dataPartition.size" "$DISK_SIZE"
  setConfigValue "window.fullscreen"       "no"
  setConfigValue "skin.name"               "$RESOLUTION"
  setConfigValue "hw.initialOrientation"   "landscape"
  setConfigValue "hw.audioOutput"          "yes"
  setConfigValue "hw.audioInput"           "yes"

  logInfo "Setup complete!"
  echo -e "You can now run: ${YELLOW}./emu.sh start${NC}"
}

# ============================================================
# START
# ============================================================
startEmu() {
  logInfo "Starting Android Emulator..."

  local emuBin="$SDK_DIR/emulator/emulator"
  if [ ! -f "$emuBin" ]; then
    logError "Emulator binary not found. Did you run setup first?"
    exit 1
  fi

  checkCpuGovernor

  if [ -f "$CONFIG_FILE" ]; then
    sed -i 's/hw.audioOutput=true/hw.audioOutput=yes/g' "$CONFIG_FILE" || true
    sed -i 's/hw.audioInput=true/hw.audioInput=yes/g'   "$CONFIG_FILE" || true
    if ! grep -q "hw.audioOutput=yes" "$CONFIG_FILE"; then
      echo "hw.audioOutput=yes" >> "$CONFIG_FILE"
      echo "hw.audioInput=yes"  >> "$CONFIG_FILE"
    fi
  fi

  # Global state variables for cleanup handler
  origTimeout=""
  suspendModuleIds=""
  emuPid=""

  # Temporarily disable GNOME's "App Not Responding" popup
  if command -v gsettings >/dev/null 2>&1; then
    local rawVal
    rawVal=$(gsettings get org.gnome.mutter check-alive-timeout 2>/dev/null | awk '{print $NF}' | tr -dc '0-9')
    if [ -z "$rawVal" ] || [ "$rawVal" -gt 60000 ] 2>/dev/null; then
      origTimeout="5000"
    else
      origTimeout="$rawVal"
    fi
    gsettings set org.gnome.mutter check-alive-timeout 0 2>/dev/null || true
    logNote "Temporarily disabled GNOME 'App Not Responding' popups."
  fi

  if command -v pactl >/dev/null 2>&1; then
    suspendModuleIds="$(pactl list short modules 2>/dev/null | awk '/module-suspend-on-idle/ {print $1}')" || true
    if [ -n "$suspendModuleIds" ]; then
      for moduleId in $suspendModuleIds; do
        pactl unload-module "$moduleId" 2>/dev/null || true
      done
      logNote "Disabled audio suspend-on-idle for this session to prevent wake-up stutter."
    fi
  fi

  # Shutdown handler for Ctrl+C or process exit
  cleanupOnExit() {
    trap - EXIT INT TERM
    echo -e "\n${YELLOW}[*] Shutting down Android Emulator...${NC}"

    if [ -n "${emuPid:-}" ]; then
      adb -s "$DEVICE_SERIAL" emu kill >/dev/null 2>&1 || kill "$emuPid" >/dev/null 2>&1 || true
    else
      adb -s "$DEVICE_SERIAL" emu kill >/dev/null 2>&1 || true
    fi

    if [ -n "${origTimeout:-}" ]; then
      logNote "Restoring GNOME 'check-alive-timeout' back to original value ($origTimeout)..."
      gsettings set org.gnome.mutter check-alive-timeout "$origTimeout" 2>/dev/null || true
    fi

    if command -v pactl >/dev/null 2>&1 && [ -n "${suspendModuleIds:-}" ]; then
      pactl load-module module-suspend-on-idle >/dev/null 2>&1 || true
    fi
  }
  trap cleanupOnExit EXIT INT TERM

  mkdir -p "$HOME/.android"

  launchEmulator() {
    local qtPlatform="$1"
    QT_QPA_PLATFORM="$qtPlatform" "$emuBin" @"$AVD_NAME" \
      -gpu host                                          \
      -no-snapshot                                       \
      -no-boot-anim                                      \
      -fixed-scale                                       \
      -accel on                                          \
      -audio pa                                          \
      -prop aaudio.mmap_policy=0                         \
      -prop aaudio.mmap_exclusive_policy=0               \
      -prop audio.offload.disable=1                      \
      -prop audio.deep_buffer.media=0                    \
      -qemu -cpu host                                    \
      >"$LOG_FILE" 2>&1 &
    emuPid=$!
  }

  local qtPlatform
  qtPlatform="$(detectQtPlatform)"
  logNote "Launching Qt UI on '$qtPlatform' backend..."
  launchEmulator "$qtPlatform"

  sleep 2
  if ! kill -0 "$emuPid" 2>/dev/null; then
    logWarn "UI failed to start on '$qtPlatform', falling back to 'xcb'..."
    launchEmulator "xcb"
  fi

  logWarn "Waiting for emulator device to connect..."
  adb wait-for-device

  logWarn "Waiting for Android boot to complete (this may take a minute on first boot)..."
  while [[ "$(adb -s "$DEVICE_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; do
    sleep 2
  done

  if command -v ionice >/dev/null 2>&1; then
    ionice -c 2 -n 0 -p "$emuPid" 2>/dev/null || true
  fi

  logInfo "Android successfully booted!"
  logInfo "Emulator running (PID $emuPid). Press Ctrl+C in this terminal to close it."

  wait "$emuPid" 2>/dev/null || true
}

# ============================================================
# STATUS
# ============================================================
statusEmu() {
  if adb devices | grep -q "^${DEVICE_SERIAL}[[:space:]]"; then
    logInfo "Emulator is running ($DEVICE_SERIAL)."
  else
    logWarn "Emulator is not running."
  fi
}

# ============================================================
# CLEAN
# ============================================================
cleanEnv() {
  logError "Warning: this will completely delete the Android AVD, the Android SDK, and uninstall packages."
  read -p "Are you sure you want to proceed? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cleanup aborted."
    exit 1
  fi

  logWarn "[1/4] Deleting AVD files..."
  rm -rf "$AVD_DIR"
  rm -f "$HOME/.android/avd/${AVD_NAME}.ini"

  logWarn "[2/4] Removing SDK directory ($SDK_DIR)..."
  sudo rm -rf "$SDK_DIR"
  rm -rf "$HOME/Android"
  rm -rf "$HOME/.android"

  logWarn "[3/4] Uninstalling installed packages via pacman..."
  local targetPackages=("android-sdk-cmdline-tools-latest" "qemu-full" "vulkan-tools")
  local toRemove=()

  for package in "${targetPackages[@]}"; do
    if pacman -Qq "$package" >/dev/null 2>&1; then
      toRemove+=("$package")
    fi
  done

  if [ ${#toRemove[@]} -gt 0 ]; then
    logNote "Uninstalling: ${toRemove[*]}"
    sudo pacman -Rns --noconfirm "${toRemove[@]}"
  else
    logNote "None of the target packages are currently installed. Skipping pacman removal."
  fi

  logWarn "[4/4] Removing user from kvm group..."
  sudo gpasswd -d "$USER" kvm >/dev/null 2>&1 || true

  logInfo "Cleanup complete. All traces of the emulator have been removed."
}

# ============================================================
# MAIN MENU ROUTER
# ============================================================
case "${1:-}" in
  setup)
    setupEnv
    ;;
  start)
    startEmu
    ;;
  status)
    statusEmu
    ;;
  clean)
    cleanEnv
    ;;
  *)
    echo -e "${GREEN}Android Emulator Manager for Linux${NC}"
    echo "Usage: $0 {setup|start|status|clean}"
    echo ""
    echo "  setup : Installs dependencies via pacman, sets up SDK, and creates the VM."
    echo "  start : Boots the VM in Tablet Mode."
    echo "  status: Reports whether the emulator is currently running."
    echo "  clean : Deletes the VM, removes the SDK files, and uninstalls packages."
    exit 1
    ;;
esac