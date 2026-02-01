import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import admin from 'firebase-admin';

export const config = {
  api: {
    bodyParser: false,
  },
};

// --- KONFIGURASI TAMPILAN ---
const THEME_COLOR = 0x2B2D31; // Warna Dark Minimalis

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // 1. Verifikasi Signature
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const rawBodyBuffer = await getRawBody(req);
  const rawBodyString = rawBodyBuffer.toString('utf-8');

  const isValidRequest = verifyKey(
    rawBodyString, signature, timestamp, process.env.DISCORD_PUBLIC_KEY
  );

  if (!isValidRequest) return res.status(401).send('Bad request signature');

  const message = JSON.parse(rawBodyString);

  // 2. Handle Ping
  if (message.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // 3. Init Firebase
  let db;
  let firebaseError = null;
  try {
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
  } catch (e) {
    console.error("Firebase Error:", e);
    firebaseError = e.message;
  }

  // 4. Handle Commands
  if (message.type === InteractionType.APPLICATION_COMMAND) {
    if (firebaseError) {
        return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `⚠️ **Database Error**\n\`${firebaseError}\`` }
        });
    }

    const { name, options } = message.data;
    const user = message.member.user;

    try {
        // --- COMMAND: PING ---
        if (name === 'ping_bot') {
            return res.status(200).json({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: '🏓 **Pong!** Sistem online.' }
            });
        }

        // --- COMMAND: DAFTAR (FIX: BISA BACA NAMA LAMA & BARU) ---
        if (name === 'daftar') {
          // LOGIKA ANTI-ERROR: Cari 'nama' ATAU 'nama_panggilan'
          // Jadi kalau Discord masih kirim 'nama_panggilan', bot tetap paham.
          const namaOption = options.find(o => o.name === 'nama' || o.name === 'nama_panggilan');
          const robloxOption = options.find(o => o.name === 'username_roblox');

          // Cek jika data entah kenapa kosong
          if (!namaOption || !robloxOption) {
             return res.status(200).json({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: `⚠️ **Gagal Membaca Data.** Mohon tunggu sebentar lalu coba lagi.` }
             });
          }

          const namaInput = namaOption.value;
          const robloxInput = robloxOption.value.replace('@', '');

          // Simpan ke DB (Anti Duplikat: Update data user yang sama)
          await db.collection('vd_participants').doc(user.id).set({
            discordId: user.id,
            nama: namaInput,
            robloxUsername: robloxInput,
            avatar: user.avatar,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          // Tampilan Elegant Minimalis
          return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                embeds: [{
                    title: "PENDAFTARAN BERHASIL",
                    description: "Data kamu telah diperbarui di database.",
                    color: THEME_COLOR,
                    thumbnail: { url: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null },
                    fields: [
                        { name: "Nama", value: `\`${namaInput}\``, inline: true },
                        { name: "Roblox", value: `\`@${robloxInput}\``, inline: true }
                    ],
                    footer: { text: "Violence District Tournament" }
                }]
            }
          });
        }

        // --- COMMAND: LIST PESERTA ---
        if (name === 'list_peserta') {
          const snap = await db.collection('vd_participants').orderBy('timestamp').get();
          
          if (snap.empty) {
            return res.status(200).json({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: '*Belum ada peserta yang mendaftar.*' }
            });
          }
          
          let table = "NO  NAMA            ROBLOX\n";
          table += "--  --------------  --------------\n";
          
          snap.docs.forEach((doc, index) => {
              const d = doc.data();
              const no = (index + 1).toString().padStart(2, '0');
              const nama = d.nama.padEnd(14, ' ').substring(0, 14); 
              const rblx = ("@" + d.robloxUsername).substring(0, 14);
              table += `${no}  ${nama}  ${rblx}\n`;
          });

          return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                embeds: [{
                    title: `DAFTAR PESERTA (${snap.size})`,
                    description: `\`\`\`js\n${table}\n\`\`\``,
                    color: THEME_COLOR,
                    footer: { text: "Menunggu peserta lain..." }
                }]
            }
          });
        }

        // --- COMMAND: BUAT TIM ---
        if (name === 'buat_tim') {
           const configSnap = await db.collection('vd_settings').doc('config').get();
           const min = configSnap.exists ? configSnap.data().minTeam : 4;
           const max = configSnap.exists ? configSnap.data().maxTeam : 6;
           
           const snap = await db.collection('vd_participants').get();
           let players = snap.docs.map(d => d.data());

           if (players.length < min) {
               return res.status(200).json({
                   type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                   data: { content: `⚠️ **Gagal Reroll:** Peserta kurang dari ${min}. Total saat ini: ${players.length}.` }
               });
           }

           // Shuffle
           for (let i = players.length - 1; i > 0; i--) {
               const j = Math.floor(Math.random() * (i + 1));
               [players[i], players[j]] = [players[j], players[i]];
           }

           let teams = [];
           let current = [];
           players.forEach(p => {
               current.push(p);
               if (current.length === max) {
                   teams.push(current);
                   current = [];
               }
           });
           if (current.length > 0) teams.push(current);

           const fields = teams.map((t, i) => {
               const list = t.map(p => `• ${p.nama}`).join('\n');
               return {
                   name: `Tim ${i+1} (${t.length})`,
                   value: `\`\`\`\n${list}\n\`\`\``,
                   inline: true
               };
           });

           return res.status(200).json({
               type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
               data: {
                   embeds: [{
                       title: "🎲 HASIL PEMBAGIAN TIM",
                       description: `Total: ${players.length} Peserta | Mode: ${min}-${max} Player`,
                       color: 0x5865F2,
                       fields: fields
                   }]
               }
           });
        }
        
        // --- COMMAND: ATUR TIM ---
        if (name === 'atur_tim') {
            const min = options.find(o => o.name === 'min').value;
            const max = options.find(o => o.name === 'max').value;
            await db.collection('vd_settings').doc('config').set({ minTeam: min, maxTeam: max });
            
            return res.status(200).json({
               type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
               data: { content: `⚙️ **Konfigurasi Disimpan:**\nMin: \`${min}\` | Max: \`${max}\`` }
            });
        }
        
        // --- COMMAND: RESET ---
        if (name === 'reset_data') {
            const snap = await db.collection('vd_participants').get();
            const batch = db.batch();
            snap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            
            return res.status(200).json({
               type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
               data: { content: `🗑️ **Database Dibersihkan.** Siap untuk turnamen baru.` }
            });
        }

    } catch (err) {
        console.error(err);
        return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `❌ Error: ${err.message}` }
        });
    }
  }

  return res.status(404).send('Not Found');
}
