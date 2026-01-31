// api/setup.js
export default async function handler(req, res) {
  const commands = [
    {
      name: 'daftar',
      description: 'Daftar turnamen',
      options: [
        { name: 'nama_panggilan', description: 'Nama', type: 3, required: true },
        { name: 'username_roblox', description: 'Username Roblox', type: 3, required: true }
      ]
    },
    {
      name: 'list_peserta',
      description: 'Lihat peserta'
    },
    {
      name: 'buat_tim',
      description: 'Acak tim'
    },
    {
      name: 'atur_tim',
      description: 'Atur jumlah tim (Admin)',
      options: [
        { name: 'min', description: 'Minimal', type: 4, required: true },
        { name: 'max', description: 'Maksimal', type: 4, required: true }
      ]
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
    return res.status(200).json({ status: 'Sukses mendaftarkan command!', data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
