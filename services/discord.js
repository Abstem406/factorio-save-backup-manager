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
