// backup-factorio.js
// Run with: bun backup-factorio.js
import { promises as fs, statSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSavePath, loadConfig, saveConfig, runInteractiveSetup } from './config-manager.js';

// Explicit imports
import { upload as uploadToBuzzheavier } from './services/buzzheavier.js';
import { upload as uploadToRootz } from './services/rootz.js';
import { sendNotification } from './services/discord.js';

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
    }

    async getLatestSave() {
        const saveDir = this.savePath;
        try {
            const files = await fs.readdir(saveDir);
            const saveFiles = files.filter(f => f.endsWith('.zip')).sort((a, b) => {
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
                console.log(`Change detected in: ${save.name}`);
                const downloadUrl = await this.uploadToCloud(save.path, save.name);

                if (downloadUrl && this.config.discordWebhook) {
                    await sendNotification(
                        this.config.discordWebhook,
                        save.name,
                        downloadUrl,
                        this.config.cloudService.charAt(0).toUpperCase() + this.config.cloudService.slice(1)
                    );
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
        process.stdin.resume();
        this.isReconfiguring = false;

        const startMonitoring = () => {
            if (this.monitorInterval) clearInterval(this.monitorInterval);

            const intervalMs = this.config.checkInterval * 60 * 1000;
            console.log(`\n--- Factorio Backup Manager ---`);
            console.log(`Service: ${this.config.cloudService}`);
            if (this.config.cloudService === 'buzzheavier') {
                console.log(`Mode: ${this.config.buzzheavier.anonymous ? 'Anonymous' : 'Authenticated'}`);
            }
            console.log(`Save path: ${this.savePath}`);
            console.log(`Check interval: ${this.config.checkInterval} minutes`);
            console.log('Press "ENTER" to force a check immediately.');
            console.log('Press "c" to reconfigure settings.');
            console.log('-------------------------------');

            this.monitorInterval = setInterval(async () => {
                await this.checkForChanges();
            }, intervalMs);
        };

        process.stdin.on('data', async (data) => {
            if (this.isReconfiguring) return;

            const key = data.toString().trim().toLowerCase();

            if (key === '') { // Enter
                console.log('Forcing manual check...');
                await this.checkForChanges();
            } else if (key === 'c') {
                this.isReconfiguring = true;
                console.log('\nStopping monitor for reconfiguration...');
                clearInterval(this.monitorInterval);

                try {
                    const newConfig = await runInteractiveSetup();
                    await saveConfig(newConfig);
                    this.config = newConfig;
                    console.log('Configuration updated successfully.');
                } catch (err) {
                    console.error('Error during reconfiguration:', err.message);
                }

                this.isReconfiguring = false;
                process.stdin.resume(); // Essential: reactivation for Bun after Inquirer
                startMonitoring();
            }
        });

        // Start first loop
        startMonitoring();
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
    backup.monitor();
}

main();
