# Discord 7/24 Ses Botu & Render.com Dağıtımı

Bu proje, Discord üzerinde belirlediğiniz bir ses kanalında 7/24 bağlı kalan ve Render.com ücretsiz Web Service gereksinimlerini (port dinleme + HTTP yanıtı) karşılayan bir bottur.

---

## 1. Gerekli Bilgileri Alma

1. **Discord Geliştirici Modunu Açın:**
   - Discord Ayarları -> Gelişmiş -> **Geliştirici Modu** seçeneğini açık yapın.
2. **Sunucu ID (`GUILD_ID`):**
   - Sunucu simgesine sağ tıklayın -> **Sunucu Kimliğini Kopyala**.
3. **Ses Kanalı ID (`VOICE_CHANNEL_ID`):**
   - Botun girmesini istediğiniz ses kanalına sağ tıklayın -> **Kanal Kimliğini Kopyala**.

---

## 2. GitHub'a Yükleme

1. GitHub'da `discord-voice-bot` adında yeni bir **Private (Gizli)** depo açın.
2. Bu klasörü deponuza pushlayın:
   ```bash
   git init
   git add .
   git commit -m "İlk kurulum"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADINIZ/discord-voice-bot.git
   git push -u origin main
   ```

---

## 3. Render.com Kurulumu

1. [Render.com](https://render.com) hesabınıza girin.
2. **New +** -> **Web Service** seçin.
3. GitHub deponuzu bağlayın.
4. Ayarlar:
   - **Name:** `discord-ses-botu`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. **Environment Variables** bölümüne şu 3 değeri ekleyin:
   - `DISCORD_TOKEN` = Botunuzun tokeni
   - `GUILD_ID` = Sunucu ID'niz
   - `VOICE_CHANNEL_ID` = Ses kanalı ID'niz
6. **Create Web Service** butonuna basın.

---

## 4. UptimeRobot ile 7/24 Aktif Tutma

1. Render botu derledikten sonra size bir link verir: `https://discord-ses-botu-xxxx.onrender.com`
2. [UptimeRobot.com](https://uptimerobot.com) adresine gidin.
3. **Add New Monitor** seçin:
   - **Monitor Type:** `HTTP(s)`
   - **URL:** Render'ın size verdiği adres
   - **Monitoring Interval:** `5 minutes`
4. Kaydedin. UptimeRobot 5 dakikada bir istek atarak Render'ın botu uyutmasını engeller.
