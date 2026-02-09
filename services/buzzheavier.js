// services/buzzheavier.js
export async function upload(filePath, fileName, config) {
    try {
        const { accountId, locationId, anonymous } = config;

        // Generate unique filename to avoid overwrite issues
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uniqueFileName = `${fileName.replace('.zip', '')}_${timestamp}.zip`;

        // Construct URL
        let url = 'https://w.buzzheavier.com';

        if (anonymous) {
            url += `/${uniqueFileName}`;
            console.log(`Uploading to Buzzheavier (Anonymous): ${url}`);
        } else {
            if (locationId) {
                url += `/${locationId}`;
            }
            url += `/${uniqueFileName}`;
            console.log(`Uploading to Buzzheavier (Authenticated): ${url}`);
        }

        const file = Bun.file(filePath);

        const headers = {
            'Content-Type': 'application/zip'
        };

        if (!anonymous && accountId) {
            headers['Authorization'] = `Bearer ${accountId}`;
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: file
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload failed with status ${response.status}: ${errorText}`);
        }

        const downloadUrl = `https://buzzheavier.com/f/${uniqueFileName}`;
        console.log(`Upload successful! Link: ${downloadUrl}`);
        return downloadUrl;

    } catch (error) {
        console.error('Failed to upload to Buzzheavier:', error.message);
        throw error;
    }
}
