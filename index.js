const Discord = require('discord.js');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, WebhookClient } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent
  ]
});

// ==================== EXPRESS SERVER ====================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  if (client.isReady()) {
    res.status(200).send('🤖 C.L. StudioWorks Bot is running!');
  } else {
    res.status(503).send('❌ Bot is not connected');
  }
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// ==================== DATABASE SCHEMAS ====================

// Guild Configuration Schema
const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  roles: {
    member: String,
    mod: String,
    executiveMod: String,
    admin: String
  },
  logs: {
    moderation: String,
    server: String,
    member: String,
    channel: String,
    message: String
  },
  logWebhooks: {
    server: String,
    member: String,
    channel: String,
    message: String
  },
  welcome: {
    enabled: { type: Boolean, default: false },
    channelId: String,
    title: String,
    description: String,
    color: String,
    imageUrl: String
  },
  goodbye: {
    enabled: { type: Boolean, default: false },
    channelId: String,
    title: String,
    description: String,
    color: String,
    imageUrl: String
  },
  stickyMessages: [{
    channelId: String,
    content: String,
    delay: { type: Number, default: 5000 },
    lastMessageId: String
  }],
  autoResponders: [{
    trigger: String,
    response: String,
    caseSensitive: { type: Boolean, default: false },
    deleteAfter: { type: Number, default: 0 } // 0 means don't delete
  }]
});

// Warning Schema
const warningSchema = new mongoose.Schema({
  caseId: String,
  guildId: String,
  userId: String,
  moderatorId: String,
  reason: String,
  timestamp: { type: Date, default: Date.now },
  expiresAt: Date,
  attachments: [String],
  dmSent: Boolean,
  showModerator: Boolean,
  expired: { type: Boolean, default: false }
});

// Moderation Action Schema
const modActionSchema = new mongoose.Schema({
  caseId: String,
  guildId: String,
  userId: String,
  moderatorId: String,
  action: String, // 'kick', 'ban', 'timeout', 'warn', 'unban'
  reason: String,
  duration: Number,
  timestamp: { type: Date, default: Date.now },
  expiresAt: Date,
  expired: { type: Boolean, default: false }
});

// Temporary Ban Schema
const tempBanSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  moderatorId: String,
  reason: String,
  expiresAt: Date,
  createdAt: { type: Date, default: Date.now }
});

const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);
const Warning = mongoose.model('Warning', warningSchema);
const ModAction = mongoose.model('ModAction', modActionSchema);
const TempBan = mongoose.model('TempBan', tempBanSchema);

// ==================== MONGODB CONNECTION ====================
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// ==================== GIVEAWAY DATA ====================
const activeGiveaways = new Map();

// ==================== HELPER FUNCTIONS ====================

async function getGuildConfig(guildId) {
  let config = await GuildConfig.findOne({ guildId });
  if (!config) {
    config = new GuildConfig({ guildId });
    await config.save();
  }
  return config;
}

async function generateCaseId(guildId) {
  const count = await ModAction.countDocuments({ guildId }) + await Warning.countDocuments({ guildId });
  return `${guildId.slice(-4)}-${(count + 1).toString().padStart(4, '0')}`;
}

function hasPermission(member, requiredRole, config) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  
  const roleHierarchy = {
    member: 1,
    mod: 2,
    executiveMod: 3,
    admin: 4
  };
  
  const requiredLevel = roleHierarchy[requiredRole] || 0;
  
  for (const [roleName, roleId] of Object.entries(config.roles)) {
    if (roleId && member.roles.cache.has(roleId)) {
      if (roleHierarchy[roleName] >= requiredLevel) return true;
    }
  }
  
  return false;
}

async function sendLog(guild, logType, embed, config) {
  if (logType === 'moderation' && config.logs.moderation) {
    const channel = guild.channels.cache.get(config.logs.moderation);
    if (channel) await channel.send({ embeds: [embed] });
  } else {
    const webhookUrl = config.logWebhooks[logType];
    const channelId = config.logs[logType];
    
    if (webhookUrl) {
      try {
        const webhook = new WebhookClient({ url: webhookUrl });
        await webhook.send({ embeds: [embed] });
      } catch (err) {
        console.error(`Error sending webhook log: ${err}`);
      }
    } else if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel) await channel.send({ embeds: [embed] });
    }
  }
}

function parseDuration(str) {
  const regex = /(\d+)([smhd])/;
  const match = str.match(regex);
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ==================== SLASH COMMANDS ====================

const commands = [
  // Utility Commands
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),
  
  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Get information about a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to look up')
        .setRequired(true)),
  
  // Moderation Commands
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to kick')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for kicking')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('dm_user')
        .setDescription('Send a DM to the user?')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('show_moderator')
        .setDescription('Show moderator name in DM?')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof1')
        .setDescription('Evidence attachment 1')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof2')
        .setDescription('Evidence attachment 2')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof3')
        .setDescription('Evidence attachment 3')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof4')
        .setDescription('Evidence attachment 4')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof5')
        .setDescription('Evidence attachment 5')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof6')
        .setDescription('Evidence attachment 6')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to ban')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for banning')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration for temporary ban (e.g., 1h, 1d, 7d)')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('dm_user')
        .setDescription('Send a DM to the user?')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('show_moderator')
        .setDescription('Show moderator name in DM?')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof1')
        .setDescription('Evidence attachment 1')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof2')
        .setDescription('Evidence attachment 2')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof3')
        .setDescription('Evidence attachment 3')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof4')
        .setDescription('Evidence attachment 4')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof5')
        .setDescription('Evidence attachment 5')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof6')
        .setDescription('Evidence attachment 6')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to timeout')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for timeout')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server')
    .addStringOption(option =>
      option.setName('user_id')
        .setDescription('The user ID to unban')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for unbanning')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('dm_user')
        .setDescription('Send a DM to the user?')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('show_moderator')
        .setDescription('Show moderator name in DM?')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove timeout from a member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to remove timeout from')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing timeout')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to warn')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for warning')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration until warning expires (e.g., 7d, 30d)')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('dm_user')
        .setDescription('Send a DM to the user?')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('show_moderator')
        .setDescription('Show moderator name in DM?')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof1')
        .setDescription('Evidence attachment 1')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof2')
        .setDescription('Evidence attachment 2')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof3')
        .setDescription('Evidence attachment 3')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof4')
        .setDescription('Evidence attachment 4')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof5')
        .setDescription('Evidence attachment 5')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('proof6')
        .setDescription('Evidence attachment 6')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('moderations')
    .setDescription('View or edit moderation history')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View moderation history for a user')
        .addStringOption(option =>
          option.setName('user_id')
            .setDescription('User ID or mention')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit a moderation case')
        .addStringOption(option =>
          option.setName('case_id')
            .setDescription('The case ID to edit')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('New reason')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('New duration (e.g., 7d, 30d)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a moderation case')
        .addStringOption(option =>
          option.setName('case_id')
            .setDescription('The case ID to delete')
            .setRequired(true))),
  
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)),
  
  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode for the channel')
    .addIntegerOption(option =>
      option.setName('seconds')
        .setDescription('Slowmode duration in seconds (0 to disable)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)),
  
  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock channels')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Lock or unlock')
        .setRequired(true)
        .addChoices(
          { name: 'Lock', value: 'lock' },
          { name: 'Unlock', value: 'unlock' }
        ))
    .addStringOption(option =>
      option.setName('scope')
        .setDescription('What to lock')
        .setRequired(true)
        .addChoices(
          { name: 'Current Channel', value: 'channel' },
          { name: 'Entire Server', value: 'server' }
        ))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Specific channel (only for Current Channel scope)')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot say something'),
  
  // Giveaway Commands
  new SlashCommandBuilder()
    .setName('gstart')
    .setDescription('Start a giveaway')
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration (e.g., 1m, 1h, 1d)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('prize')
        .setDescription('What are you giving away?')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('winners')
        .setDescription('Number of winners')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(20))
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Embed color (hex code, e.g., #FF0000)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('image')
        .setDescription('Image URL')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('Custom emoji for button (emoji or emoji ID)')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('greroll')
    .setDescription('Reroll a giveaway')
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('The giveaway message ID')
        .setRequired(true)),
  
  // Configuration Commands
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings')
    .addSubcommandGroup(group =>
      group.setName('roles')
        .setDescription('Configure role permissions')
        .addSubcommand(sub =>
          sub.setName('member')
            .setDescription('Set the member role')
            .addRoleOption(option =>
              option.setName('role')
                .setDescription('The member role')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('mod')
            .setDescription('Set the moderator role')
            .addRoleOption(option =>
              option.setName('role')
                .setDescription('The moderator role')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('executivemod')
            .setDescription('Set the executive moderator role')
            .addRoleOption(option =>
              option.setName('role')
                .setDescription('The executive moderator role')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('admin')
            .setDescription('Set the admin role')
            .addRoleOption(option =>
              option.setName('role')
                .setDescription('The admin role')
                .setRequired(true))))
    .addSubcommandGroup(group =>
      group.setName('logs')
        .setDescription('Configure logging channels')
        .addSubcommand(sub =>
          sub.setName('moderation')
            .setDescription('Set moderation log channel')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('The channel for moderation logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('server')
            .setDescription('Set server log channel')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('The channel for server logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('member')
            .setDescription('Set member log channel')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('The channel for member logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('channel')
            .setDescription('Set channel log channel')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('The channel for channel logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('message')
            .setDescription('Set message log channel')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('The channel for message logs')
                .setRequired(true))))
    .addSubcommandGroup(group =>
      group.setName('webhook')
        .setDescription('Configure webhook logging (prevents rate limits)')
        .addSubcommand(sub =>
          sub.setName('server')
            .setDescription('Set server log webhook URL')
            .addStringOption(option =>
              option.setName('webhook_url')
                .setDescription('The webhook URL for server logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('member')
            .setDescription('Set member log webhook URL')
            .addStringOption(option =>
              option.setName('webhook_url')
                .setDescription('The webhook URL for member logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('channel')
            .setDescription('Set channel log webhook URL')
            .addStringOption(option =>
              option.setName('webhook_url')
                .setDescription('The webhook URL for channel logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('message')
            .setDescription('Set message log webhook URL')
            .addStringOption(option =>
              option.setName('webhook_url')
                .setDescription('The webhook URL for message logs')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Remove a webhook')
            .addStringOption(option =>
              option.setName('type')
                .setDescription('Which webhook to remove')
                .setRequired(true)
                .addChoices(
                  { name: 'Server', value: 'server' },
                  { name: 'Member', value: 'member' },
                  { name: 'Channel', value: 'channel' },
                  { name: 'Message', value: 'message' }
                ))))
    .addSubcommandGroup(group =>
      group.setName('welcome')
        .setDescription('Configure welcome messages')
        .addSubcommand(sub =>
          sub.setName('setup')
            .setDescription('Setup welcome messages')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('Welcome channel')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('title')
                .setDescription('Embed title')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('description')
                .setDescription('Embed description (use {user} and {server})')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('color')
                .setDescription('Embed color (hex code)')
                .setRequired(false))
            .addStringOption(option =>
              option.setName('image')
                .setDescription('Image URL')
                .setRequired(false)))
        .addSubcommand(sub =>
          sub.setName('toggle')
            .setDescription('Enable or disable welcome messages')
            .addBooleanOption(option =>
              option.setName('enabled')
                .setDescription('Enable welcome messages?')
                .setRequired(true))))
    .addSubcommandGroup(group =>
      group.setName('goodbye')
        .setDescription('Configure goodbye messages')
        .addSubcommand(sub =>
          sub.setName('setup')
            .setDescription('Setup goodbye messages')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('Goodbye channel')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('title')
                .setDescription('Embed title')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('description')
                .setDescription('Embed description (use {user} and {server})')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('color')
                .setDescription('Embed color (hex code)')
                .setRequired(false))
            .addStringOption(option =>
              option.setName('image')
                .setDescription('Image URL')
                .setRequired(false)))
        .addSubcommand(sub =>
          sub.setName('toggle')
            .setDescription('Enable or disable goodbye messages')
            .addBooleanOption(option =>
              option.setName('enabled')
                .setDescription('Enable goodbye messages?')
                .setRequired(true)))),
  
  // Sticky Message Commands
  new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage sticky messages')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a sticky message')
        .addStringOption(option =>
          option.setName('content')
            .setDescription('The message content')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel for sticky message (defaults to current)')
            .setRequired(false))
        .addIntegerOption(option =>
          option.setName('delay')
            .setDescription('Delay in seconds before reposting (default: 5)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(300)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a sticky message')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to remove sticky from (defaults to current)')
            .setRequired(false))),
  
  // Auto-responder Commands
  new SlashCommandBuilder()
    .setName('autorespond')
    .setDescription('Manage auto-responders')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add an auto-responder')
        .addStringOption(option =>
          option.setName('trigger')
            .setDescription('Trigger word/phrase')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('response')
            .setDescription('Response message')
            .setRequired(true))
        .addBooleanOption(option =>
          option.setName('case_sensitive')
            .setDescription('Case sensitive matching?')
            .setRequired(false))
        .addIntegerOption(option =>
          option.setName('delete_after')
            .setDescription('Delete response after X seconds (0 = never)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(300)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove an auto-responder')
        .addStringOption(option =>
          option.setName('trigger')
            .setDescription('Trigger to remove')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all auto-responders')),
].map(command => command.toJSON());

// ==================== REGISTER COMMANDS ====================
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  
  // Store bot start time
  client.readyTimestamp = Date.now();
  
  // Set custom status
  client.user.setPresence({
    activities: [{ name: 'Beta v1 • Made by Sy', type: 3 }], // 3 = WATCHING
    status: 'online'
  });

  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
  
  // Start temp ban check interval (every 5 minutes)
  setInterval(checkTempBans, 5 * 60 * 1000);
  checkTempBans(); // Run immediately on startup
  
  // Start warning expiration check (every 5 minutes)
  setInterval(checkExpiredWarnings, 5 * 60 * 1000);
  checkExpiredWarnings();
});

// ==================== TEMP BAN CHECKER ====================
async function checkTempBans() {
  try {
    const expiredBans = await TempBan.find({ expiresAt: { $lte: new Date() } });
    
    for (const ban of expiredBans) {
      try {
        const guild = client.guilds.cache.get(ban.guildId);
        if (guild) {
          await guild.bans.remove(ban.userId, 'Temporary ban expired');
          console.log(`Unbanned ${ban.userId} from ${guild.name}`);
        }
        await TempBan.deleteOne({ _id: ban._id });
      } catch (err) {
        console.error(`Failed to unban ${ban.userId}:`, err);
      }
    }
  } catch (err) {
    console.error('Error checking temp bans:', err);
  }
}

// ==================== WARNING EXPIRATION CHECKER ====================
async function checkExpiredWarnings() {
  try {
    const expiredWarnings = await Warning.find({ 
      expiresAt: { $lte: new Date(), $ne: null },
      expired: false
    });
    
    for (const warning of expiredWarnings) {
      warning.expired = true;
      await warning.save();
      console.log(`Expired warning ${warning.caseId}`);
    }
  } catch (err) {
    console.error('Error checking expired warnings:', err);
  }
}

// ==================== EVENT HANDLERS ====================

// Member Join
client.on('guildMemberAdd', async (member) => {
  const config = await getGuildConfig(member.guild.id);
  
  if (config.welcome.enabled && config.welcome.channelId) {
    const channel = member.guild.channels.cache.get(config.welcome.channelId);
    if (channel) {
      const description = config.welcome.description
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{server}/g, member.guild.name);
      
      const embed = new EmbedBuilder()
        .setTitle(config.welcome.title)
        .setDescription(description)
        .setColor(config.welcome.color || '#00FF00')
        .setTimestamp();
      
      if (config.welcome.imageUrl) embed.setImage(config.welcome.imageUrl);
      
      await channel.send({ embeds: [embed] });
    }
  }
  
  // Log member join
  if (config.logs.member) {
    const embed = new EmbedBuilder()
      .setTitle('Member Joined')
      .setDescription(`${member.user.tag} joined the server`)
      .setColor('#00FF00')
      .addFields(
        { name: 'User', value: `<@${member.id}>`, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    
    await sendLog(member.guild, 'member', embed, config);
  }
});

// Member Leave
client.on('guildMemberRemove', async (member) => {
  const config = await getGuildConfig(member.guild.id);
  
  if (config.goodbye.enabled && config.goodbye.channelId) {
    const channel = member.guild.channels.cache.get(config.goodbye.channelId);
    if (channel) {
      const description = config.goodbye.description
        .replace(/{user}/g, member.user.tag)
        .replace(/{server}/g, member.guild.name);
      
      const embed = new EmbedBuilder()
        .setTitle(config.goodbye.title)
        .setDescription(description)
        .setColor(config.goodbye.color || '#FF0000')
        .setTimestamp();
      
      if (config.goodbye.imageUrl) embed.setImage(config.goodbye.imageUrl);
      
      await channel.send({ embeds: [embed] });
    }
  }
  
  // Log member leave
  if (config.logs.member) {
    const embed = new EmbedBuilder()
      .setTitle('Member Left')
      .setDescription(`${member.user.tag} left the server`)
      .setColor('#FF0000')
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    
    await sendLog(member.guild, 'member', embed, config);
  }
});

// Message Delete
client.on('messageDelete', async (message) => {
  if (message.author?.bot) return;
  
  const config = await getGuildConfig(message.guild.id);
  
  if (config.logs.message) {
    const embed = new EmbedBuilder()
      .setTitle('Message Deleted')
      .setColor('#FF6B6B')
      .addFields(
        { name: 'Author', value: `<@${message.author?.id}>`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Content', value: message.content || '*No text content*' }
      )
      .setTimestamp();
    
    if (message.attachments.size > 0) {
      const attachmentLinks = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
      embed.addFields({ name: 'Attachments', value: attachmentLinks });
      
      // Add first image as embed image
      const firstImage = message.attachments.find(a => a.contentType?.startsWith('image/'));
      if (firstImage) {
        embed.setImage(firstImage.url);
      }
    }
    
    await sendLog(message.guild, 'message', embed, config);
  }
});

// Message Create (Auto-responder & Sticky)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const config = await getGuildConfig(message.guild.id);
  
  // Auto-responder
  for (const autoResp of config.autoResponders) {
    const content = autoResp.caseSensitive ? message.content : message.content.toLowerCase();
    const trigger = autoResp.caseSensitive ? autoResp.trigger : autoResp.trigger.toLowerCase();
    
    if (content.includes(trigger)) {
      const reply = await message.reply(autoResp.response);
      
      // Delete after X seconds if configured
      if (autoResp.deleteAfter > 0) {
        setTimeout(async () => {
          try {
            await reply.delete();
          } catch (err) {
            // Message might already be deleted
          }
        }, autoResp.deleteAfter * 1000);
      }
      break;
    }
  }
  
  // Sticky messages
  const sticky = config.stickyMessages.find(s => s.channelId === message.channel.id);
  if (sticky) {
    if (sticky.lastMessageId) {
      try {
        const lastMsg = await message.channel.messages.fetch(sticky.lastMessageId);
        await lastMsg.delete();
      } catch (err) {
        // Message already deleted or doesn't exist
      }
    }
    
    setTimeout(async () => {
      const newMsg = await message.channel.send(sticky.content);
      sticky.lastMessageId = newMsg.id;
      await config.save();
    }, sticky.delay);
  }
});

// Channel events for logging
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const config = await getGuildConfig(channel.guild.id);
  
  if (config.logs.channel) {
    const embed = new EmbedBuilder()
      .setTitle('Channel Created')
      .setColor('#00FF00')
      .addFields(
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Type', value: channel.type.toString(), inline: true }
      )
      .setTimestamp();
    
    await sendLog(channel.guild, 'channel', embed, config);
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const config = await getGuildConfig(channel.guild.id);
  
  if (config.logs.channel) {
    const embed = new EmbedBuilder()
      .setTitle('Channel Deleted')
      .setColor('#FF0000')
      .addFields(
        { name: 'Channel Name', value: channel.name, inline: true },
        { name: 'Type', value: channel.type.toString(), inline: true }
      )
      .setTimestamp();
    
    await sendLog(channel.guild, 'channel', embed, config);
  }
});

// ==================== COMMAND HANDLER ====================

client.on('interactionCreate', async (interaction) => {
  // Handle Buttons
  if (interaction.isButton()) {
    if (interaction.customId === 'giveaway_enter') {
      const giveaway = activeGiveaways.get(interaction.message.id);
      
      if (!giveaway) {
        return interaction.reply({ content: '❌ This giveaway has ended.', ephemeral: true });
      }

      if (giveaway.participants.has(interaction.user.id)) {
        return interaction.reply({ content: '✅ You are already entered!', ephemeral: true });
      }

      giveaway.participants.add(interaction.user.id);
      interaction.reply({ content: '🎉 You have entered the giveaway!', ephemeral: true });
    }
    return;
  }
  
  // Handle Modals
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'say_modal') {
      const message = interaction.fields.getTextInputValue('message_input');
      await interaction.channel.send(message);
      await interaction.reply({ content: '✅ Message sent!', ephemeral: true });
    }
    return;
  }

  // Handle Slash Commands
  if (!interaction.isChatInputCommand()) return;

  const config = await getGuildConfig(interaction.guild.id);
  const { commandName } = interaction;

  // ==================== UTILITY COMMANDS ====================
  
  if (commandName === 'ping') {
    const apiLatency = Math.round(client.ws.ping);
    const uptime = Date.now() - client.readyTimestamp;
    
    // Format uptime
    const days = Math.floor(uptime / 86400000);
    const hours = Math.floor((uptime % 86400000) / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);
    const seconds = Math.floor((uptime % 60000) / 1000);
    
    let uptimeString = '';
    if (days > 0) uptimeString += `${days}d `;
    if (hours > 0 || days > 0) uptimeString += `${hours}h `;
    if (minutes > 0 || hours > 0 || days > 0) uptimeString += `${minutes}m `;
    uptimeString += `${seconds}s`;

    const embed = new EmbedBuilder()
      .setTitle('Pong!')
      .setColor('#00FF00')
      .addFields(
        { name: 'API Latency', value: `${apiLatency}ms`, inline: true },
        { name: 'Uptime', value: uptimeString, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('C.L. StudioWorks Bot - Commands')
      .setDescription('Moderation and Utility Bot')
      .addFields(
        { 
          name: 'Moderation', 
          value: '`/kick` `/ban` `/timeout` `/warn` `/warns` `/purge` `/slowmode` `/lockdown`' 
        },
        { 
          name: 'Giveaways', 
          value: '`/gstart` `/greroll`' 
        },
        { 
          name: 'Configuration', 
          value: '`/config` `/sticky` `/autorespond`' 
        },
        { 
          name: 'Utility', 
          value: '`/ping` `/help` `/whois` `/say`' 
        }
      )
      .setFooter({ text: 'Beta v1 • Made by Sy' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  }
  
  if (commandName === 'whois') {
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    
    const embed = new EmbedBuilder()
      .setTitle('User Information')
      .setColor('#0099FF')
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: 'Username', value: user.tag, inline: true },
        { name: 'ID', value: user.id, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: false }
      );
    
    if (member) {
      embed.addFields(
        { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false },
        { name: 'Roles', value: member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'None', inline: false }
      );
      
      // Add key permissions
      const keyPerms = [];
      if (member.permissions.has(PermissionFlagsBits.Administrator)) keyPerms.push('Administrator');
      if (member.permissions.has(PermissionFlagsBits.ManageGuild)) keyPerms.push('Manage Server');
      if (member.permissions.has(PermissionFlagsBits.ManageRoles)) keyPerms.push('Manage Roles');
      if (member.permissions.has(PermissionFlagsBits.ManageChannels)) keyPerms.push('Manage Channels');
      if (member.permissions.has(PermissionFlagsBits.KickMembers)) keyPerms.push('Kick Members');
      if (member.permissions.has(PermissionFlagsBits.BanMembers)) keyPerms.push('Ban Members');
      if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) keyPerms.push('Timeout Members');
      if (member.permissions.has(PermissionFlagsBits.ManageMessages)) keyPerms.push('Manage Messages');
      
      if (keyPerms.length > 0) {
        embed.addFields({ name: 'Key Permissions', value: keyPerms.join(', '), inline: false });
      }
    }
    
    await interaction.reply({ embeds: [embed] });
  }
  
  if (commandName === 'say') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const modal = new ModalBuilder()
      .setCustomId('say_modal')
      .setTitle('Make Bot Say Something');
    
    const messageInput = new TextInputBuilder()
      .setCustomId('message_input')
      .setLabel('Message')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Enter the message here...')
      .setRequired(true);
    
    const row = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(row);
    
    await interaction.showModal(modal);
  }

  // ==================== MODERATION COMMANDS ====================

  if (commandName === 'kick') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const dmUser = interaction.options.getBoolean('dm_user') ?? true;
    const showMod = interaction.options.getBoolean('show_moderator') ?? true;
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ content: '❌ I cannot kick this user.', ephemeral: true });
    }

    const attachments = [];
    for (let i = 1; i <= 6; i++) {
      const att = interaction.options.getAttachment(`proof${i}`);
      if (att) attachments.push(att.url);
    }

    try {
      // Send DM before kicking
      if (dmUser) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle(`You have been kicked from ${interaction.guild.name}`)
            .setColor('#FF6B6B')
            .addFields({ name: 'Reason', value: reason })
            .setTimestamp();
          
          if (showMod) {
            dmEmbed.addFields({ name: 'Moderator', value: interaction.user.tag });
          }
          
          if (attachments.length > 0) {
            dmEmbed.setImage(attachments[0]);
          }
          
          await user.send({ embeds: [dmEmbed] });
        } catch (e) {
          // User has DMs disabled
        }
      }

      await member.kick(reason);
      
      // Save to database
      const caseId = await generateCaseId(interaction.guild.id);
      const action = new ModAction({
        caseId,
        guildId: interaction.guild.id,
        userId: user.id,
        moderatorId: interaction.user.id,
        action: 'kick',
        reason
      });
      await action.save();
      
      const embed = new EmbedBuilder()
        .setTitle('Member Kicked')
        .setColor('#FF6B6B')
        .addFields(
          { name: 'Case ID', value: caseId, inline: true },
          { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
      if (attachments.length > 0) {
        embed.addFields({ name: 'Evidence', value: attachments.map((a, i) => `[Attachment ${i + 1}](${a})`).join('\n') });
        embed.setImage(attachments[0]);
      }

      if (dmUser) {
        embed.setFooter({ text: showMod ? 'DM sent with moderator name' : 'DM sent anonymously' });
      } else {
        embed.setFooter({ text: 'No DM sent' });
      }
      
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction.guild, 'moderation', embed, config);
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to kick member.', ephemeral: true });
    }
  }

  if (commandName === 'ban') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const duration = interaction.options.getString('duration');
    const dmUser = interaction.options.getBoolean('dm_user') ?? true;
    const showMod = interaction.options.getBoolean('show_moderator') ?? true;
    const member = interaction.guild.members.cache.get(user.id);

    if (member && !member.bannable) {
      return interaction.reply({ content: '❌ I cannot ban this user.', ephemeral: true });
    }

    const attachments = [];
    for (let i = 1; i <= 6; i++) {
      const att = interaction.options.getAttachment(`proof${i}`);
      if (att) attachments.push(att.url);
    }

    try {
      // Send DM before banning
      if (dmUser) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle(`You have been banned from ${interaction.guild.name}`)
            .setColor('#FF0000')
            .addFields({ name: 'Reason', value: reason })
            .setTimestamp();
          
          if (showMod) {
            dmEmbed.addFields({ name: 'Moderator', value: interaction.user.tag });
          }

          if (duration) {
            const time = parseDuration(duration);
            if (time) {
              dmEmbed.addFields({ name: 'Duration', value: `This ban will expire in ${formatDuration(time)}` });
            }
          }
          
          if (attachments.length > 0) {
            dmEmbed.setImage(attachments[0]);
          }
          
          await user.send({ embeds: [dmEmbed] });
        } catch (e) {
          // User has DMs disabled
        }
      }

      await interaction.guild.bans.create(user.id, { reason });
      
      // Handle temporary ban
      let expiresAt = null;
      if (duration) {
        const time = parseDuration(duration);
        if (time) {
          expiresAt = new Date(Date.now() + time);
          const tempBan = new TempBan({
            guildId: interaction.guild.id,
            userId: user.id,
            moderatorId: interaction.user.id,
            reason,
            expiresAt
          });
          await tempBan.save();
        }
      }
      
      // Save to database
      const caseId = await generateCaseId(interaction.guild.id);
      const action = new ModAction({
        caseId,
        guildId: interaction.guild.id,
        userId: user.id,
        moderatorId: interaction.user.id,
        action: 'ban',
        reason,
        expiresAt
      });
      await action.save();
      
      const embed = new EmbedBuilder()
        .setTitle('Member Banned')
        .setColor('#FF0000')
        .addFields(
          { name: 'Case ID', value: caseId, inline: true },
          { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
      if (expiresAt) {
        embed.addFields({ name: 'Duration', value: `Expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` });
      }

      if (attachments.length > 0) {
        embed.addFields({ name: 'Evidence', value: attachments.map((a, i) => `[Attachment ${i + 1}](${a})`).join('\n') });
        embed.setImage(attachments[0]);
      }

      if (dmUser) {
        embed.setFooter({ text: showMod ? 'DM sent with moderator name' : 'DM sent anonymously' });
      } else {
        embed.setFooter({ text: 'No DM sent' });
      }
      
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction.guild, 'moderation', embed, config);
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to ban member.', ephemeral: true });
    }
  }

  if (commandName === 'timeout') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.moderatable) {
      return interaction.reply({ content: '❌ I cannot timeout this user.', ephemeral: true });
    }

    try {
      await member.timeout(duration * 60 * 1000, reason);
      
      const caseId = await generateCaseId(interaction.guild.id);
      const action = new ModAction({
        caseId,
        guildId: interaction.guild.id,
        userId: user.id,
        moderatorId: interaction.user.id,
        action: 'timeout',
        reason,
        duration
      });
      await action.save();
      
      const embed = new EmbedBuilder()
        .setTitle('Member Timed Out')
        .setColor('#FFA500')
        .addFields(
          { name: 'Case ID', value: caseId, inline: true },
          { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
          { name: 'Duration', value: `${duration} minutes`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction.guild, 'moderation', embed, config);
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to timeout member.', ephemeral: true });
    }
  }

  if (commandName === 'warn') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const duration = interaction.options.getString('duration');
    const dmUser = interaction.options.getBoolean('dm_user') ?? true;
    const showMod = interaction.options.getBoolean('show_moderator') ?? true;
    
    const attachments = [];
    for (let i = 1; i <= 6; i++) {
      const att = interaction.options.getAttachment(`proof${i}`);
      if (att) attachments.push(att.url);
    }
    
    let expiresAt = null;
    if (duration) {
      const time = parseDuration(duration);
      if (time) expiresAt = new Date(Date.now() + time);
    }
    
    const caseId = await generateCaseId(interaction.guild.id);
    const warning = new Warning({
      caseId,
      guildId: interaction.guild.id,
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt,
      attachments,
      dmSent: dmUser,
      showModerator: showMod
    });
    await warning.save();
    
    const embed = new EmbedBuilder()
      .setTitle('Member Warned')
      .setColor('#FFFF00')
      .addFields(
        { name: 'Case ID', value: caseId, inline: true },
        { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Reason', value: reason }
      )
      .setTimestamp();
    
    if (expiresAt) {
      embed.addFields({ name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` });
    }
    
    if (attachments.length > 0) {
      embed.addFields({ name: 'Evidence', value: attachments.map((a, i) => `[Attachment ${i + 1}](${a})`).join('\n') });
      embed.setImage(attachments[0]);
    }

    if (dmUser) {
      embed.setFooter({ text: showMod ? 'DM sent with moderator name' : 'DM sent anonymously' });
    } else {
      embed.setFooter({ text: 'No DM sent' });
    }
    
    await interaction.reply({ embeds: [embed] });
    await sendLog(interaction.guild, 'moderation', embed, config);
    
    if (dmUser) {
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle(`You have been warned in ${interaction.guild.name}`)
          .setColor('#FFFF00')
          .addFields({ name: 'Reason', value: reason })
          .setTimestamp();
        
        if (showMod) {
          dmEmbed.addFields({ name: 'Moderator', value: interaction.user.tag });
        }
        
        if (attachments.length > 0) {
          dmEmbed.setImage(attachments[0]);
        }
        
        await user.send({ embeds: [dmEmbed] });
      } catch (e) {
        await interaction.followUp({ content: '⚠️ Could not DM the user.', ephemeral: true });
      }
    }
  }
  
  if (commandName === 'unban') {
    if (!hasPermission(interaction.member, 'executiveMod', config)) {
      return interaction.reply({ content: '❌ You need executive moderator permissions.', ephemeral: true });
    }
    
    const userId = interaction.options.getString('user_id').replace(/[<@!>]/g, '');
    const reason = interaction.options.getString('reason');
    const dmUser = interaction.options.getBoolean('dm_user') ?? true;
    const showMod = interaction.options.getBoolean('show_moderator') ?? true;

    try {
      await interaction.guild.bans.remove(userId, reason);
      
      // Remove temp ban if exists
      await TempBan.deleteOne({ guildId: interaction.guild.id, userId });
      
      // Save to database
      const caseId = await generateCaseId(interaction.guild.id);
      const action = new ModAction({
        caseId,
        guildId: interaction.guild.id,
        userId,
        moderatorId: interaction.user.id,
        action: 'unban',
        reason
      });
      await action.save();
      
      const embed = new EmbedBuilder()
        .setTitle('Member Unbanned')
        .setColor('#00FF00')
        .addFields(
          { name: 'Case ID', value: caseId, inline: true },
          { name: 'User ID', value: userId, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
      if (dmUser) {
        embed.setFooter({ text: showMod ? 'DM sent with moderator name' : 'DM sent anonymously' });
      } else {
        embed.setFooter({ text: 'No DM sent' });
      }
      
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction.guild, 'moderation', embed, config);
      
      // Try to DM user
      if (dmUser) {
        try {
          const user = await client.users.fetch(userId);
          const dmEmbed = new EmbedBuilder()
            .setTitle(`You have been unbanned from ${interaction.guild.name}`)
            .setColor('#00FF00')
            .addFields({ name: 'Reason', value: reason })
            .setTimestamp();
          
          if (showMod) {
            dmEmbed.addFields({ name: 'Moderator', value: interaction.user.tag });
          }
          
          await user.send({ embeds: [dmEmbed] });
        } catch (e) {
          // User has DMs disabled or couldn't fetch
        }
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to unban user. They may not be banned.', ephemeral: true });
    }
  }

  if (commandName === 'untimeout') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.isCommunicationDisabled()) {
      return interaction.reply({ content: '❌ This user is not timed out.', ephemeral: true });
    }

    try {
      await member.timeout(null, reason);
      
      const embed = new EmbedBuilder()
        .setTitle('Timeout Removed')
        .setColor('#00FF00')
        .addFields(
          { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction.guild, 'moderation', embed, config);
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to remove timeout.', ephemeral: true });
    }
  }

  if (commandName === 'moderations') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'view') {
      const userIdInput = interaction.options.getString('user_id');
      const userId = userIdInput.replace(/[<@!>]/g, '');
      
      const warnings = await Warning.find({ guildId: interaction.guild.id, userId }).sort({ timestamp: -1 });
      const actions = await ModAction.find({ guildId: interaction.guild.id, userId }).sort({ timestamp: -1 });
      
      if (warnings.length === 0 && actions.length === 0) {
        return interaction.reply({ content: '❌ No moderations found for this user.', ephemeral: true });
      }
      
      let user;
      try {
        user = await client.users.fetch(userId);
      } catch (e) {
        user = { tag: `Unknown User (${userId})` };
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`Moderation History for ${user.tag}`)
        .setColor('#FFA500')
        .setTimestamp();
      
      const allRecords = [
        ...warnings.map(w => ({ type: 'warn', data: w })),
        ...actions.map(a => ({ type: 'action', data: a }))
      ].sort((a, b) => b.data.timestamp - a.data.timestamp).slice(0, 10);
      
      for (const record of allRecords) {
        if (record.type === 'warn') {
          const w = record.data;
          const expiredText = w.expired ? ' **(EXPIRED)**' : '';
          embed.addFields({
            name: `⚠️ Warning - Case ${w.caseId} - <t:${Math.floor(w.timestamp.getTime() / 1000)}:R>${expiredText}`,
            value: `**Reason:** ${w.reason}\n**Moderator:** <@${w.moderatorId}>${w.expiresAt && !w.expired ? `\n**Expires:** <t:${Math.floor(w.expiresAt.getTime() / 1000)}:R>` : ''}`
          });
        } else {
          const a = record.data;
          const emoji = { kick: '🥾', ban: '🔨', timeout: '⏰', unban: '✅' }[a.action] || '📝';
          embed.addFields({
            name: `${emoji} ${a.action.toUpperCase()} - Case ${a.caseId} - <t:${Math.floor(a.timestamp.getTime() / 1000)}:R>`,
            value: `**Reason:** ${a.reason}\n**Moderator:** <@${a.moderatorId}>`
          });
        }
      }
      
      await interaction.reply({ embeds: [embed] });
    }
    
    if (subcommand === 'edit') {
      if (!hasPermission(interaction.member, 'executiveMod', config)) {
        return interaction.reply({ content: '❌ You need executive moderator permissions to edit cases.', ephemeral: true });
      }
      
      const caseId = interaction.options.getString('case_id');
      const newReason = interaction.options.getString('reason');
      const newDuration = interaction.options.getString('duration');
      
      // Try to find in warnings first
      let warning = await Warning.findOne({ guildId: interaction.guild.id, caseId });
      let action = null;
      
      if (!warning) {
        action = await ModAction.findOne({ guildId: interaction.guild.id, caseId });
      }
      
      if (!warning && !action) {
        return interaction.reply({ content: '❌ Case not found.', ephemeral: true });
      }
      
      let changes = [];
      let targetUserId = '';
      
      if (warning) {
        targetUserId = warning.userId;
        if (newReason) {
          changes.push(`Reason: ${warning.reason} → ${newReason}`);
          warning.reason = newReason;
        }
        if (newDuration) {
          const time = parseDuration(newDuration);
          if (time) {
            const oldExpiry = warning.expiresAt ? `<t:${Math.floor(warning.expiresAt.getTime() / 1000)}:R>` : 'Never';
            const newExpiry = `<t:${Math.floor((Date.now() + time) / 1000)}:R>`;
            changes.push(`Expiry: ${oldExpiry} → ${newExpiry}`);
            warning.expiresAt = new Date(Date.now() + time);
            warning.expired = false;
          }
        }
        await warning.save();
      } else if (action) {
        targetUserId = action.userId;
        if (newReason) {
          changes.push(`Reason: ${action.reason} → ${newReason}`);
          action.reason = newReason;
        }
        if (newDuration && (action.action === 'ban' || action.action === 'timeout')) {
          const time = parseDuration(newDuration);
          if (time) {
            const oldExpiry = action.expiresAt ? `<t:${Math.floor(action.expiresAt.getTime() / 1000)}:R>` : 'Never';
            const newExpiry = `<t:${Math.floor((Date.now() + time) / 1000)}:R>`;
            changes.push(`Expiry: ${oldExpiry} → ${newExpiry}`);
            action.expiresAt = new Date(Date.now() + time);
          }
        }
        await action.save();
      }
      
      await interaction.reply({ content: `✅ Case ${caseId} has been updated.`, ephemeral: true });
      
      // Log the edit
      const logEmbed = new EmbedBuilder()
        .setTitle('Moderation Case Edited')
        .setColor('#FFA500')
        .addFields(
          { name: 'Case ID', value: caseId, inline: true },
          { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
          { name: 'Edited By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Changes', value: changes.join('\n') || 'No changes recorded' }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, 'moderation', logEmbed, config);
    }
    
    if (subcommand === 'delete') {
      if (!hasPermission(interaction.member, 'executiveMod', config)) {
        return interaction.reply({ content: '❌ You need executive moderator permissions to delete cases.', ephemeral: true });
      }
      
      const caseId = interaction.options.getString('case_id');
      
      const warning = await Warning.findOne({ guildId: interaction.guild.id, caseId });
      const action = await ModAction.findOne({ guildId: interaction.guild.id, caseId });
      
      if (!warning && !action) {
        return interaction.reply({ content: '❌ Case not found.', ephemeral: true });
      }
      
      let deletedCase = null;
      let targetUserId = '';
      let caseType = '';
      let caseReason = '';
      
      if (warning) {
        deletedCase = { ...warning.toObject() };
        targetUserId = warning.userId;
        caseType = 'Warning';
        caseReason = warning.reason;
        await Warning.findOneAndDelete({ guildId: interaction.guild.id, caseId });
      } else if (action) {
        deletedCase = { ...action.toObject() };
        targetUserId = action.userId;
        caseType = action.action.toUpperCase();
        caseReason = action.reason;
        await ModAction.findOneAndDelete({ guildId: interaction.guild.id, caseId });
      }
      
      await interaction.reply({ content: `✅ Case ${caseId} has been deleted.`, ephemeral: true });
      
      // Log the deletion
      const logEmbed = new EmbedBuilder()
        .setTitle('Moderation Case Deleted')
        .setColor('#FF0000')
        .addFields(
          { name: 'Case ID', value: caseId, inline: true },
          { name: 'Case Type', value: caseType, inline: true },
          { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
          { name: 'Deleted By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Original Reason', value: caseReason }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, 'moderation', logEmbed, config);
    }
  }
  
  if (commandName === 'warns') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const userIdInput = interaction.options.getString('user_id');
    const userId = userIdInput.replace(/[<@!>]/g, '');
    
    const warnings = await Warning.find({ guildId: interaction.guild.id, userId }).sort({ timestamp: -1 });
    const actions = await ModAction.find({ guildId: interaction.guild.id, userId }).sort({ timestamp: -1 });
    
    if (warnings.length === 0 && actions.length === 0) {
      return interaction.reply({ content: '❌ No warnings or actions found for this user.', ephemeral: true });
    }
    
    let user;
    try {
      user = await client.users.fetch(userId);
    } catch (e) {
      user = { tag: `Unknown User (${userId})` };
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`Warning History for ${user.tag}`)
      .setColor('#FFA500')
      .setTimestamp();
    
    const allRecords = [
      ...warnings.map(w => ({ type: 'warn', data: w })),
      ...actions.map(a => ({ type: 'action', data: a }))
    ].sort((a, b) => b.data.timestamp - a.data.timestamp).slice(0, 10);
    
    for (const record of allRecords) {
      if (record.type === 'warn') {
        const w = record.data;
        embed.addFields({
          name: `⚠️ Warning - <t:${Math.floor(w.timestamp.getTime() / 1000)}:R>`,
          value: `**Reason:** ${w.reason}\n**Moderator:** <@${w.moderatorId}>${w.expiresAt ? `\n**Expires:** <t:${Math.floor(w.expiresAt.getTime() / 1000)}:R>` : ''}`
        });
      } else {
        const a = record.data;
        const emoji = { kick: '🥾', ban: '🔨', timeout: '⏰' }[a.action] || '📝';
        embed.addFields({
          name: `${emoji} ${a.action.toUpperCase()} - <t:${Math.floor(a.timestamp.getTime() / 1000)}:R>`,
          value: `**Reason:** ${a.reason}\n**Moderator:** <@${a.moderatorId}>`
        });
      }
    }
    
    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'purge') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const amount = interaction.options.getInteger('amount');

    try {
      await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `✅ Deleted ${amount} messages.`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to delete messages.', ephemeral: true });
    }
  }
  
  if (commandName === 'slowmode') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const seconds = interaction.options.getInteger('seconds');
    
    try {
      await interaction.channel.setRateLimitPerUser(seconds);
      
      const embed = new EmbedBuilder()
        .setTitle('Slowmode Updated')
        .setColor('#0099FF')
        .addFields(
          { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: true },
          { name: 'Slowmode', value: seconds === 0 ? 'Disabled' : `${seconds} seconds`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to set slowmode.', ephemeral: true });
    }
  }
  
  if (commandName === 'lockdown') {
    if (!hasPermission(interaction.member, 'executiveMod', config)) {
      return interaction.reply({ content: '❌ You need executive moderator permissions.', ephemeral: true });
    }
    
    const action = interaction.options.getString('action');
    const scope = interaction.options.getString('scope');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    
    try {
      const everyoneRole = interaction.guild.roles.everyone;
      
      if (scope === 'channel') {
        if (action === 'lock') {
          await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
          
          const embed = new EmbedBuilder()
            .setTitle('Channel Locked')
            .setColor('#FF0000')
            .addFields(
              { name: 'Channel', value: `<#${channel.id}>`, inline: true },
              { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp();
          
          await interaction.reply({ embeds: [embed] });
          await sendLog(interaction.guild, 'moderation', embed, config);
        } else {
          await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
          
          const embed = new EmbedBuilder()
            .setTitle('Channel Unlocked')
            .setColor('#00FF00')
            .addFields(
              { name: 'Channel', value: `<#${channel.id}>`, inline: true },
              { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp();
          
          await interaction.reply({ embeds: [embed] });
          await sendLog(interaction.guild, 'moderation', embed, config);
        }
      } else if (scope === 'server') {
        await interaction.deferReply();
        
        const channels = interaction.guild.channels.cache.filter(c => 
          c.type === ChannelType.GuildText && 
          !c.name.toLowerCase().includes('announcement') &&
          !c.name.toLowerCase().includes('rules') &&
          !c.name.toLowerCase().includes('info')
        );
        
        let lockedCount = 0;
        for (const [id, ch] of channels) {
          try {
            if (action === 'lock') {
              await ch.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
            } else {
              await ch.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
            }
            lockedCount++;
          } catch (err) {
            console.error(`Failed to ${action} ${ch.name}:`, err);
          }
        }
        
        const embed = new EmbedBuilder()
          .setTitle(action === 'lock' ? 'Server Locked' : 'Server Unlocked')
          .setColor(action === 'lock' ? '#FF0000' : '#00FF00')
          .addFields(
            { name: 'Channels Affected', value: `${lockedCount}`, inline: true },
            { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        await sendLog(interaction.guild, 'moderation', embed, config);
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to lock/unlock.', ephemeral: true });
    }
  }

  // ==================== GIVEAWAY COMMANDS ====================

  if (commandName === 'gstart') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const duration = interaction.options.getString('duration');
    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners') || 1;
    const color = interaction.options.getString('color') || '#00FF00';
    const imageUrl = interaction.options.getString('image');
    const emoji = interaction.options.getString('emoji') || '🎉';

    const time = parseDuration(duration);
    if (!time) {
      return interaction.reply({ content: '❌ Invalid duration.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('GIVEAWAY')
      .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor((Date.now() + time) / 1000)}:R>`)
      .setColor(color)
      .setFooter({ text: `Hosted by ${interaction.user.tag}` })
      .setTimestamp(Date.now() + time);
    
    if (imageUrl) embed.setImage(imageUrl);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('Enter Giveaway')
          .setEmoji(emoji)
          .setStyle(ButtonStyle.Primary)
      );

    const giveawayMsg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    const giveawayData = {
      messageId: giveawayMsg.id,
      channelId: interaction.channel.id,
      guildId: interaction.guild.id,
      prize,
      winners,
      endTime: Date.now() + time,
      host: interaction.user.id,
      participants: new Set()
    };

    activeGiveaways.set(giveawayMsg.id, giveawayData);
    setTimeout(() => endGiveaway(giveawayMsg.id), time);
  }

  if (commandName === 'greroll') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const messageId = interaction.options.getString('message_id');
    const giveaway = activeGiveaways.get(messageId);
    
    if (!giveaway || giveaway.participants.size === 0) {
      return interaction.reply({ content: '❌ No participants to reroll.', ephemeral: true });
    }

    const winners = selectWinners(giveaway.participants, giveaway.winners);
    const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

    await interaction.reply(`🎉 **Rerolled!** New winner(s): ${winnerMentions}`);
  }

  // ==================== CONFIG COMMANDS ====================

  if (commandName === 'config') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
    }
    
    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    
    if (group === 'roles') {
      const role = interaction.options.getRole('role');
      config.roles[subcommand === 'executivemod' ? 'executiveMod' : subcommand] = role.id;
      await config.save();
      
      await interaction.reply({ content: `✅ Set ${subcommand} role to ${role}`, ephemeral: true });
    }
    
    if (group === 'logs') {
      const channel = interaction.options.getChannel('channel');
      config.logs[subcommand] = channel.id;
      await config.save();
      
      await interaction.reply({ content: `✅ Set ${subcommand} log channel to ${channel}`, ephemeral: true });
    }
    
    if (group === 'webhook') {
      if (subcommand === 'remove') {
        const type = interaction.options.getString('type');
        config.logWebhooks[type] = null;
        await config.save();
        
        await interaction.reply({ content: `✅ Removed ${type} webhook. Logs will now be sent directly to the channel.`, ephemeral: true });
      } else {
        const webhookUrl = interaction.options.getString('webhook_url');
        
        // Validate webhook URL
        if (!webhookUrl.startsWith('https://discord.com/api/webhooks/') && !webhookUrl.startsWith('https://discordapp.com/api/webhooks/')) {
          return interaction.reply({ content: '❌ Invalid webhook URL. Must be a Discord webhook URL.', ephemeral: true });
        }
        
        config.logWebhooks[subcommand] = webhookUrl;
        await config.save();
        
        await interaction.reply({ content: `✅ Set ${subcommand} log webhook! Logs will now be sent via webhook to prevent rate limiting.`, ephemeral: true });
      }
    }
    
    if (group === 'welcome') {
      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color') || '#00FF00';
        const image = interaction.options.getString('image');
        
        config.welcome = {
          enabled: true,
          channelId: channel.id,
          title,
          description,
          color,
          imageUrl: image
        };
        await config.save();
        
        await interaction.reply({ content: `✅ Welcome messages configured!`, ephemeral: true });
      } else if (subcommand === 'toggle') {
        const enabled = interaction.options.getBoolean('enabled');
        config.welcome.enabled = enabled;
        await config.save();
        
        await interaction.reply({ content: `✅ Welcome messages ${enabled ? 'enabled' : 'disabled'}!`, ephemeral: true });
      }
    }
    
    if (group === 'goodbye') {
      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color') || '#FF0000';
        const image = interaction.options.getString('image');
        
        config.goodbye = {
          enabled: true,
          channelId: channel.id,
          title,
          description,
          color,
          imageUrl: image
        };
        await config.save();
        
        await interaction.reply({ content: `✅ Goodbye messages configured!`, ephemeral: true });
      } else if (subcommand === 'toggle') {
        const enabled = interaction.options.getBoolean('enabled');
        config.goodbye.enabled = enabled;
        await config.save();
        
        await interaction.reply({ content: `✅ Goodbye messages ${enabled ? 'enabled' : 'disabled'}!`, ephemeral: true });
      }
    }
  }

  // ==================== STICKY COMMANDS ====================

  if (commandName === 'sticky') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'create') {
      const content = interaction.options.getString('content');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const delay = (interaction.options.getInteger('delay') || 5) * 1000;
      
      // Remove existing sticky if present
      const existingIndex = config.stickyMessages.findIndex(s => s.channelId === channel.id);
      if (existingIndex !== -1) {
        config.stickyMessages.splice(existingIndex, 1);
      }
      
      config.stickyMessages.push({
        channelId: channel.id,
        content,
        delay
      });
      await config.save();
      
      await interaction.reply({ content: `✅ Sticky message created in ${channel}!`, ephemeral: true });
    } else if (subcommand === 'remove') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      
      const index = config.stickyMessages.findIndex(s => s.channelId === channel.id);
      if (index === -1) {
        return interaction.reply({ content: '❌ No sticky message in that channel.', ephemeral: true });
      }
      
      config.stickyMessages.splice(index, 1);
      await config.save();
      
      await interaction.reply({ content: `✅ Sticky message removed from ${channel}!`, ephemeral: true });
    }
  }

  // ==================== AUTO-RESPONDER COMMANDS ====================

  if (commandName === 'autorespond') {
    if (!hasPermission(interaction.member, 'mod', config)) {
      return interaction.reply({ content: '❌ You need moderator permissions.', ephemeral: true });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'add') {
      const trigger = interaction.options.getString('trigger');
      const response = interaction.options.getString('response');
      const caseSensitive = interaction.options.getBoolean('case_sensitive') || false;
      const deleteAfter = interaction.options.getInteger('delete_after') || 0;
      
      config.autoResponders.push({ trigger, response, caseSensitive, deleteAfter });
      await config.save();
      
      await interaction.reply({ content: `✅ Auto-responder added!${deleteAfter > 0 ? ` Will delete after ${deleteAfter}s.` : ''}`, ephemeral: true });
    } else if (subcommand === 'remove') {
      const trigger = interaction.options.getString('trigger');
      
      const index = config.autoResponders.findIndex(a => a.trigger === trigger);
      if (index === -1) {
        return interaction.reply({ content: '❌ Auto-responder not found.', ephemeral: true });
      }
      
      config.autoResponders.splice(index, 1);
      await config.save();
      
      await interaction.reply({ content: `✅ Auto-responder removed!`, ephemeral: true });
    } else if (subcommand === 'list') {
      if (config.autoResponders.length === 0) {
        return interaction.reply({ content: '❌ No auto-responders configured.', ephemeral: true });
      }
      
      const embed = new EmbedBuilder()
        .setTitle('Auto-Responders')
        .setColor('#0099FF')
        .setTimestamp();
      
      for (const [index, ar] of config.autoResponders.entries()) {
        embed.addFields({
          name: `${index + 1}. Trigger: "${ar.trigger}"`,
          value: `Response: ${ar.response}\nCase Sensitive: ${ar.caseSensitive ? 'Yes' : 'No'}\nDelete After: ${ar.deleteAfter > 0 ? ar.deleteAfter + 's' : 'Never'}`
        });
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
});

// Helper Functions for Giveaways
function selectWinners(participants, count) {
  const arr = Array.from(participants);
  const winners = [];
  for (let i = 0; i < Math.min(count, arr.length); i++) {
    const index = Math.floor(Math.random() * arr.length);
    winners.push(arr.splice(index, 1)[0]);
  }
  return winners;
}

async function endGiveaway(messageId) {
  const giveaway = activeGiveaways.get(messageId);
  if (!giveaway) return;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);

    if (giveaway.participants.size === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('GIVEAWAY ENDED')
        .setDescription(`**Prize:** ${giveaway.prize}\n**Winner:** No valid entries`)
        .setTimestamp();

      message.edit({ embeds: [embed], components: [] });
      channel.send('😢 No one entered the giveaway!');
    } else {
      const winners = selectWinners(giveaway.participants, giveaway.winners);
      const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('GIVEAWAY ENDED')
        .setDescription(`**Prize:** ${giveaway.prize}\n**Winner(s):** ${winnerMentions}`)
        .setTimestamp();

      message.edit({ embeds: [embed], components: [] });
      channel.send(`🎊 Congratulations ${winnerMentions}! You won **${giveaway.prize}**!`);
    }

    activeGiveaways.delete(messageId);
  } catch (error) {
    console.error('Error ending giveaway:', error);
  }
}

// Login
client.login(process.env.DISCORD_TOKEN);
