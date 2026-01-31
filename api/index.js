import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import admin from 'firebase-admin';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // --- 1. VERIFIKASI DISCORD ---
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
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

  // --- 2. HANDLE PING ---
  if (message.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // --- 3. INIT FIREBASE DENGAN REPORTING ---
  let db;
  let firebaseError = null;

  try {
    if (!admin.apps.length) {
      // Membersihkan format JSON yang sering rusak saat di-copy
      const cleanJson = process.env.FIREBASE_SERVICE_ACCOUNT
          .replace(/\\n/g, '\n'); // Ganti \n string jadi enter beneran
      
      const serviceAccount = JSON.parse(cleanJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
  } catch (e) {
    console.error("🔥 Firebase Error:", e);
    firebaseError = e.message;
  }

  // --- 4. HANDLE COMMANDS ---
  if (message.type === InteractionType.APPLICATION_COMMAND) {
    // Jika Firebase Error, langsung lapor ke Discord
    if (firebaseError) {
        return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `⚠️ **Sistem Error:** Gagal konek database.\nLog: \`${firebaseError}\`\n\n*Cek Variable FIREBASE_SERVICE_ACCOUNT di Vercel.*` }
        });
    }

    const { name, options } = message.data;

    try {
        // --- COMMAND: TEST PING (Tanpa DB) ---
        if (name === 'ping_bot') {
            return res.status(200).json({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: '🏓 **Pong!** Bot hidup dan siap melayani.' }
            });
        }

        // --- COMMAND: DAFTAR ---
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

        // --- COMMAND: LIST PESERTA ---
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
                   data: { content: `❌ Peserta kurang (Min: ${min}).` }
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

    } catch (err) {
        return res.status(200).json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `❌ **Error Logic:** ${err.message}` }
        });
    }
  }

  return res.status(404).send('Not Found');
}
