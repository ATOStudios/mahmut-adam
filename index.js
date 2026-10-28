const http = require('http');
const https = require('https');
const { Readable } = require('stream');
const {
    Client,
    GatewayIntentBits,
    AttachmentBuilder
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    EndBehaviorType
} = require('@discordjs/voice');
const prism = require('prism-media');
const googleTTS = require('google-tts-api');
const ffmpegPath = require('ffmpeg-static');
require('dotenv').config();

// FFMPEG yolunu ortam değişkenine bağla
process.env.FFMPEG_PATH = ffmpegPath;

// -------------------------------------------------------------
// 1. RENDER İÇİN HTTP SUNUCUSU (Uptime & Port)
// -------------------------------------------------------------
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Mahmut AI Discord Ses Asistani Aktif!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Web] Servis ${PORT} portunda dinleniyor.`);
});

// -------------------------------------------------------------
// 2. DISCORD BOT VE SES OYNATICI
// -------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const audioPlayer = createAudioPlayer();
let isBotSpeaking = false;
const activeUsers = new Set();
let textChannel = null;

// PCM Verisini WAV Formatına Çeviren Fonksiyon (44-byte başlık ekler)
function pcmToWav(pcmData, sampleRate = 48000, numChannels = 2, bitsPerSample = 16) {
    const dataLength = pcmData.length;
    const buffer = Buffer.alloc(44 + dataLength);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM formatı
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);

    pcmData.copy(buffer, 44);
    return buffer;
}

// -------------------------------------------------------------
// 3. GEMINI API ÇAĞRILARI (STT, Canlı Arama, Görsel Analiz)
// -------------------------------------------------------------
const GEMINI_KEY = process.env.GEMINI_API_KEY;

function callGeminiAPI(bodyObj) {
    return new Promise((resolve, reject) => {
        if (!GEMINI_KEY) return reject(new Error('GEMINI_API_KEY eksik!'));
        const body = JSON.stringify(bodyObj);

        const req = https.request(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.candidates && json.candidates[0]?.content?.parts[0]?.text) {
                            resolve(json.candidates[0].content.parts[0].text);
                        } else {
                            resolve(null);
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Sesi Metne Dökme (STT)
async function transcribeAudio(wavBuffer) {
    try {
        const base64Audio = wavBuffer.toString('base64');
        const text = await callGeminiAPI({
            contents: [
                {
                    parts: [
                        {
                            text: 'Aşağıdaki ses kaydında Türkçe ne söyleniyor? Sadece ve sadece konuşulan cümleyi tam olarak yaz. Eğer ses anlaşılmıyorsa, sadece nefes, öksürük veya arka plan gürültüsüyse sadece "BOS" yaz.'
                        },
                        {
                            inline_data: {
                                mime_type: 'audio/wav',
                                data: base64Audio
                            }
                        }
                    ]
                }
            ]
        });
        return text ? text.trim() : 'BOS';
    } catch (err) {
        console.error('[STT Hatası]:', err.message);
        return 'BOS';
    }
}

// Google Search ile Akıllı Cevap Alma
async function askMahmutAI(question, speakerName) {
    try {
        const prompt = `Sen "Mahmut"sun. Discord ses kanalındaki arkadaş ortamında takılan samimi, esprili ve oyunlar konusunda bilgili bir arkadaşsın.
Arkadaşın ${speakerName} sana sesli olarak şunu sordu: "${question}".
Cevabını oluştururken:
1. Google Arama'yı kullanarak en güncel bilgileri (özellikle League of Legends yama notları, counter taktikleri, eşya buildleri, rünler vb.) kontrol et.
2. İki bölümden oluşan bir yanıt hazırla:
SES: Ses kanalında seslendirilecek 2-3 cümlelik çok samimi, doğal, esprili ve akıcı özet. Markdown işaretleri (yıldız, diyez vb.) ASLA KULLANMA.
CHAT: Discord metin kanalına atılacak detaylı build, rün, yama ve taktik bilgisi (madde işaretleri ve detay içerebilir).

Format tam olarak şöyle olsun:
[SES]
seslendirilecek metin
[CHAT]
chatte paylaşılacak detaylı metin`;

        const response = await callGeminiAPI({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }]
        });

        if (!response) return null;

        let voiceText = '';
        let chatText = '';

        if (response.includes('[SES]') && response.includes('[CHAT]')) {
            const parts = response.split('[CHAT]');
            voiceText = parts[0].replace('[SES]', '').trim();
            chatText = parts[1].trim();
        } else {
            voiceText = response.replace(/[*#_`]/g, '').slice(0, 250);
            chatText = response;
        }

        return { voiceText, chatText };
    } catch (err) {
        console.error('[Gemini AI Hatası]:', err.message);
        return null;
    }
}

// Ekran Görüntüsü / Resim Analizi
async function analyzeImage(imageUrl, caption, speakerName) {
    try {
        const imageBuffer = await new Promise((resolve, reject) => {
            https.get(imageUrl, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            });
        });

        const prompt = `Sen Mahmut'sun. Arkadaşın ${speakerName} Discord kanalına bu ekran görüntüsünü gönderdi. Ek açıklama: "${caption || 'Yok'}".
Görseli incele (eğer oyun ekranıysa eşyalar, skor tablosu, rünler veya oyun durumunu kontrol et).
Arkadaşına sesli kanalda doğrudan söyleyeceğin samimi, esprili, hafif takılan ama taktiksel açıdan doğru 2-3 cümlelik bir yorum yap. Markdown işareti kullanma.`;

        const response = await callGeminiAPI({
            contents: [
                {
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: 'image/jpeg',
                                data: imageBuffer.toString('base64')
                            }
                        }
                    ]
                }
            ]
        });

        return response ? response.replace(/[*#_`]/g, '').trim() : null;
    } catch (err) {
        console.error('[Görsel Analiz Hatası]:', err.message);
        return null;
    }
}

// -------------------------------------------------------------
// 4. SESLENDİRME (TTS) & KANALDA KONUŞMA
// -------------------------------------------------------------
async function speak(text) {
    if (!text || !text.trim() || isBotSpeaking) return;
    try {
        isBotSpeaking = true;
        console.log(`[Mahmut Konuşuyor]: "${text}"`);

        // Metin uzunsa parçalayarak al
        const audioList = await googleTTS.getAllAudioBase64(text, {
            lang: 'tr',
            slow: false,
            timeout: 10000
        });

        for (const item of audioList) {
            const buffer = Buffer.from(item.base64, 'base64');
            const stream = Readable.from(buffer);
            const resource = createAudioResource(stream);

            audioPlayer.play(resource);

            await new Promise((resolve) => {
                const onIdle = () => {
                    audioPlayer.off(AudioPlayerStatus.Idle, onIdle);
                    resolve();
                };
                audioPlayer.on(AudioPlayerStatus.Idle, onIdle);
            });
        }
    } catch (err) {
        console.error('[TTS Hatası]:', err);
    } finally {
        isBotSpeaking = false;
    }
}

// -------------------------------------------------------------
// 5. SES KANALINA BAĞLANMA VE DİNLEME (RECEIVER)
// -------------------------------------------------------------
async function connectToVoice() {
    const guildId = process.env.GUILD_ID;
    const channelId = process.env.VOICE_CHANNEL_ID;

    if (!guildId || !channelId) {
        console.warn('----------------------------------------------------');
        console.warn('[UYARI] GUILD_ID veya VOICE_CHANNEL_ID tanımlanmamış!');
        console.warn('Botun ses kanalına girebilmesi için .env veya');
        console.warn('Render paneline bu iki değeri girmelisiniz.');
        console.warn('----------------------------------------------------');
        return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.error(`[HATA] Bot "${guildId}" ID'li sunucuda bulunamadı!`);
        return;
    }

    // Metin kanalını bul veya ayarla
    const textChannelId = process.env.TEXT_CHANNEL_ID;
    if (textChannelId) {
        textChannel = guild.channels.cache.get(textChannelId);
    }
    if (!textChannel) {
        textChannel = guild.channels.cache.find(
            (c) => c.isTextBased() && c.permissionsFor(guild.members.me).has('SendMessages')
        );
    }

    try {
        console.log(`[Ses] Kanala (${channelId}) bağlanılıyor...`);
        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false, // DİKKAT: Sesleri dinleyebilmesi için DEAF FALSE OLMALI!
            selfMute: false  // Ses çıkarabilmesi için MUTE FALSE OLMALI!
        });

        connection.subscribe(audioPlayer);

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('[Ses] Ses kanalına bağlanıldı! Mahmut dinlemede.');
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
            } catch (error) {
                console.log('[Ses] Bağlantı koptu, yeniden bağlanılıyor...');
                try {
                    connection.destroy();
                } catch (e) {}
                setTimeout(connectToVoice, 5000);
            }
        });

        // --- KULLANICI SESLERİNİ DİNLEME ---
        const receiver = connection.receiver;

        receiver.speaking.on('start', (userId) => {
            if (isBotSpeaking) return; // Mahmut konuşurken dinleme
            if (activeUsers.has(userId)) return;

            activeUsers.add(userId);

            const opusStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 800 // 800ms sessizlik olunca cümlenin bittiğini anlar
                }
            });

            const opusDecoder = new prism.opus.Decoder({
                frameSize: 960,
                channels: 2,
                rate: 48000
            });

            const pcmChunks = [];
            opusStream.pipe(opusDecoder);

            opusDecoder.on('data', (chunk) => {
                pcmChunks.push(chunk);
            });

            opusDecoder.on('end', async () => {
                activeUsers.delete(userId);
                if (isBotSpeaking) return;

                const pcmBuffer = Buffer.concat(pcmChunks);
                // 0.5 saniyeden kısa arka plan seslerini/tıklamaları atla
                // 48000Hz * 2 kanal * 2 bayt * 0.5s = 96000 bayt
                if (pcmBuffer.length < 96000) return;

                const member = guild.members.cache.get(userId);
                const speakerName = member?.displayName || member?.user?.username || 'Kanka';

                const wavBuffer = pcmToWav(pcmBuffer);
                const transcript = await transcribeAudio(wavBuffer);

                if (!transcript || transcript === 'BOS') return;

                const lowerText = transcript.toLowerCase();

                // "Mahmut" dendi mi kontrol et
                if (lowerText.includes('mahmut')) {
                    console.log(`[Ses Algılandı] ${speakerName}: "${transcript}"`);

                    // 1. Sadece "Mahmut" veya "Mahmut orada mısın?" dendiyse
                    const isOnlyGreeting =
                        /^(hey\s+)?mahmut[\s?.!]*$/i.test(transcript.trim()) ||
                        /^(mahmut\s+)?(orda\s+mısın|burada\s+mısın|baksana)[\s?.!]*$/i.test(transcript.trim());

                    if (isOnlyGreeting) {
                        await speak(`Efendim ${speakerName}, dinliyorum kanka?`);
                        return;
                    }

                    // 2. Bir soru veya talimat sorulduysa
                    const result = await askMahmutAI(transcript, speakerName);
                    if (result) {
                        if (textChannel && result.chatText) {
                            textChannel.send(`**${speakerName}:** "${transcript}"\n\n**Mahmut:**\n${result.chatText}`).catch(() => {});
                        }
                        if (result.voiceText) {
                            await speak(result.voiceText);
                        }
                    }
                }
            });

            opusDecoder.on('error', () => {
                activeUsers.delete(userId);
            });
        });

    } catch (err) {
        console.error('[HATA] Ses kanalına bağlanırken hata:', err);
    }
}

// -------------------------------------------------------------
// 6. METİN KANALINDA EKRAN GÖRÜNTÜSÜ / FOTOĞRAF YORUMLAMA
// -------------------------------------------------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const lower = message.content.toLowerCase();
    const isMentioned = message.mentions.has(client.user);
    const mentionsMahmut = lower.includes('mahmut');

    // Kanala resim atıldığında ve Mahmut dendiğinde
    if (message.attachments.size > 0 && (mentionsMahmut || isMentioned)) {
        const attachment = message.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            const speakerName = message.member?.displayName || message.author.username;
            const statusMsg = await message.reply('👀 Fotoğrafa bakıyorum kanka, hemen yorumluyorum...');

            const comment = await analyzeImage(attachment.url, message.content, speakerName);
            if (comment) {
                await statusMsg.edit(comment);
                // Ses kanalındaysa sesli de söylesin
                await speak(comment);
            } else {
                await statusMsg.edit('Kanka görseli tam inceleyemedim, bir daha atar mısın?');
            }
            return;
        }
    }

    // Normal metin sorusu geldiğinde
    if (mentionsMahmut || isMentioned) {
        const cleanContent = message.content.replace(/<@!?[0-9]+>/g, '').trim();
        if (!cleanContent) return;

        const speakerName = message.member?.displayName || message.author.username;
        const result = await askMahmutAI(cleanContent, speakerName);
        if (result) {
            await message.reply(result.chatText || result.voiceText);
            if (result.voiceText) {
                await speak(result.voiceText);
            }
        }
    }
});

client.once('ready', () => {
    console.log(`[Discord] Bot başarıyla giriş yaptı: ${client.user.tag}`);
    connectToVoice();
});

if (!process.env.DISCORD_TOKEN) {
    console.error('[HATA] DISCORD_TOKEN bulunamadı!');
} else {
    client.login(process.env.DISCORD_TOKEN).catch((err) => {
        console.error('[HATA] Discord bot giriş hatası:', err.message);
    });
}
