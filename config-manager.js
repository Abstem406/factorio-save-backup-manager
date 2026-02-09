
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { select, input, number } from '@inquirer/prompts';

const CONFIG_FILE = 'config.json';

// Helper function to find the correct save path
export function getSavePath() {
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
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error loading config, starting setup...');
    }
    return null;
}

export async function saveConfig(config) {
    try {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log(`Configuration saved to ${CONFIG_FILE}`);
    } catch (e) {
        console.error('Error saving config:', e);
    }
}

export async function runInteractiveSetup() {
    console.log('\n--- Factorio Backup Initial Setup ---');

    // 1. Select Service
    const mode = await select({
        message: 'Select Cloud Service:',
        choices: [
            { name: 'Rootz.so (Default, Anonymous)', value: 'rootz' },
            { name: 'Buzzheavier (Anonymous)', value: 'buzzheavier_anon' },
            { name: 'Buzzheavier (Authenticated)', value: 'buzzheavier_auth' }
        ]
    });

    let cloudService = 'rootz';
    let buzzheavierConfig = {};

    if (mode === 'buzzheavier_anon') {
        cloudService = 'buzzheavier';
        buzzheavierConfig = {
            anonymous: true
        };
    } else if (mode === 'buzzheavier_auth') {
        cloudService = 'buzzheavier';
        const accountId = await input({
            message: 'Enter Buzzheavier Account ID:',
            validate: (value) => value ? true : 'Account ID cannot be empty.'
        });

        const locationId = await input({
            message: 'Enter Buzzheavier Location ID (Optional, press Enter to skip):',
        });

        buzzheavierConfig = {
            accountId,
            locationId: locationId || null,
            anonymous: false
        };
    }

    // 3. Configure Interval
    const checkInterval = await number({
        message: 'Enter check interval in minutes:',
        default: 6,
        validate: (value) => (value && value > 0) ? true : 'Please enter a valid number greater than 0.'
    });

    // 4. Discord Webhook (Optional)
    const discordWebhook = await input({
        message: 'Enter Discord Webhook URL (Optional, press Enter to skip):',
    });

    // Construct final config object
    const config = {
        cloudService,
        checkInterval,
        discordWebhook: discordWebhook || null,
        buzzheavier: buzzheavierConfig,
        rootz: {}
    };

    return config;
}
