// api/index.js
import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import admin from 'firebase-admin';

export default async function handler(req) {
  // --- 1. VERIFIKASI KEAMANAN (WAJIB JALAN DULUAN) ---
  const signature = req.headers.get('x-signature-ed25519');
  const timestamp = req.headers.get('x-signature-timestamp');
  const rawBody = await req.text();

  // Pastikan request dari Discord asli
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

  // --- 2. HANDLE PING (INI YANG MEMBUAT SAVE URL BERHASIL) ---
  // Kita balas PONG dulu sebelum menyentuh Firebase
  if (message.type === InteractionType.PING) {
    return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- 3. BARU INIT FIREBASE (SETELAH PING SELESAI) ---
  // Jadi kalau firebase error, bot tidak crash saat verifikasi URL
  if (!admin.apps.length) {
    try {
      // Membersihkan format JSON dari spasi/enter aneh (Penyebab umum error)
      const cleanJson = process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n');
      const serviceAccount = JSON.parse(cleanJson);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } catch (e) {
      console.error("🔥 FIREBASE ERROR (Cek Env Variable):", e);
      return new Response('Internal Server Error: Database Config', { status: 500 });
    }
  }
  
  const db = admin.firestore();

  // --- 4. HANDLE COMMANDS ---
  if (message.type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = message.data;

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

      return new Response(JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `✅ **Berhasil Daftar!**\nNama: ${nama}\nRoblox: @${roblox}` }
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Command: LIST PESERTA
    if (name === 'list_peserta') {
      const snap = await db.collection('vd_participants').orderBy('timestamp').get();
      if (snap.empty) {
        return new Response(JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '*Belum ada peserta.*' }
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      
      let listText = snap.docs.map((d, i) => {
          const data = d.data();
          const num = (i + 1).toString().padStart(2, '0');
          return `${num}. [${data.nama}] [@${data.robloxUsername}]`;
      }).join('\n');

      return new Response(JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `**📋 LIST PESERTA (${snap.size})**\n\`\`\`ini\n${listText}\n\`\`\`` }
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Command: BUAT TIM
    if (name === 'buat_tim') {
       const configSnap = await db.collection('vd_settings').doc('config').get();
       const min = configSnap.exists ? configSnap.data().minTeam : 4;
       const max = configSnap.exists ? configSnap.data().maxTeam : 6;
       
       const snap = await db.collection('vd_participants').get();
       let players = snap.docs.map(d => d.data());

       if (players.length < min) {
           return new Response(JSON.stringify({
               type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
               data: { content: `❌ Peserta kurang (Min: ${min}).` }
           }), { headers: { 'Content-Type': 'application/json' } });
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

       return new Response(JSON.stringify({
           type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
           data: { content: output }
       }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response('Unknown Command', { status: 404 });
}
