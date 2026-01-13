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
    caseSensitive: { type: Boolean, default: false }
  }]
});

// Warning Schema
const warningSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  moderatorId: String,
  reason: String,
  timestamp: { type: Date, default: Date.now },
  expiresAt: Date,
  attachments: [String],
  dmSent: Boolean,
  showModerator: Boolean
});

// Moderation Action Schema
const modActionSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  moderatorId: String,
  action: String, // 'kick', 'ban', 'timeout', 'warn'
  reason: String,
  duration: Number,
  timestamp: { type: Date, default: Date.now },
  expiresAt: Date
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
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
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
        .setRequired(false))
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration for temporary ban (e.g., 1h, 1d, 7d)')
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
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('warns')
    .setDescription('View warning history for a user')
    .addStringOption(option =>
      option.setName('user_id')
        .setDescription('User ID or mention')
        .setRequired(true)),
  
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
    .setDescription('Lock or unlock a channel')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Lock or unlock')
        .setRequired(true)
        .addChoices(
          { name: 'Lock', value: 'lock' },
          { name: 'Unlock', value: 'unlock' }
        ))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to lock/unlock (defaults to current)')
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
            .setRequired(false)))
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
  
  // Start temp ban check interval (every 15 minutes)
  setInterval(checkTempBans, 15 * 60 * 1000);
  checkTempBans(); // Run immediately on startup
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
      embed.addFields({ name: 'Attachments', value: message.attachments.map(a => a.url).join('\n') });
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
      await message.reply(autoResp.response);
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

    const embed = new EmbedBuilder()
      .setTitle('Pong!')
      .setColor('#00FF00')
      .addFields(
        { name: 'API Latency', value: `${apiLatency}ms`, inline: true }
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
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ content: '❌ I cannot kick this user.', ephemeral: true });
    }

    try {
      await member.kick(reason);
      
      // Save to database
      const action = new ModAction({
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
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
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
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const duration = interaction.options.getString('duration');
    const member = interaction.guild.members.cache.get(user.id);

    if (member && !member.bannable) {
      return interaction.reply({ content: '❌ I cannot ban this user.', ephemeral: true });
    }

    try {
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
      const action = new ModAction({
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
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      
      if (expiresAt) {
        embed.addFields({ name: 'Duration', value: `Expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` });
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
      
      const action = new ModAction({
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
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Duration', value: `${duration} minutes`, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
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
    for (let i = 1; i <= 3; i++) {
      const att = interaction.options.getAttachment(`proof${i}`);
      if (att) attachments.push(att.url);
    }
    
    let expiresAt = null;
    if (duration) {
      const time = parseDuration(duration);
      if (time) expiresAt = new Date(Date.now() + time);
    }
    
    const warning = new Warning({
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
        { name: 'User', value: `${user.tag}`, inline: true },
        { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
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
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    
    try {
      const everyoneRole = interaction.guild.roles.everyone;
      
      if (action === 'lock') {
        await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
        
        const embed = new EmbedBuilder()
          .setTitle('Channel Locked')
          .setColor('#FF0000')
          .addFields(
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'Moderator', value: `${interaction.user.tag}`, inline: true }
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
            { name: 'Moderator', value: `${interaction.user.tag}`, inline: true }
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        await sendLog(interaction.guild, 'moderation', embed, config);
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to lock/unlock channel.', ephemeral: true });
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
      
      config.autoResponders.push({ trigger, response, caseSensitive });
      await config.save();
      
      await interaction.reply({ content: `✅ Auto-responder added!`, ephemeral: true });
    } else if (subcommand === 'remove') {
      const trigger = interaction.options.getString('trigger');
      
      const index = config.autoResponders.findIndex(a => a.trigger === trigger);
      if (index === -1) {
        return interaction.reply({ content: '❌ Auto-responder not found.', ephemeral: true
