// services/rootz.js
import { statSync } from 'fs';

export async function upload(filePath, fileName, config) {
    const fileSize = statSync(filePath).size;
    console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    if (fileSize < config.multipartThreshold) {
        return await uploadSmall(filePath, fileName, config);
    } else {
        return await uploadLarge(filePath, fileName, fileSize, config);
    }
}

async function uploadSmall(filePath, fileName, config) {
    try {
        const formData = new FormData();
        formData.append('file', Bun.file(filePath), fileName);

        const response = await fetch(`${config.endpoint}/api/files/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Upload failed');
        }

        const downloadUrl = `${config.endpoint}/d/${data.data.shortId}`;
        console.log(`✅ Upload completed! Share: ${downloadUrl}`);
        return downloadUrl;
    } catch (error) {
        console.error('Failed to upload small file to Rootz:', error.message);
        throw error;
    }
}

function getOptimalParallelism(fileSize) {
    if (fileSize > 50 * 1024 ** 3) return 3; // > 50GB
    if (fileSize > 10 * 1024 ** 3) return 4; // > 10GB
    if (fileSize > 1 * 1024 ** 3) return 5;  // > 1GB
    return 6; // Smaller files
}

async function uploadLarge(filePath, fileName, fileSize, config) {
    const headers = { 'Content-Type': 'application/json' };

    try {
        // 1. Initialize multipart upload
        console.log(`📦 Initializing upload for ${fileName}...`);
        const initRes = await fetch(`${config.endpoint}/api/files/multipart/init`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                fileName,
                fileSize,
                fileType: 'application/octet-stream'
            })
        });

        if (!initRes.ok) throw new Error(`Init failed: ${initRes.statusText}`);

        const initData = await initRes.json();
        const { uploadId, key, chunkSize, totalParts } = initData;

        console.log(`✅ Upload initialized: ${totalParts} parts × ${(chunkSize / 1024 ** 2).toFixed(1)} MB`);

        // 2. Get all presigned URLs upfront
        console.log(`🔗 Getting presigned URLs for ${totalParts} parts...`);
        const urlsRes = await fetch(`${config.endpoint}/api/files/multipart/batch-urls`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ key, uploadId, totalParts })
        });
        const urlsData = await urlsRes.json();

        if (!urlsData.success) {
            throw new Error(urlsData.error || 'Failed to get upload URLs');
        }

        const presignedUrls = urlsData.urls;
        console.log(`✅ Got all presigned URLs`);

        // 3. Upload parts in PARALLEL
        const parallelism = getOptimalParallelism(fileSize);
        console.log(`\n🚀 Uploading ${totalParts} parts with ${parallelism}x parallelism...`);

        const startTime = Date.now();
        let completedParts = 0;

        const uploadPart = async (partNumber) => {
            const url = presignedUrls[partNumber];
            const start = (partNumber - 1) * chunkSize;
            const end = Math.min(start + chunkSize, fileSize);

            const chunk = Bun.file(filePath).slice(start, end);

            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const res = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: chunk
                    });

                    if (!res.ok) throw new Error(`Status ${res.status}`);

                    const etag = res.headers.get('etag')?.replace(/"/g, '');
                    return { partNumber, etag };
                } catch (error) {
                    if (attempt === maxRetries - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000));
                }
            }
        };

        const uploadedParts = [];
        // Batch processing
        for (let i = 0; i < totalParts; i += parallelism) {
            const batch = [];
            for (let j = i + 1; j <= Math.min(i + parallelism, totalParts); j++) {
                batch.push(uploadPart(j));
            }

            const results = await Promise.all(batch);
            uploadedParts.push(...results);
            completedParts += results.length;

            const progress = (completedParts / totalParts) * 100;
            console.log(`Progress: ${progress.toFixed(1)}% (${completedParts}/${totalParts})`);
        }

        const elapsedTotal = (Date.now() - startTime) / 1000;
        console.log(`✅ Upload completed in ${elapsedTotal.toFixed(1)}s`);

        uploadedParts.sort((a, b) => a.partNumber - b.partNumber);

        // 4. Complete multipart upload
        console.log(`🔄 Finalizing upload...`);
        const completeRes = await fetch(`${config.endpoint}/api/files/multipart/complete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                key,
                uploadId,
                parts: uploadedParts,
                fileName,
                fileSize,
                contentType: 'application/octet-stream'
            })
        });
        const completeData = await completeRes.json();

        if (!completeData.success) {
            throw new Error(completeData.error);
        }

        console.log(`✅ File saved to database`);
        const downloadUrl = `${config.endpoint}/d/${completeData.file.shortId}`;
        console.log(`🎉 Success! Share: ${downloadUrl}`);
        return downloadUrl;

    } catch (error) {
        console.error('Failed to upload large file to Rootz:', error.message);
        throw error;
    }
}
