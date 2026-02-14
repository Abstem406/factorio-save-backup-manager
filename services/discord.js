// services/discord.js
export async function sendNotification(webhookUrl, fileName, downloadUrl, serviceName) {
    if (!webhookUrl) return;

    const embed = {
        title: '🚀 Factorio Backup Successful',
        description: `A new backup has been uploaded to **${serviceName}**.`,
        color: 0xe67e22, // Orange (Factorio-like color)
        fields: [
            {
                name: '📁 Filename',
                value: `\`${fileName}\``,
                inline: true
            },
            {
                name: '🌐 Service',
                value: serviceName,
                inline: true
            },
            {
                name: '🔗 Download Link',
                value: downloadUrl
            }
        ],
        timestamp: new Date().toISOString(),
        footer: {
            text: 'Factorio Backup Manager'
        }
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });

        if (!response.ok) {
            console.error('Discord notification failed:', response.status, await response.text());
        } else {
            console.log('✅ Discord notification sent!');
        }
    } catch (error) {
        console.error('Error sending Discord notification:', error.message);
    }
}

export async function getLatestBackupUrl(botToken, channelId) {
    if (!botToken || !channelId) {
        throw new Error('Discord Bot Token and Channel ID are required for downloading.');
    }

    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=50`, {
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch messages: ${response.status} ${await response.text()}`);
        }

        const messages = await response.json();

        // Search for the latest message with a download link
        for (const message of messages) {
            // Check embeds first (as sent by this tool)
            if (message.embeds && message.embeds.length > 0) {
                for (const embed of message.embeds) {
                    const downloadField = embed.fields?.find(f => f.name.includes('Download Link'));
                    if (downloadField && downloadField.value) {
                        // Extract URL from the field value (it might be wrapped in markdown)
                        const urlMatch = downloadField.value.match(/https?:\/\/[^\s]+ /);
                        const url = urlMatch ? urlMatch[0].trim() : downloadField.value.trim();
                        return {
                            url,
                            fileName: embed.fields?.find(f => f.name.includes('Filename'))?.value.replace(/`/g, '') || 'latest_backup.zip',
                            timestamp: message.timestamp
                        };
                    }
                }
            }

            // Fallback: check message content if no embeds match
            const contentMatch = message.content?.match(/https?:\/\/[^\s]+ /);
            if (contentMatch) {
                return {
                    url: contentMatch[0].trim(),
                    fileName: 'latest_backup.zip',
                    timestamp: message.timestamp
                };
            }
        }

        throw new Error('No backup link found in the last 50 messages.');
    } catch (error) {
        console.error('Error fetching latest backup from Discord:', error.message);
        throw error;
    }
}
