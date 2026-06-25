import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import http from 'http';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join(process.cwd(), 'gdrive-token.json');

/**
 * Loads OAuth2 credentials from the credentials.json file.
 * This file should be an "OAuth 2.0 Client ID" (Desktop app), NOT a Service Account.
 */
function loadCredentials(credentialsPath) {
    const resolvedPath = path.resolve(process.cwd(), credentialsPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Google Drive credentials not found at ${resolvedPath}`);
    }
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    let keys;
    try {
        keys = JSON.parse(content);
    } catch (e) {
        throw new Error(`The file at ${resolvedPath} is empty or contains invalid JSON. Please paste valid credentials.`);
    }

    // Support both "installed" (Desktop) and "web" credential formats
    const creds = keys.installed || keys.web;
    if (!creds) {
        throw new Error(
            'Invalid credentials.json format. Please download an "OAuth 2.0 Client ID" (Desktop app) from Google Cloud Console, NOT a Service Account key.'
        );
    }
    return creds;
}

/**
 * Creates an OAuth2 client and loads existing tokens if available.
 * If no tokens exist, throws with instructions to authorize first.
 */
export function createOAuth2Client(credentialsPath) {
    const creds = loadCredentials(credentialsPath);
    const oauth2Client = new google.auth.OAuth2(
        creds.client_id,
        creds.client_secret,
        creds.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
    );

    // Try to load saved tokens
    if (fs.existsSync(TOKEN_PATH)) {
        try {
            const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf-8');
            const tokens = JSON.parse(tokenContent);
            oauth2Client.setCredentials(tokens);
        } catch (e) {
            // Ignore corrupted token file, force re-auth
            fs.unlinkSync(TOKEN_PATH);
        }
    }

    return oauth2Client;
}

/**
 * Starts a local server to capture the OAuth2 authorization code automatically.
 */
export async function authorizeWithLocalServer(credentialsPath) {
    const creds = loadCredentials(credentialsPath);
    
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        // Listen on an ephemeral port on localhost
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const redirectUri = `http://127.0.0.1:${port}`;
            
            const oauth2Client = new google.auth.OAuth2(
                creds.client_id,
                creds.client_secret,
                redirectUri
            );

            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
                prompt: 'consent'
            });

            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🔐 Google Drive Authorization Required');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('\n1. Open this URL in your browser:\n');
            console.log(`   \x1b[36m${authUrl}\x1b[0m\n`);
            console.log('Waiting for authorization (the server will capture the code automatically)...\n');

            // Handle the callback
            server.on('request', async (req, res) => {
                try {
                    const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);

                    // Ignore favicon and other requests
                    if (reqUrl.pathname !== '/') {
                        res.writeHead(404);
                        res.end();
                        return;
                    }

                    const code = reqUrl.searchParams.get('code');
                    const error = reqUrl.searchParams.get('error');

                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('<h1>Authorization Failed</h1><p>Check the console for details. You can close this window.</p>');
                        server.close();
                        reject(new Error(`OAuth Error: ${error}`));
                        return;
                    }

                    if (code) {
                        const { tokens } = await oauth2Client.getToken(code);
                        oauth2Client.setCredentials(tokens);
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
                        console.log(`✅ Tokens saved to ${TOKEN_PATH}`);
                        
                        const { iconBase64 } = await import('../icon-base64.js');
                        
                        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorization Successful</title>
    <style>
        body { margin: 0; padding: 0; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #ffffff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; overflow: hidden; }
        .altar-container { position: relative; z-index: 10; animation: float 4s ease-in-out infinite; margin-bottom: 20px; }
        .icon { width: 350px; height: auto; max-height: 400px; filter: drop-shadow(0 20px 40px rgba(255, 215, 0, 0.8)); z-index: 10; position: relative; border-radius: 20px; }
        .beam { position: absolute; top: -300px; left: 50%; transform: translateX(-50%); width: 600px; height: 800px; background: radial-gradient(ellipse at center, rgba(255,215,0,0.2) 0%, rgba(255,215,0,0) 70%); z-index: 1; pointer-events: none; }
        h1 { color: #f2e9e4; font-size: 2.5rem; margin-top: 20px; margin-bottom: 15px; text-shadow: 0 0 15px rgba(255, 215, 0, 0.5); }
        p { font-size: 1.2rem; color: #c9ada7; }
        .content { z-index: 20; position: relative; }
        @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-25px); } 100% { transform: translateY(0px); } }
    </style>
</head>
<body>
    <div class="beam"></div>
    <div class="content">
        <div class="altar-container">
            <img class="icon" src="data:image/png;base64,${iconBase64}" alt="Sacred Icon">
        </div>
        <h1>Authorization Successful!</h1>
        <p>The sacred connection has been established.<br>You can safely close this window and return to the application.</p>
    </div>
    <script>setTimeout(() => window.close(), 5000);</script>
</body>
</html>`;
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(html);
                        
                        server.close();
                        resolve(oauth2Client);
                        return;
                    }

                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Bad Request');
                } catch (e) {
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Internal Server Error');
                    }
                    server.close();
                    reject(e);
                }
            });
        });
    });
}

/**
 * Checks if we have valid saved tokens.
 */
export function isAuthorized() {
    return fs.existsSync(TOKEN_PATH);
}

/**
 * Uploads a file to Google Drive using OAuth2 user credentials.
 */
export async function uploadToGoogleDrive(filePath, fileName, credentialsPath, folderId) {
    const oauth2Client = createOAuth2Client(credentialsPath);

    if (!oauth2Client.credentials || !oauth2Client.credentials.refresh_token) {
        throw new Error(
            'Google Drive not authorized yet. Go to ⚙️ Settings → 🌐 Cloud Service → 🔑 GDrive Credentials → Authorize to link your account.'
        );
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const fileMetadata = { name: fileName };
    if (folderId) {
        fileMetadata.parents = [folderId];
    }

    const media = {
        mimeType: 'application/zip',
        body: fs.createReadStream(filePath),
    };

    console.log(`Uploading ${fileName} to Google Drive...`);
    const res = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
        supportsAllDrives: true
    });

    return res.data.webViewLink;
}

/**
 * Lists .zip files from a Google Drive folder, sorted by most recent first.
 */
export async function listFilesFromGoogleDrive(credentialsPath, folderId) {
    const oauth2Client = createOAuth2Client(credentialsPath);

    if (!oauth2Client.credentials || !oauth2Client.credentials.refresh_token) {
        throw new Error(
            'Google Drive not authorized yet. Go to ⚙️ Settings → 🌐 Cloud Service → 🔑 GDrive Credentials → Authorize to link your account.'
        );
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    let query = "mimeType='application/zip' and trashed=false";
    if (folderId) {
        query += ` and '${folderId}' in parents`;
    }

    const res = await drive.files.list({
        q: query,
        fields: 'files(id, name, modifiedTime, size)',
        orderBy: 'modifiedTime desc',
        pageSize: 50,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    return res.data.files || [];
}

/**
 * Downloads a file from Google Drive by its ID to a local destination path.
 */
export async function downloadFromGoogleDrive(credentialsPath, fileId, destinationPath) {
    const oauth2Client = createOAuth2Client(credentialsPath);

    if (!oauth2Client.credentials || !oauth2Client.credentials.refresh_token) {
        throw new Error(
            'Google Drive not authorized yet. Go to ⚙️ Settings → 🌐 Cloud Service → 🔑 GDrive Credentials → Authorize to link your account.'
        );
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const res = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
    );

    return new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(destinationPath);
        res.data
            .on('end', () => resolve(destinationPath))
            .on('error', (err) => reject(err))
            .pipe(dest);
    });
}
