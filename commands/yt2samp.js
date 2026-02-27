const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { processYt2Samp } = require('../services/yt2samp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('yt2samp')
    .setDescription('Konversi video YouTube menjadi link audio untuk Boombox GTA SA-MP')
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription('Link YouTube yang ingin dikonversi')
        .setRequired(true)
    ),

  async execute(interaction) {
    const youtubeUrl = interaction.options.getString('url');
    const userId = interaction.user.id;

    // Defer reply — proses bisa lama
    await interaction.deferReply();

    try {
      const result = await processYt2Samp(youtubeUrl, userId);

      // GTA SA-MP hanya support http, bukan https
      const httpLink = result.directLink.replace('https://', 'http://');

      const embed = new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle('🎵 Siap dimainkan di Boombox!')
        .setDescription(
          [
            `🎬 **${result.title}**`,
            `⏱️ Durasi: ${result.duration} • 🎥 [YouTube](${result.youtubeUrl})`,
            '',
            '**📎 Link Boombox (copy ini):**',
            `\`\`\`${httpLink}\`\`\``,
            '📋 `/boombox place` → `/boombox url ${httpLink}`',
          ].join('\n')
        )
        .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(`[yt2samp] Error untuk user ${userId}:`, err.message);

      // Pesan error user-friendly
      const errorEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Gagal memproses')
        .setDescription(err.message)
        .setFooter({ text: 'Coba lagi nanti atau gunakan URL yang berbeda.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {
        // Jika editReply juga gagal (misalnya interaction expired)
        console.error('[yt2samp] Gagal mengirim pesan error ke Discord.');
      });
    }
  },
};
