import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';

export default async function handler(req, res) {
  // LIST COMMAND BARU
  const commands = [
    {
      name: 'daftar',
      description: 'Daftar turnamen Violence District',
      options: [
        { 
          name: 'nama', // SUDAH DIGANTI DARI nama_panggilan
          description: 'Nama kamu', 
          type: 3, 
          required: true 
        },
        { 
          name: 'username_roblox', 
          description: 'Username Roblox', 
          type: 3, 
          required: true 
        }
      ]
    },
    {
      name: 'list_peserta',
      description: 'Lihat daftar peserta yang terdaftar'
    },
    {
      name: 'buat_tim',
      description: 'Acak dan bagikan tim'
    },
    {
      name: 'atur_tim',
      description: 'Admin: Atur konfigurasi tim',
      options: [
        { name: 'min', description: 'Minimal per tim', type: 4, required: true },
        { name: 'max', description: 'Maksimal per tim', type: 4, required: true }
      ]
    },
    {
      name: 'reset_data',
      description: 'Admin: Hapus semua data peserta'
    },
    {
      name: 'ping_bot',
      description: 'Cek status bot'
    }
  ];

  try {
    const response = await fetch(
      `https://discord.com/api/v10/applications/${process.env.DISCORD_APP_ID}/commands`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
      }
    );
    
    const data = await response.json();
    return res.status(200).json({ status: 'Command Updated!', data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
