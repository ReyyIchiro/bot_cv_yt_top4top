require('dotenv').config();

const {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ensureTempDir, cleanupOldFiles } = require('./utils/tempFiles');

// ────────────────────────────────────────────
// Validasi environment variables
// ────────────────────────────────────────────
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    '❌ Missing environment variables. Pastikan DISCORD_TOKEN, CLIENT_ID, dan GUILD_ID ada di .env'
  );
  process.exit(1);
}

// ────────────────────────────────────────────
// Startup checks
// ────────────────────────────────────────────

// Cek yt-dlp
try {
  const ytdlpVersion = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
  console.log(`✅ yt-dlp ditemukan: v${ytdlpVersion}`);
} catch {
  console.warn(
    '⚠️  WARNING: yt-dlp tidak ditemukan di PATH!\n' +
    '   Install: pip install yt-dlp\n' +
    '   Atau download dari: https://github.com/yt-dlp/yt-dlp\n' +
    '   Command /yt2samp tidak akan berfungsi tanpa yt-dlp.'
  );
}

// Pastikan folder temp/ ada
ensureTempDir();

// ────────────────────────────────────────────
// Discord Client
// ────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Collection untuk menyimpan commands
client.commands = new Collection();

// Load commands dari folder commands/
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`📦 Command loaded: /${command.data.name}`);
  } else {
    console.warn(`⚠️  Command ${file} tidak punya 'data' atau 'execute', dilewati.`);
  }
}

// ────────────────────────────────────────────
// Register slash commands ke Discord (guild-based)
// ────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const commandsData = client.commands.map((cmd) => cmd.data.toJSON());

  try {
    console.log(`🔄 Registering ${commandsData.length} slash command(s)...`);

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commandsData,
    });

    console.log('✅ Slash commands berhasil didaftarkan!');
  } catch (err) {
    console.error('❌ Gagal register slash commands:', err);
  }
}

// ────────────────────────────────────────────
// Event Handlers
// ────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n🤖 Bot online sebagai: ${client.user.tag}`);
  console.log(`📡 Guilds: ${client.guilds.cache.size}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Register commands saat bot ready
  await registerCommands();

  // Scheduled cleanup setiap 30 menit
  setInterval(() => {
    cleanupOldFiles();
  }, 30 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`⚠️  Command tidak dikenal: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Error executing /${interaction.commandName}:`, err);

    const errorMsg = { content: '❌ Terjadi error saat menjalankan command.', ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMsg).catch(() => {});
    } else {
      await interaction.reply(errorMsg).catch(() => {});
    }
  }
});

// ────────────────────────────────────────────
// Graceful shutdown
// ────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Bot shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Bot shutting down (SIGTERM)...');
  client.destroy();
  process.exit(0);
});

// ────────────────────────────────────────────
// Login
// ────────────────────────────────────────────
client.login(DISCORD_TOKEN);
