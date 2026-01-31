// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const admin = require('firebase-admin');
const express = require('express');

// --- SETUP WEB SERVER (AGAR BISA 24/7 DI RENDER) ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot Violence District is Online!');
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

// --- SETUP FIREBASE ---
// Membaca key dari Environment Variable Render (bukan file json fisik)
// Pastikan nanti di Render memasukkan isinya dengan benar
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
    console.error("Gagal membaca FIREBASE_SERVICE_ACCOUNT. Pastikan format JSON benar.", e);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const membersCollection = db.collection('vd_participants');
const settingsCollection = db.collection('vd_settings');

// --- SETUP DISCORD ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('daftar')
    .setDescription('Daftar turnamen Violence District')
    .addStringOption(o => o.setName('nama_panggilan').setDescription('Nama Panggilan').setRequired(true))
    .addStringOption(o => o.setName('username_roblox').setDescription('Username Roblox').setRequired(true)),

  new SlashCommandBuilder()
    .setName('list_peserta')
    .setDescription('Lihat list peserta'),

  new SlashCommandBuilder()
    .setName('atur_tim')
    .setDescription('Admin: Atur jumlah anggota per tim')
    .addIntegerOption(o => o.setName('min').setDescription('Minimal').setRequired(true))
    .addIntegerOption(o => o.setName('max').setDescription('Maksimal').setRequired(true)),

  new SlashCommandBuilder()
    .setName('buat_tim')
    .setDescription('Acak peserta menjadi tim'),

  new SlashCommandBuilder()
    .setName('reset_data')
    .setDescription('Admin: Hapus semua data')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`Bot online sebagai ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'daftar') {
    const nama = interaction.options.getString('nama_panggilan');
    const roblox = interaction.options.getString('username_roblox');
    await interaction.deferReply();
    try {
        await membersCollection.doc(interaction.user.id).set({
            discordId: interaction.user.id,
            nama: nama,
            robloxUsername: roblox,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        await interaction.editReply(`✅ Terdaftar: **${nama}** (${roblox})`);
    } catch (e) {
        console.error(e);
        await interaction.editReply(`❌ Error Database.`);
    }
  }

  else if (commandName === 'list_peserta') {
    await interaction.deferReply();
    const snap = await membersCollection.orderBy('timestamp').get();
    if (snap.empty) return interaction.editReply('Belum ada peserta.');
    
    let text = snap.docs.map((d, i) => `${i+1}. ${d.data().nama} (${d.data().robloxUsername})`).join('\n');
    const embed = new EmbedBuilder().setTitle('Peserta').setDescription(text).setColor(0xFF0000);
    await interaction.editReply({ embeds: [embed] });
  }

  else if (commandName === 'atur_tim') {
    if (!interaction.member.permissions.has('Administrator')) return interaction.reply({content: '❌ Admin Only', ephemeral: true});
    const min = interaction.options.getInteger('min');
    const max = interaction.options.getInteger('max');
    if (min > max) return interaction.reply('❌ Min > Max? Ngaco.');
    
    await settingsCollection.doc('config').set({ minTeam: min, maxTeam: max });
    await interaction.reply(`⚙️ Setting Tim: ${min}-${max} orang.`);
  }

  else if (commandName === 'buat_tim') {
    await interaction.deferReply();
    const configSnap = await settingsCollection.doc('config').get();
    const min = configSnap.exists ? configSnap.data().minTeam : 4;
    const max = configSnap.exists ? configSnap.data().maxTeam : 6;

    const snap = await membersCollection.get();
    let players = snap.docs.map(d => d.data());
    
    if (players.length < min) return interaction.editReply(`❌ Peserta kurang (Min ${min}).`);

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
    if (current.length > 0) teams.push(current); // Sisa masuk tim terakhir

    const embed = new EmbedBuilder().setTitle('🎲 Hasil Tim').setColor(0x00FF00);
    teams.forEach((t, i) => {
        embed.addFields({ name: `Tim ${i+1} (${t.length})`, value: t.map(p => p.nama).join(', '), inline: true });
    });
    await interaction.editReply({ embeds: [embed] });
  }

  else if (commandName === 'reset_data') {
      if (!interaction.member.permissions.has('Administrator')) return interaction.reply('❌ Admin Only');
      await interaction.deferReply();
      const snap = await membersCollection.get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      await interaction.editReply('🗑️ Data dihapus.');
  }
});

client.login(process.env.DISCORD_TOKEN);
