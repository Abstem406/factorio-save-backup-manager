# Factorio Backup Manager 🚀

A interactive CLI tool created with **Bun** to monitor and automatically back up your Factorio save files to the cloud.

## ✨ Features

- **Multi-Cloud Support**:
  - **Rootz.so**: High-speed, anonymous uploads with parallel chunking.
  - **Buzzheavier**: Support for both Anonymous and Authenticated modes.
- **Discord Notifications**: Get instant alerts with download links in your Discord channel via Webhooks.
- **Interactive Configuration**: Easy setup menu to configure services, intervals, and notifications.
- **Smart Monitoring**: Detects changes in your latest save file and uploads only when necessary.
- **On-the-fly Control**:
  - Press `ENTER` to force an immediate check.
  - Press `c` to reconfigure settings without restarting.
  - Press "u" to select a file manually for upload.
- **Standalone Binaries**: No dependencies required to run.

## 📥 Download

You can find the latest standalone binaries for **Windows** and **Linux** in the [Releases](https://github.com/Abstem406/factorio-save-backup-manager/releases) page.

1. Download the version for your OS.
2. Run the executable.
3. Follow the interactive setup.

## 🚀 How to Use

### Using the Binary
1. Open your terminal/command prompt.
2. Run the downloaded file:
   - **Linux**: `./factorio-backup-linux`
   - **Windows**: `factorio-backup-win.exe`
3. The first time you run it, it will guide you through the configuration.

### Running from Source
If you have [Bun](https://bun.sh) installed:
```bash
# Install dependencies
bun install

# Run the script
bun backup-factorio.js
```

## 🛠️ Compilation

To generate your own standalone binaries:

```bash
# Build for Windows (.exe)
bun run build:win

# Build for Linux
bun run build:linux
```
> [!NOTE]
> **Custom Icon**: To compile the Windows version with a custom icon, you must run the build command on a Windows machine due to a Bun limitation:
> ```bash
> bun run build:win:icon
> ```

The output will be generated in the `dist/` directory.

## 📁 Project Structure
- `backup-factorio.js`: Main orchestration logic.
- `config-manager.js`: Path detection and setup menu.
- `services/`: Specific logic for Rootz, Buzzheavier, and Discord.

---
*Factory must grow, but backups must be safe.* xDDDD
