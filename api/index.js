import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import admin from 'firebase-admin';

// --- PENTING: Matikan Auto-Parser Vercel agar Signature Discord valid ---
export const config = {
  api: {
    bodyParser: false,
  },
};

// Fungsi bantu untuk membaca Raw Body (Wajib untuk verifikasi Discord)
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // Hanya terima POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // --- 1. VERIFIKASI KEAMANAN (VERSI NODE.JS) ---
  // Perbaikan: Pakai kurung siku [], bukan .get()
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  
  // Baca body manual
  const rawBodyBuffer = await getRawBody(req);
  const rawBodyString = rawBodyBuffer.toString('utf-8');

  const isValidRequest = verifyKey(
    rawBodyString,
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY
  );

  if (!isValidRequest) {
    return res.status(401).send('Bad request signature');
  }

  const message = JSON.parse(rawBodyString);

  // --- 2. HANDLE PING (PENTING BUAT SAVE URL) ---
  if (message.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // --- 3. INIT FIREBASE (ANTI CRASH) ---
  if (!admin.apps.length) {
    try {
      const cleanJson = process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n');
      const serviceAccount = JSON.parse(cleanJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } catch (e) {
      console.error("🔥 Firebase Init Error:", e);
      // Jangan return error 500 disini, biarkan lanjut agar Discord tidak timeout
      // Nanti errornya muncul pas command dijalankan saja
    }
  }
  
  const db = admin.firestore();

  // --- 4. HANDLE COMMANDS ---
  if (message.type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = message.data;

    try {
        // Command: DAFTAR
        if (name === 'daftar') {
          const nama = options.find(o => o.name === 'nama_panggilan').value;
          const roblox = options.find(o => o.name === 'username_roblox').value.replace('@', '');
          const userId = message.member.user.id;

          await db.collection('vd_participants').doc(userId).set({
            discordId: userId,
            nama: nama,
            robloxUsername: roblox,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `✅ **Berhasil Daftar!**\nNama: ${nama}\nRoblox: @${roblox}` }
          });
        }

        // Command: LIST PESERTA
        if (name === 'list_peserta') {
          const snap = await db.collection('vd_participants').orderBy('timestamp').get();
          
          if (snap.empty) {
            return res.status(200).json({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: '*Belum ada peserta.*' }
            });
          }
          
          let listText = snap.docs.map((d, i) => {
              const data = d.data();
              const num = (i + 1).toString().padStart(2, '0');
              return `${num}. [${data.nama}] [@${data.robloxUsername}]`;
          }).join('\n');

          return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `**📋 LIST PESERTA (${snap.size})**\n\`\`\`ini\n${listText}\n\`\`\`` }
          });
        }

        // Command: BUAT TIM
        if (name === 'buat_tim') {
           const configSnap = await db.collection('vd_settings').doc('config').get();
           const min = configSnap.exists ? configSnap.data().minTeam : 4;
           const max = configSnap.exists ? configSnap.data().maxTeam : 6;
           
           const snap = await db.collection('vd_participants').get();
           let players = snap.docs.map(d => d.data());

           if (players.length < min) {
               return res.status(200).json({
                   type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                   data: { content: `❌ Peserta kurang (Min: ${min}).` }
               });
           }

           // Shuffle
           for (let i = players.length - 1; i > 0; i--) {
               const j = Math.floor(Math.random() * (i + 1));
               [players[i], players[j]] = [players[j], players[i]];
           }

           // Bagi Tim
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

           let output = `**🎲 HASIL REROLL TIM**\n`;
           teams.forEach((t, i) => {
               const members = t.map(p => `• ${p.nama} (@${p.robloxUsername})`).join('\n');
               output += `\n**Tim #${i+1} (${t.length} Orang)**\n\`\`\`\n${members}\n\`\`\``;
           });

           return res.status(200).json({
               type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
               data: { content: output }
           });
        }

        // Command: ATUR TIM
        if (name === 'atur_tim') {
            const min = options.find(o => o.name === 'min').value;
            const max = options.find(o => o.name === 'max').value;
            await db.collection('vd_settings').doc('config').set({ minTeam: min, maxTeam: max });
            return res.status(200).json({
               type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
               data: { content: `⚙️ Setting diupdate: Min ${min}, Max ${max}.` }
            });
        }

    } catch (err) {
        console.error("Command Error:", err);
        return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `❌ Terjadi error: ${err.message}` }
        });
    }
  }

  return res.status(404).send('Not Found');
}
