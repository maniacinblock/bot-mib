// api/index.js
import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import admin from 'firebase-admin';

// --- SETUP FIREBASE (Serverless Mode) ---
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error("Firebase Error:", e);
  }
}
const db = admin.firestore();

// --- UTILS ---
function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- MAIN HANDLER VERCEL ---
export default async function handler(req) {
  // 1. Verifikasi Keamanan (Wajib di Vercel)
  const signature = req.headers.get('x-signature-ed25519');
  const timestamp = req.headers.get('x-signature-timestamp');
  const rawBody = await req.text();

  const isValidRequest = verifyKey(
    rawBody,
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY
  );

  if (!isValidRequest) {
    return new Response('Bad request signature', { status: 401 });
  }

  const message = JSON.parse(rawBody);

  // 2. Handle PING dari Discord (Wajib)
  if (message.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  // 3. Handle COMMANDS
  if (message.type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = message.data;

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

      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `✅ **Berhasil Daftar!**\nNama: ${nama}\nRoblox: @${roblox}` }
      });
    }

    // --- COMMAND: LIST PESERTA ---
    if (name === 'list_peserta') {
      const snap = await db.collection('vd_participants').orderBy('timestamp').get();
      
      if (snap.empty) {
        return jsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '*Belum ada peserta.*' }
        });
      }

      let listText = snap.docs.map((d, i) => {
          const data = d.data();
          const num = (i + 1).toString().padStart(2, '0');
          return `${num}. [${data.nama}] [@${data.robloxUsername}]`;
      }).join('\n');

      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: `**📋 LIST PESERTA (${snap.size})**\n\`\`\`ini\n${listText}\n\`\`\``
        }
      });
    }

    // --- COMMAND: BUAT TIM (REROLL) ---
    if (name === 'buat_tim') {
       // Ambil data
       const configSnap = await db.collection('vd_settings').doc('config').get();
       const min = configSnap.exists ? configSnap.data().minTeam : 4;
       const max = configSnap.exists ? configSnap.data().maxTeam : 6;
       
       const snap = await db.collection('vd_participants').get();
       let players = snap.docs.map(d => d.data());

       if (players.length < min) {
           return jsonResponse({
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

       // Format Text Output (Embeds susah di raw json, kita pakai text formatted aja biar aman di Vercel)
       let output = `**🎲 HASIL REROLL TIM**\n`;
       teams.forEach((t, i) => {
           const members = t.map(p => `• ${p.nama} (@${p.robloxUsername})`).join('\n');
           output += `\n**Tim #${i+1} (${t.length} Orang)**\n\`\`\`\n${members}\n\`\`\``;
       });

       return jsonResponse({
           type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
           data: { content: output }
       });
    }
    
    // --- COMMAND: ATUR TIM ---
    if (name === 'atur_tim') {
        // Cek Admin manual karena req.member.permissions itu bitfield (rumit), kita bypass dulu logic permission sederhana
        // Disarankan set permission di Discord Server Settings > Integrations saja biar aman.
        const min = options.find(o => o.name === 'min').value;
        const max = options.find(o => o.name === 'max').value;
        
        await db.collection('vd_settings').doc('config').set({ minTeam: min, maxTeam: max });
        
        return jsonResponse({
           type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
           data: { content: `⚙️ Setting diupdate: Min ${min}, Max ${max}.` }
        });
    }
  }

  return new Response('Unknown Command', { status: 404 });
}
