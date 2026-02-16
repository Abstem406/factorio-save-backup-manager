// backup-factorio.js
// Run with: bun backup-factorio.js
import { promises as fs, statSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSavePath, loadConfig, saveConfig, runInteractiveSetup, configureCloudService, configureBuzzAccount, configureDiscordBot } from './config-manager.js';
import { select, input, number } from '@inquirer/prompts';

// Explicit imports
import { upload as uploadToBuzzheavier } from './services/buzzheavier.js';
import { upload as uploadToRootz } from './services/rootz.js';
import { sendNotification, getLatestBackupUrl } from './services/discord.js';
import { resolveDirectLink } from './services/resolver.js';

// Global service endpoints (API keys are now dynamic in config)
const SERVICES_CONSTANTS = {
    buzzheavier: {
        endpoint: 'https://w.buzzheavier.com'
    },
    rootz: {
        endpoint: 'https://www.rootz.so',
        multipartThreshold: 4 * 1024 * 1024 // 4MB
    }
};

class FactorioBackup {
    constructor(config) {
        this.config = config;
        this.savePath = getSavePath();
        this.lastHash = null;
        this.startTime = Date.now();
        this.lastCheckTime = Date.now();
        this.lastLink = 'No backups yet';
        this.lastLinkDate = 'N/A';
        this.logFile = path.join(process.cwd(), 'factorio-backup.log');
    }

    async logToFile(message) {
        const timestamp = new Date().toLocaleString();
        const logMessage = `[${timestamp}] ${message}\n`;
        try {
            await fs.appendFile(this.logFile, logMessage);
        } catch (err) {
            // Silently fail if log file can't be written
        }
    }

    formatBackupName(originalName) {
        const timestamp = new Date().toISOString()
            .replace(/T/, '_')      // Replace T with _
            .replace(/\..+/, '')   // Remove milliseconds
            .replace(/:/g, '')     // Remove colons
            .replace(/-/g, '');    // Remove dashes

        let baseName = originalName.replace(/\.zip$/i, '');

        // Remove existing timestamp pattern (_YYYYMMDD_HHMMSS)
        baseName = baseName.replace(/_\d{8}_\d{6}$/, '');

        const prefixStr = this.config.backupPrefix ? this.config.backupPrefix.replace(/[^a-zA-Z0-9_-]/g, '_') : '';

        // Remove ANY existing prefix (anything before the first underscore if it's not part of the original name)
        // Note: Factorio saves usually don't start with "Prefix_", but we'll be targeted:
        // If there's an underscore and the part before it isn't an "autosave" or similar common save pattern
        const parts = baseName.split('_');
        if (parts.length > 1 && !baseName.startsWith('_autosave')) {
            // If the first part looks like a generated prefix (alphanumeric/dashes/underscores)
            // and we have more parts, we strip it.
            baseName = parts.slice(1).join('_');
        }

        const finalPrefix = prefixStr ? prefixStr + '_' : '';
        return `${finalPrefix}${baseName}_${timestamp}.zip`;
    }

    async getLatestSave() {
        const saveDir = this.savePath;
        try {
            const files = await fs.readdir(saveDir);
            const saveFiles = files.filter(f => f.endsWith('.zip')).filter(f => {
                const mtime = statSync(path.join(saveDir, f)).mtime.getTime();
                return mtime >= this.startTime;
            }).sort((a, b) => {
                return statSync(path.join(saveDir, b)).mtime.getTime() -
                    statSync(path.join(saveDir, a)).mtime.getTime();
            });

            if (saveFiles.length > 0) {
                return {
                    path: path.join(saveDir, saveFiles[0]),
                    name: saveFiles[0]
                };
            }
        } catch (error) {
            console.error(`Error reading save directory ${saveDir}:`, error.message);
        }
        return null;
    }

    async calculateHash(filePath) {
        try {
            const file = Bun.file(filePath);
            const arrayBuffer = await file.arrayBuffer();
            return crypto.createHash('md5').update(new Uint8Array(arrayBuffer)).digest('hex');
        } catch (e) {
            const fileBuffer = await fs.readFile(filePath);
            return crypto.createHash('md5').update(fileBuffer).digest('hex');
        }
    }

    async uploadToCloud(filePath, fileName) {
        if (this.config.cloudService === 'rootz') {
            const rootzConfig = {
                ...SERVICES_CONSTANTS.rootz,
                ...this.config.rootz // Merge user config if any
            };
            console.log(`Uploading ${fileName} to Rootz.so...`);
            return await uploadToRootz(filePath, fileName, rootzConfig);

        } else if (this.config.cloudService === 'buzzheavier') {
            const buzzConfig = {
                ...SERVICES_CONSTANTS.buzzheavier,
                ...this.config.buzzheavier
            };

            if (!buzzConfig.anonymous && !buzzConfig.accountId) {
                console.error('Error: Buzzheavier Account ID is missing in config.');
                return;
            }

            console.log(`Uploading ${fileName} to Buzzheavier...`);
            return await uploadToBuzzheavier(filePath, fileName, buzzConfig);
        } else {
            console.warn(`Service ${this.config.cloudService} not implemented or supported.`);
        }
    }

    async checkForChanges() {
        try {
            const save = await this.getLatestSave();
            if (!save) return;

            const currentHash = await this.calculateHash(save.path);

            if (this.lastHash !== currentHash) {
                this.logToFile(`Change detected in: ${save.name}`);
                const formattedName = this.formatBackupName(save.name);
                const downloadUrl = await this.uploadToCloud(save.path, formattedName);

                if (downloadUrl) {
                    this.lastLink = downloadUrl;
                    this.lastLinkDate = new Date().toLocaleString();
                    this.logToFile(`Upload success: ${downloadUrl}`);

                    if (this.config.discordWebhook) {
                        await sendNotification(
                            this.config.discordWebhook,
                            formattedName,
                            downloadUrl,
                            this.config.cloudService.charAt(0).toUpperCase() + this.config.cloudService.slice(1)
                        );
                        this.logToFile(`Discord notification sent.`);
                    }
                }

                this.lastHash = currentHash;
            } else {
                console.log('No changes detected (Manual check).');
            }
        } catch (error) {
            console.error('Error:', error.message);
        }
    }

    async monitor() {
        const readline = await import('readline');
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);

        const startAutoBackup = () => {
            if (this.monitorInterval) clearInterval(this.monitorInterval);
            const intervalMs = this.config.checkInterval * 60 * 1000;
            this.lastCheckTime = Date.now();
            this.monitorInterval = setInterval(async () => {
                await this.checkForChanges();
                this.lastCheckTime = Date.now();
            }, intervalMs);
        };
        //default expanded menu items
        const expanded = new Set([]);
        let selectedIndex = 0;
        let menuItems = [];

        startAutoBackup();

        const render = () => {
            console.log('\x1Bc'); // Clear screen

            // 1. Render Static Status Table
            console.log(`┌───────────────────────────────────────────────────────────────┐`);
            console.log(`│                     FACTORIO BACKUP MONITOR                   │`);
            console.log(`├─────────────┬─────────────────────────────────────────────────┤`);
            console.log(`│ Service     │ ${this.config.cloudService.toUpperCase().padEnd(47)} │`);
            console.log(`│ Interval    │ ${(this.config.checkInterval + ' mins').padEnd(47)} │`);
            console.log(`│ Save Path   │ ${this.savePath.padEnd(47).substring(0, 47)} │`);
            console.log(`├─────────────┴─────────────────────────────────────────────────┤`);
            console.log(`│ Last Link   │ ${this.lastLink.padEnd(47).substring(0, 47)} │`);
            console.log(`│ Link Date   │ ${this.lastLinkDate.padEnd(47).substring(0, 47)} │`);
            console.log(`└───────────────────────────────────────────────────────────────┘`);

            // 2. Render Countdown
            const nextCheck = this.lastCheckTime + (this.config.checkInterval * 60 * 1000);
            const remaining = Math.max(0, Math.floor((nextCheck - Date.now()) / 1000));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            console.log(`  ⏱️  Next check in: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            console.log('');

            // 3. Build Menu Items
            menuItems = [];

            // 🛠️ Tools & Actions
            const isActionsExpanded = expanded.has('actions');
            menuItems.push({ label: `${isActionsExpanded ? '⬇' : '➡'} 🛠️  Tools & Actions`, value: 'toggle_actions', type: 'toggle', node: 'actions' });
            if (isActionsExpanded) {
                menuItems.push({ label: `  ├─⪢ 🔍 Force Check Now`, value: 'check', type: 'action' });
                menuItems.push({ label: `  ├─⪢ 📤 Manual Upload`, value: 'upload', type: 'action' });
                menuItems.push({
                    label: `  ├─⪢ 📥 Download from Discord`,
                    value: 'download',
                    type: 'action',
                    disabled: !(this.config.discordBotToken && this.config.discordChannelId)
                });
                menuItems.push({ label: `  └─⪢ 📋 View Monitor Log`, value: 'view_log', type: 'action' });
            }

            // ⚙️ Reconfigure Settings
            const isSettingsExpanded = expanded.has('settings');
            menuItems.push({ label: `${isSettingsExpanded ? '⬇' : '➡'} ⚙️  Reconfigure Settings`, value: 'toggle_settings', type: 'toggle', node: 'settings' });
            if (isSettingsExpanded) {
                // Cloud Sub-section
                const isCloudExpanded = expanded.has('config_cloud');
                menuItems.push({ label: `  ├──${isCloudExpanded ? '⬇' : '➡'} 🌐 Cloud Service (${this.config.cloudService.toUpperCase()})`, value: 'toggle_config_cloud', type: 'toggle', node: 'config_cloud' });
                if (isCloudExpanded) {
                    menuItems.push({ label: `  │  └─⪢ ☁️  Select Service`, value: 'conf_cloud_service', type: 'action' });
                    if (this.config.cloudService === 'buzzheavier') {
                        menuItems.push({ label: `  │  └─⪢ 👤 Buzzheavier Account`, value: 'conf_buzz_account', type: 'action' });
                    }
                }

                // Discord Sub-section
                const isDiscordExpanded = expanded.has('config_discord');
                menuItems.push({ label: `  ├──${isDiscordExpanded ? '⬇' : '➡'} 💬 Discord Notifications`, value: 'toggle_config_discord', type: 'toggle', node: 'config_discord' });
                if (isDiscordExpanded) {
                    menuItems.push({ label: `  │  ├─⪢ 🔗 Webhook: ${this.config.discordWebhook ? 'Set' : 'None'}`, value: 'conf_discord_webhook', type: 'action' });
                    menuItems.push({ label: `  │  └─⪢ 🤖 Download Bot: ${this.config.discordBotToken ? 'Configured' : 'Not Set'}`, value: 'conf_discord_bot', type: 'action' });
                }

                // General Sub-section
                const isGeneralExpanded = expanded.has('config_general');
                menuItems.push({ label: `  └──${isGeneralExpanded ? '⬇' : '➡'} ⚙️  General Settings`, value: 'toggle_config_general', type: 'toggle', node: 'config_general' });
                if (isGeneralExpanded) {
                    menuItems.push({ label: `     ├─⪢ ⏱️  Check Interval: ${this.config.checkInterval} mins`, value: 'conf_check_interval', type: 'action' });
                    menuItems.push({ label: `     ├─⪢ 🏷️  Backup Prefix: ${this.config.backupPrefix || 'None'}`, value: 'conf_backup_prefix', type: 'action' });
                    menuItems.push({ label: `     └─⪢ 🔒 Obfuscate Secrets: ${this.config.obfuscateSecrets ? 'Enabled' : 'Disabled'}`, value: 'conf_obfuscate_secrets', type: 'action' });
                }
            }

            menuItems.push({ label: '-------------------------------', value: 'sep', type: 'separator' });
            menuItems.push({ label: `❌ Exit Application`, value: 'exit', type: 'action' });

            // 4. Render Menu
            menuItems.forEach((item, idx) => {
                const prefix = idx === selectedIndex ? '❯ ' : '  ';
                if (item.type === 'separator') {
                    console.log(`  ${item.label}`);
                } else if (item.disabled) {
                    console.log(`${prefix}\x1b[90m${item.label} (disabled)\x1b[0m`);
                } else if (idx === selectedIndex) {
                    console.log(`${prefix}\x1b[36m${item.label}\x1b[0m`);
                } else {
                    console.log(`${prefix}${item.label}`);
                }
            });

            console.log('\nUse arrows to navigate (←/→ to toggle, ↑/↓ to move) • Enter to select\n');
        };

        // Render loop for countdown
        let countdownTimer = setInterval(() => render(), 1000);

        return new Promise((resolve) => {
            const onKeypress = async (str, key) => {
                if (!key) return;
                if (key.ctrl && key.name === 'c') {
                    process.exit();
                }

                if (key.name === 'up') {
                    selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
                    while (menuItems[selectedIndex].type === 'separator') {
                        selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
                    }
                    render();
                } else if (key.name === 'down') {
                    selectedIndex = (selectedIndex + 1) % menuItems.length;
                    while (menuItems[selectedIndex].type === 'separator') {
                        selectedIndex = (selectedIndex + 1) % menuItems.length;
                    }
                    render();
                } else if (key.name === 'right') {
                    const item = menuItems[selectedIndex];
                    if (item.type === 'toggle' && !expanded.has(item.node)) {
                        expanded.add(item.node);
                        render();
                    }
                } else if (key.name === 'left') {
                    const item = menuItems[selectedIndex];
                    if (item.type === 'toggle' && expanded.has(item.node)) {
                        expanded.delete(item.node);
                        render();
                    }
                } else if (key.name === 'return') {
                    const item = menuItems[selectedIndex];
                    if (item.disabled) return;

                    if (item.type === 'toggle') {
                        if (expanded.has(item.node)) expanded.delete(item.node);
                        else expanded.add(item.node);
                        render();
                    } else if (item.type === 'action') {
                        // Pause input while action is running
                        process.stdin.removeListener('keypress', onKeypress);
                        if (process.stdin.isTTY) process.stdin.setRawMode(false);
                        clearInterval(countdownTimer);

                        let configChanged = false;
                        try {
                            switch (item.value) {
                                case 'check':
                                    console.log('\nForcing manual check...');
                                    await this.checkForChanges();
                                    this.lastCheckTime = Date.now();
                                    break;
                                case 'upload':
                                    await this.manualUpload();
                                    break;
                                case 'download':
                                    await this.downloadLatestFromDiscord();
                                    break;
                                case 'view_log':
                                    console.log('\n--- Monitor Log (Last 20 lines) ---');
                                    try {
                                        const logContent = await fs.readFile(this.logFile, 'utf8');
                                        const lines = logContent.trim().split('\n').slice(-20);
                                        console.log(lines.join('\n'));
                                    } catch (e) {
                                        console.log('No logs found yet.');
                                    }
                                    break;
                                case 'conf_cloud_service':
                                    await configureCloudService(this.config);
                                    configChanged = true;
                                    break;
                                case 'conf_buzz_account':
                                    await configureBuzzAccount(this.config);
                                    configChanged = true;
                                    break;
                                case 'conf_discord_webhook':
                                    this.config.discordWebhook = await input({
                                        message: 'Enter Discord Webhook URL (Leave empty to disable):',
                                        default: this.config.discordWebhook || ''
                                    }) || null;
                                    configChanged = true;
                                    break;
                                case 'conf_discord_bot':
                                    await configureDiscordBot(this.config);
                                    configChanged = true;
                                    break;
                                case 'conf_check_interval':
                                    this.config.checkInterval = await number({
                                        message: 'Check interval (minutes):',
                                        default: this.config.checkInterval || 5,
                                        validate: (value) => (value && value > 0) ? true : 'Please enter a valid number greater than 0.'
                                    });
                                    configChanged = true;
                                    break;
                                case 'conf_backup_prefix':
                                    this.config.backupPrefix = await input({
                                        message: 'Enter Backup Prefix (Leave empty for none):',
                                        default: this.config.backupPrefix || ''
                                    }) || null;
                                    configChanged = true;
                                    break;
                                case 'conf_obfuscate_secrets':
                                    this.config.obfuscateSecrets = !this.config.obfuscateSecrets;
                                    configChanged = true;
                                    break;
                                case 'exit':
                                    console.log('Goodbye!');
                                    process.exit(0);
                            }

                            if (configChanged) {
                                await saveConfig(this.config);
                                startAutoBackup();
                            }
                        } catch (e) {
                            console.error(`\n❌ Error: ${e.message}`);
                        } finally {
                            // Ensure the user always sees the prompt to return to the menu
                            let countdown = (item.value === 'view_log') ? -1 : 5;
                            const returnMsg = () => {
                                if (countdown > 0) {
                                    process.stdout.write(`\rPress any key to return to monitor... (Auto-return in ${countdown}s) `);
                                } else {
                                    process.stdout.write(`\rPress any key to return to monitor... `);
                                }
                            };
                            returnMsg();

                            if (process.stdin.isTTY) {
                                process.stdin.setRawMode(true);
                                process.stdin.resume();
                            }

                            const returnPromise = new Promise(res => {
                                const timer = setInterval(() => {
                                    if (countdown > 0) {
                                        countdown--;
                                        returnMsg();
                                        if (countdown <= 0) {
                                            clearInterval(timer);
                                            res();
                                        }
                                    }
                                }, 1000);

                                process.stdin.once('data', () => {
                                    clearInterval(timer);
                                    res();
                                });
                            });

                            await returnPromise;
                            process.stdout.write('\n');

                            // Resume main listener
                            if (process.stdin.isTTY) {
                                process.stdin.setRawMode(true);
                                process.stdin.resume();
                            }
                            process.stdin.on('keypress', onKeypress);
                            countdownTimer = setInterval(() => render(), 1000);
                            render();
                        }
                    }
                }
            };

            process.stdin.on('keypress', onKeypress);
            render();
        });
    }

    async manualUpload() {
        console.log('\n--- Manual Upload Menu ---');
        try {
            const files = await fs.readdir(this.savePath);
            const saveFiles = files.filter(f => f.endsWith('.zip')).sort((a, b) => {
                return statSync(path.join(this.savePath, b)).mtime.getTime() -
                    statSync(path.join(this.savePath, a)).mtime.getTime();
            });

            if (saveFiles.length === 0) {
                console.log('No save files found in the directory.');
                return;
            }

            const choices = saveFiles.map(f => ({
                name: `${f} (${(statSync(path.join(this.savePath, f)).size / 1024 / 1024).toFixed(2)} MB)`,
                value: f
            }));

            choices.push({ name: 'Cancel', value: 'cancel' });

            const selectedFile = await select({
                message: 'Select a file to upload:',
                choices: choices
            });

            if (selectedFile !== 'cancel') {
                const filePath = path.join(this.savePath, selectedFile);
                const formattedName = this.formatBackupName(selectedFile);

                const downloadUrl = await this.uploadToCloud(filePath, formattedName);

                if (downloadUrl && this.config.discordWebhook) {
                    await sendNotification(
                        this.config.discordWebhook,
                        formattedName,
                        downloadUrl,
                        this.config.cloudService.charAt(0).toUpperCase() + this.config.cloudService.slice(1)
                    );
                }
            }
        } catch (error) {
            console.error('Error listing files for manual upload:', error.message);
        }
    }

    async downloadLatestFromDiscord() {
        console.log('\n--- Download Latest Backup from Discord ---');
        try {
            const latest = await getLatestBackupUrl(this.config.discordBotToken, this.config.discordChannelId);
            const dateStr = new Date(latest.timestamp).toLocaleString();

            console.log(`\n┌───────────────────────────────────────────────────────────────┐`);
            console.log(`│                   LATEST BACKUP INFO (DISCORD)                │`);
            console.log(`├─────────────┬─────────────────────────────────────────────────┤`);
            console.log(`│ File Name   │ ${latest.fileName.padEnd(47).substring(0, 47)} │`);
            console.log(`│ Date        │ ${dateStr.padEnd(47).substring(0, 47)} │`);
            console.log(`│ Source      │ Discord Bot                                     │`);
            console.log(`├─────────────┴─────────────────────────────────────────────────┤`);
            console.log(`│ Link: ${latest.url}`);
            console.log(`└───────────────────────────────────────────────────────────────┘`);

            const confirm = await select({
                message: 'Do you want to download this file?',
                choices: [
                    { name: 'Yes', value: true },
                    { name: 'No', value: false }
                ]
            });

            if (confirm) {
                const targetPath = path.join(this.savePath, latest.fileName);

                // Resolve the direct link if it's a landing page
                console.log(`🔍 Resolving source link...`);
                const directUrl = await resolveDirectLink(latest.url);
                console.log(`🌐 Final download URL: ${directUrl}`);

                console.log(`📥 Downloading ${latest.fileName} to saves folder...`);

                const response = await fetch(directUrl);

                // Safety check: ensure we are not downloading an HTML error page
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('text/html')) {
                    const errorText = await response.text();
                    if (errorText.includes('Currently receiving high amount of requests')) {
                        throw new Error('Rootz is currently overloaded. Wait a few seconds and try downloading again.');
                    }
                    throw new Error('The resolved link points to an HTML page instead of a file. The cloud service might be blocking the request or rate-limiting.');
                }

                if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

                console.log(`📥 Downloading ${latest.fileName} to saves folder...`);

                await Bun.write(targetPath, response);

                const finalSize = statSync(targetPath).size;
                console.log(`✅ File downloaded successfully! (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);
            }
        } catch (error) {
            console.error('Failed to download from Discord:', error.message);
        }
    }
}

// --- Main Execution ---

async function main() {
    let config = await loadConfig();

    if (!config) {
        config = await runInteractiveSetup();
        await saveConfig(config);
    } else {
        console.log('Configuration loaded from config.json');
    }

    const backup = new FactorioBackup(config);
    await backup.monitor();
}

main();
