const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
require('dotenv').config();

// -------------------------------------------------------------
// 1. RENDER İÇİN HTTP WEB SUNUCUSU (Uptime & Port Yanıtı)
// -------------------------------------------------------------
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot aktif ve Render uzerinde calisiyor!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Web] Web servisi ${PORT} portunda dinleniyor.`);
});

// -------------------------------------------------------------
// 2. DISCORD BOT VE SES BAĞLANTISI
// -------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

async function connectToVoice() {
    const guildId = process.env.GUILD_ID;
    const channelId = process.env.VOICE_CHANNEL_ID;

    if (!guildId || !channelId) {
        console.warn('----------------------------------------------------');
        console.warn('[UYARI] GUILD_ID veya VOICE_CHANNEL_ID tanımlanmamış!');
        console.warn('Botun ses kanalına girebilmesi için .env dosyasında veya');
        console.warn('Render panelinde bu iki ID bilgisini girmelisiniz.');
        console.warn('----------------------------------------------------');
        return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.error(`[HATA] Bot "${guildId}" ID'li sunucuda bulunamadı!`);
        console.error('Lütfen botu sunucunuza davet ettiğinizden emin olun.');
        return;
    }

    try {
        console.log(`[Ses] Kanala (${channelId}) bağlanılıyor...`);
        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,  // Bot kulaklığı sağır görünsün
            selfMute: true   // Bot mikrofonu kapalı görünsün
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('[Ses] Ses kanalına başarıyla bağlandı ve aktif!');
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                console.log('[Ses] Bağlantı koptu, 5 saniye içinde yeniden bağlanılıyor...');
                try {
                    connection.destroy();
                } catch (e) {}
                setTimeout(connectToVoice, 5000);
            }
        });
    } catch (err) {
        console.error('[HATA] Ses kanalına bağlanırken hata oluştu:', err);
    }
}

client.once('ready', () => {
    console.log(`[Discord] Bot başarıyla giriş yaptı: ${client.user.tag}`);
    connectToVoice();
});

if (!process.env.DISCORD_TOKEN) {
    console.error('[HATA] DISCORD_TOKEN bulunamadı! Lütfen .env dosyasını kontrol edin.');
} else {
    client.login(process.env.DISCORD_TOKEN).catch(err => {
        console.error('[HATA] Discord bot giriş hatası:', err.message);
    });
}
