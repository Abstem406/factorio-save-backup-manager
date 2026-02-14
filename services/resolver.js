// services/resolver.js

/**
 * Resolves a sharing link into a direct download link.
 * @param {string} url The sharing URL from Discord.
 * @returns {Promise<string>} The direct download URL.
 */
export async function resolveDirectLink(url) {
    console.log(`Resolving direct link for: ${url}`);

    if (url.includes('buzzheavier.com')) {
        return await resolveBuzzheavier(url);
    }

    if (url.includes('rootz.so')) {
        return await resolveRootz(url);
    }

    // Default: return the original URL if no resolver is known
    return url;
}

async function resolveBuzzheavier(url) {
    try {
        // Buzzheavier URLs: https://buzzheavier.com/f/filename
        // We need to fetch the page and look for the download logic.
        // Based on research, it uses HTMX with hx-get="/download"

        const response = await fetch(url);
        const html = await response.text();

        // Find the download endpoint from hx-get
        const hxMatch = html.match(/hx-get="([^"]*\/download[^"]*)"/);
        if (!hxMatch) {
            console.warn('Could not find Buzzheavier download trigger in HTML. Returning original URL.');
            return url;
        }

        const downloadPath = hxMatch[1];
        const downloadUrl = `https://buzzheavier.com${downloadPath}`;

        // Fetch the download path and check for HX-Redirect header
        const res = await fetch(downloadUrl, {
            headers: {
                'HX-Request': 'true'
            },
            redirect: 'manual' // We want to see the headers
        });

        const directLink = res.headers.get('HX-Redirect');
        if (directLink) {
            console.log(`Resolved Buzzheavier direct link: ${directLink}`);
            return directLink;
        }

        return url;
    } catch (error) {
        console.error('Error resolving Buzzheavier link:', error.message);
        return url;
    }
}

async function resolveRootz(url) {
    try {
        // Rootz URLs: https://www.rootz.so/d/{shortId}
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const shortId = pathParts.pop();

        if (!shortId) {
            console.warn('Could not extract shortId from Rootz URL.');
            return url;
        }

        // Direct API call that bypasses landing page/popups
        const apiUrl = `https://www.rootz.so/api/files/download-by-short/${shortId}`;
        console.log(`Calling Rootz internal API: ${apiUrl}`);

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Rootz API failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.success && data.data && data.data.url) {
            console.log(`Resolved direct CDN link via API: ${data.data.url}`);
            return data.data.url;
        }

        console.warn('Rootz API did not return a direct URL. Returning original link.');
        return url;
    } catch (error) {
        console.error('Error resolving Rootz link:', error.message);
        return url;
    }
}
