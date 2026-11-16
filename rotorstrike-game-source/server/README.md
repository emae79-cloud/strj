# ROTOR STRIKE — Çevrimiçi sunucu

Bu Node.js `ws` servisi 6 karakterli, geçici ve en çok iki pilotlu odalar açar. Oda üyeliği, 4 can, isabet başına hasar, 6,5 atış/sn tavanı ve 28 mermilik / tam 5 saniyelik doldurma sunucuda tutulur. Hareket yerelde gecikmesiz yürür; kabul edilen konumlar diğer pilota yumuşatılarak gösterilir. Bu hafif hakem modeli arkadaşlarla gündelik oyun içindir; rekabetçi/ödüllü anti-cheat sunucusu değildir.

## Render'a kurulum (manuel)

1. Proje dosyalarını kendi Git deposuna yükle. Render'da **New → Blueprint** seçip deponun kökündeki `render.yaml` dosyasını kullan. Bu işlem burada yapılmadı.
2. Render senden `ALLOWED_ORIGINS` değerini istediğinde, oyunun gerçek HTTPS kökenini virgülle ayırarak gir: `https://rotorstrike-tjhmkzac.manus.game`. Preview'dan bağlanacaksan onun gerçek HTTPS kökenini de ekle. Sonunda `/` veya yol yazma. Bu allowlist olmadan farklı kökenden WebSocket bağlantısı kabul edilmez.
3. Servis hazır olduktan sonra Render'ın verdiği gerçek hostu al. `https://<gerçek-host>/healthz` adresi 200 ve `ok:true` vermeli; TLS'li socket adresi `wss://<gerçek-host>/ws` olur. Hostu tahmin etme veya `ws://` kullanma.
4. Oyunun `public/multiplayer/bootstrap.json` dosyasını **gerçek WSS hostu geldikten sonra** oluştur:

```json
{"version":1,"build":"rotor-strike-pvp-v1","signalingUrl":"wss://<GERÇEK-RENDER-HOST>/ws"}
```

5. Oyunun statik sürümünü ayrıca yayımla. Bu repodaki oyun sayfası henüz bu değişikliklerle yayımlanmadı. Test veya yayınlama burada yapılmadı.

Render Free 15 dakika trafik gelmezse uyur; bir sonraki katılım ilk bağlantıda yaklaşık bir dakika bekleyebilir. Odalar bellek içidir; uyku, restart veya deploy sırasında sıfırlanır. Bağlantı 60 saniyeye kadar aynı sekmede tekrar denenir. Herhangi bir veritabanı, kullanıcı hesabı veya ödeme yoktur.

## Yerel sunucu çalıştırma

Node.js 22+ gerekir. `server/` dizininde `npm ci`, ardından `npm start` çalıştır. Yerel WSS/HTTPS sertifikası ayrıca kurulmadıkça tarayıcıdaki yayımlanmış HTTPS oyun sayfası `ws://` ile bağlanamaz; gerçek internet multiplayer için Render'ın TLS adresi ve yukarıdaki bootstrap dosyası gerekir.
