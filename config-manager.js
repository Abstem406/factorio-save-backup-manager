
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { select, input, number } from '@inquirer/prompts';
import crypto from 'crypto';

const CONFIG_FILE = 'config.json';
const SECRET_PREFIX = 'obf:';
const SECRET_KEY = 'factorio-backup-secret-key'; // Fixed key for simplicity in this tool

// Simple obfuscation (not military grade, just to hide from plain view)
function obfuscate(value) {
    if (!value || value.startsWith(SECRET_PREFIX)) return value;
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(SECRET_KEY, 'salt', 32), Buffer.alloc(16, 0));
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return SECRET_PREFIX + encrypted;
}

function deobfuscate(value) {
    if (!value || !value.startsWith(SECRET_PREFIX)) return value;
    try {
        const encrypted = value.substring(SECRET_PREFIX.length);
        const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(SECRET_KEY, 'salt', 32), Buffer.alloc(16, 0));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return value; // Return as is if decryption fails
    }
}

// Helper function to find the correct save path
export function getSavePath() {
    if (process.env.FACTORIO_SAVES_PATH) {
        return path.resolve(process.env.FACTORIO_SAVES_PATH);
    }

    const platform = os.platform();
    const homeDir = os.homedir();

    if (platform === 'win32') {
        return path.join(process.env.APPDATA, 'Factorio', 'saves');
    } else if (platform === 'linux') {
        // Check for GOG version first
        const gogPath = path.join(homeDir, 'GOG Games/Factorio/game/saves');
        if (existsSync(gogPath)) {
            console.log('Detected GOG Factorio installation');
            return gogPath;
        }

        // Default to Steam/Standard Linux path
        const standardPath = path.join(homeDir, '.factorio/saves');
        console.log('Using standard Factorio path');
        return standardPath;
    } else if (platform === 'darwin') {
        return path.join(homeDir, 'Library/Application Support/factorio/saves');
    }

    // Fallback
    return path.join(homeDir, '.factorio/saves');
}

export async function loadConfig() {
    try {
        if (existsSync(CONFIG_FILE)) {
            const data = await fs.readFile(CONFIG_FILE, 'utf-8');
            const config = JSON.parse(data);

            // Auto-deobfuscate known secrets
            if (config.discordWebhook) config.discordWebhook = deobfuscate(config.discordWebhook);
            if (config.discordBotToken) config.discordBotToken = deobfuscate(config.discordBotToken);
            if (config.googleDrive && config.googleDrive.credentialsPath) {
                config.googleDrive.credentialsPath = deobfuscate(config.googleDrive.credentialsPath);
            }

            return config;
        }
    } catch (e) {
        console.error('Error loading config, starting setup...');
    }
    return null;
}

export async function saveConfig(config) {
    try {
        let configToSave = JSON.parse(JSON.stringify(config)); // Deep clone

        if (config.obfuscateSecrets) {
            if (configToSave.discordWebhook) configToSave.discordWebhook = obfuscate(configToSave.discordWebhook);
            if (configToSave.discordBotToken) configToSave.discordBotToken = obfuscate(configToSave.discordBotToken);
            if (configToSave.googleDrive && configToSave.googleDrive.credentialsPath) {
                configToSave.googleDrive.credentialsPath = obfuscate(configToSave.googleDrive.credentialsPath);
            }
        }

        await fs.writeFile(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
        console.log(`Configuration saved to ${CONFIG_FILE} (Obfuscation: ${config.obfuscateSecrets ? 'ON' : 'OFF'})`);
    } catch (e) {
        console.error('Error saving config:', e);
    }
}

export async function runInteractiveSetup(currentConfig = null) {
    const readline = await import('readline');
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    let config = currentConfig || {
        cloudService: 'google-drive',
        checkInterval: 5,
        discordWebhook: null,
        discordBotToken: null,
        discordChannelId: null,
        googleDrive: { credentialsPath: './credentials.json', folderId: null },
        backupPrefix: null
    };

    const expanded = new Set();
    let selectedIndex = 0;
    let menuItems = [];

    const render = () => {
        process.stdout.write('\x1Bc'); // Clear screen
        console.log(`┌───────────────────────────────────────────────────────────────┐`);
        console.log(`│                 FACTORIO SETUP CONFIGURATION                  │`);
        console.log(`├─────────────┬─────────────────────────────────────────────────┤`);
        console.log(`│ Service     │ ${config.cloudService.toUpperCase().padEnd(47).substring(0, 47)} │`);
        console.log(`│ Interval    │ ${(config.checkInterval + ' mins').padEnd(47).substring(0, 47)} │`);
        console.log(`│ Webhook     │ ${(config.discordWebhook ? 'CONNECTED' : 'NOT SET').padEnd(47).substring(0, 47)} │`);
        console.log(`│ Discord Bot │ ${(config.discordBotToken ? 'CONFIGURED' : 'NOT SET').padEnd(47).substring(0, 47)} │`);
        console.log(`└─────────────┴─────────────────────────────────────────────────┘\n`);

        menuItems = [];

        // 🌐 Cloud Section
        const isCloudExpanded = expanded.has('cloud');
        menuItems.push({
            name: `${isCloudExpanded ? '⬇' : '➡'} 🌐 Cloud Service (${config.cloudService.toUpperCase()})`,
            type: 'toggle',
            value: 'cloud'
        });
        if (isCloudExpanded) {
            menuItems.push({ name: `  ├─⪢ ☁️ Select Service`, type: 'action', value: 'cloud_service' });
            if (config.cloudService === 'google-drive') {
                menuItems.push({
                    name: `  └─ 🔑 GDrive Credentials: ${config.googleDrive?.credentialsPath || 'Not Set'}`,
                    type: 'action',
                    value: 'gdrive_credentials'
                });
            } else {
                menuItems.push({ name: `  └─ ${config.cloudService.toUpperCase()}`, type: 'info', disabled: true });
            }
        }

        // 💬 Discord Section
        const isDiscordExpanded = expanded.has('discord');
        menuItems.push({
            name: `${isDiscordExpanded ? '⬇' : '➡'} 💬 Discord Notifications`,
            type: 'toggle',
            value: 'discord'
        });
        if (isDiscordExpanded) {
            menuItems.push({
                name: `  ├─⪢ 🔗 Webhook: ${config.discordWebhook ? 'Set' : 'None'}`,
                type: 'action',
                value: 'discord_webhook'
            });
            menuItems.push({
                name: `  └─⪢ 🤖 Download Bot: ${config.discordBotToken ? 'Configured' : 'Not Set'}`,
                type: 'action',
                value: 'discord_bot'
            });
        }

        // ⚙️ General Section
        const isGeneralExpanded = expanded.has('general');
        menuItems.push({
            name: `${isGeneralExpanded ? '⬇' : '➡'} ⚙️  General Settings`,
            type: 'toggle',
            value: 'general'
        });
        if (isGeneralExpanded) {
            menuItems.push({
                name: `     ├─⪢ ⏱️ Check Interval: ${config.checkInterval} mins`,
                type: 'action',
                value: 'check_interval'
            });
            menuItems.push({
                name: `     ├─⪢ 🏷️ Backup Prefix: ${config.backupPrefix || 'None (Original Name)'}`,
                type: 'action',
                value: 'backup_prefix'
            });
            menuItems.push({
                name: `     └─⪢ 🔒 Obfuscate Secrets: ${config.obfuscateSecrets ? 'Enabled' : 'Disabled'}`,
                type: 'action',
                value: 'toggle_obfuscation'
            });
        }

        menuItems.push({ name: '  -------------------------------', type: 'separator', disabled: true });
        menuItems.push({ name: '  💾 Save and Exit', type: 'action', value: 'save' });
        menuItems.push({ name: '  ❌ Cancel', type: 'action', value: 'cancel' });

        // Print menu
        menuItems.forEach((item, index) => {
            if (index === selectedIndex) {
                console.log(`\x1b[47m\x1b[30m ${item.name} \x1b[0m`);
            } else {
                console.log(` ${item.name}`);
            }
        });

        console.log('\nUse arrows to navigate (←/→ to toggle, ↑/↓ to move) • Enter to select \n');
    };

    render();

    return new Promise((resolve) => {
        const onKeypress = async (str, key) => {
            if (!key) return;

            // Ensure index is within bounds (in case items changed)
            if (selectedIndex >= menuItems.length) selectedIndex = menuItems.length - 1;

            if (key.ctrl && key.name === 'c') {
                process.stdin.removeListener('keypress', onKeypress);
                if (process.stdin.isTTY) process.stdin.setRawMode(false);
                process.exit(0);
            }

            if (key.name === 'up') {
                selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
                render();
            } else if (key.name === 'down') {
                selectedIndex = (selectedIndex + 1) % menuItems.length;
                render();
            } else if (key.name === 'right') {
                const item = menuItems[selectedIndex];
                if (item && item.type === 'toggle' && !expanded.has(item.value)) {
                    expanded.add(item.value);
                    render();
                }
            } else if (key.name === 'left') {
                const item = menuItems[selectedIndex];
                if (item && item.type === 'toggle' && expanded.has(item.value)) {
                    expanded.delete(item.value);
                    render();
                }
            } else if (key.name === 'return') {
                const item = menuItems[selectedIndex];
                if (!item || item.disabled) return;

                if (item.type === 'toggle') {
                    if (expanded.has(item.value)) expanded.delete(item.value);
                    else expanded.add(item.value);
                    render();
                } else if (item.type === 'action') {
                    // Pause custom loop for data entry
                    process.stdin.removeListener('keypress', onKeypress);
                    if (process.stdin.isTTY) process.stdin.setRawMode(false);

                    try {
                        switch (item.value) {
                            case 'cloud_service':
                                await configureCloudService(config);
                                break;
                            case 'gdrive_credentials':
                                await configureGoogleDriveCredentials(config);
                                break;
                            case 'discord_webhook':
                                config.discordWebhook = await input({
                                    message: 'Enter Discord Webhook URL (Leave empty to disable):',
                                    default: config.discordWebhook || ''
                                }) || null;
                                break;
                            case 'discord_bot':
                                await configureDiscordBot(config);
                                break;
                            case 'check_interval':
                                config.checkInterval = await number({
                                    message: 'Check interval (minutes):',
                                    default: config.checkInterval || 5,
                                    validate: (value) => (value && value > 0)
                                        ? true
                                        : 'Please enter a valid number greater than 0.'
                                });
                                break;
                            case 'backup_prefix':
                                config.backupPrefix = await input({
                                    message: 'Enter Backup Prefix (e.g. MegaBase, leave empty for none):',
                                    default: config.backupPrefix || ''
                                }) || null;
                                break;
                            case 'toggle_obfuscation':
                                config.obfuscateSecrets = !config.obfuscateSecrets;
                                break;
                            case 'save':
                                resolve(config);
                                return; // Promise resolved, stop this instance
                            case 'cancel':
                                resolve(currentConfig);
                                return; // Promise resolved, stop this instance
                        }
                    } catch (e) {
                        // Handle potential Inquirer errors (e.g. forced close)
                    } finally {
                        // ALWAYS resume custom loop
                        if (process.stdin.isTTY) {
                            process.stdin.setRawMode(true);
                            process.stdin.resume(); // Keep stream flowing
                        }
                        process.stdin.on('keypress', onKeypress);
                        render();
                    }
                }
            }
        };

        process.stdin.on('keypress', onKeypress);
    });
}

export async function configureCloudService(config) {
    const service = await select({
        message: 'Select Cloud Service:',
        choices: [
            { name: 'Google Drive', value: 'google-drive' }
        ]
    });

    if (service === 'google-drive') {
        config.cloudService = 'google-drive';
        if (!config.googleDrive) config.googleDrive = { credentialsPath: './credentials.json' };
    }
}

export async function configureGoogleDriveCredentials(config) {
    const { isAuthorized, authorizeWithLocalServer } = await import('./services/google-drive.js');

    const credentialsPath = await input({
        message: 'Enter path to OAuth2 credentials.json:',
        default: config.googleDrive?.credentialsPath || './credentials.json',
        validate: (value) => {
            if (!value) return 'Credentials path cannot be empty.';
            const resolved = path.resolve(process.cwd(), value);
            if (!existsSync(resolved)) {
                return `File not found at: ${resolved}\nDownload it from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Desktop app).`;
            }
            return true;
        }
    });
    const folderId = await input({
        message: 'Enter Google Drive Folder ID (Leave empty to upload to root):',
        default: config.googleDrive?.folderId || ''
    }) || null;
    config.googleDrive = { credentialsPath, folderId };

    // Check if already authorized
    if (isAuthorized()) {
        console.log('\n✅ Google Drive is already authorized.');
        const reAuth = await select({
            message: 'Do you want to re-authorize?',
            choices: [
                { name: 'No, keep current authorization', value: false },
                { name: 'Yes, re-authorize', value: true }
            ]
        });
        if (!reAuth) return;
    }

    // Start OAuth2 flow with local server
    try {
        await authorizeWithLocalServer(credentialsPath);
        console.log('\n🎉 Google Drive authorized successfully! Your backups will upload to your personal Drive.');
    } catch (err) {
        console.error(`\n❌ Authorization failed: ${err.message}`);
        console.error('Make sure you downloaded "OAuth 2.0 Client ID" (Desktop app) credentials, NOT a Service Account key.');
    }
}

export async function configureDiscordBot(config) {
    config.discordBotToken = await input({
        message: 'Enter Discord Bot Token:',
        default: config.discordBotToken || '',
        validate: (value) => value ? true : 'Token cannot be empty.'
    });
    config.discordChannelId = await input({
        message: 'Enter Discord Channel ID:',
        default: config.discordChannelId || '',
        validate: (value) => value ? true : 'Channel ID cannot be empty.'
    });
}
