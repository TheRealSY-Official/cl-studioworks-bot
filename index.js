const Discord = require('discord.js');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

const activeGiveaways = new Map();

// Express server to keep bot alive
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  if (client.isReady()) {
    res.status(200).send('🤖 C.L. StudioWorks Bot is running and connected to Discord!');
  } else {
    res.status(503).send('❌ Bot is not connected to Discord');
  }
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// Slash Commands Definition
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),
  
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
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  
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
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  
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
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  
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
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete multiple messages')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  
  new SlashCommandBuilder()
    .setName('greroll')
    .setDescription('Reroll a giveaway')
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('The giveaway message ID')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(command => command.toJSON());

// Register Slash Commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  client.user.setActivity('C.L. StudioWorks', { type: 'WATCHING' });

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
});

// Slash Command Handler
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

  // Handle Slash Commands
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ==================== UTILITY COMMANDS ====================
  
  if (commandName === 'ping') {
    const apiLatency = Math.round(client.ws.ping);

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🏓 Pong!')
      .addFields(
        { name: '💓 API Latency', value: `${apiLatency}ms`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('🤖 C.L. StudioWorks Bot - Commands')
      .setDescription('Moderation and Giveaway Bot')
      .addFields(
        { 
          name: '🛡️ Moderation', 
          value: '`/kick` - Kick a member\n`/ban` - Ban a member\n`/timeout` - Timeout a member\n`/warn` - Warn a member\n`/clear` - Delete messages' 
        },
        { 
          name: '🎉 Giveaways', 
          value: '`/gstart` - Start a giveaway\n`/greroll` - Reroll giveaway winners' 
        },
        { 
          name: '⚙️ Utility', 
          value: '`/ping` - Check bot latency\n`/help` - Show this message' 
        }
      )
      .setFooter({ text: 'C.L. StudioWorks' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  }

  // ==================== MODERATION COMMANDS ====================

  if (commandName === 'kick') {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ content: '❌ I cannot kick this user. They may have higher roles than me.', ephemeral: true });
    }

    try {
      await member.kick(reason);
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('🥾 Member Kicked')
        .addFields(
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to kick member.', ephemeral: true });
    }
  }

  if (commandName === 'ban') {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.bannable) {
      return interaction.reply({ content: '❌ I cannot ban this user. They may have higher roles than me.', ephemeral: true });
    }

    try {
      await member.ban({ reason });
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🔨 Member Banned')
        .addFields(
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to ban member.', ephemeral: true });
    }
  }

  if (commandName === 'timeout') {
    const user = interaction.options.getUser('user');
    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    if (!member.moderatable) {
      return interaction.reply({ content: '❌ I cannot timeout this user. They may have higher roles than me.', ephemeral: true });
    }

    try {
      await member.timeout(duration * 60 * 1000, reason);
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⏰ Member Timed Out')
        .addFields(
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Duration', value: `${duration} minutes`, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to timeout member.', ephemeral: true });
    }
  }

  if (commandName === 'warn') {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#FFFF00')
      .setTitle('⚠️ Member Warned')
      .addFields(
        { name: 'User', value: `${user.tag}`, inline: true },
        { name: 'Moderator', value: `${interaction.user.tag}`, inline: true },
        { name: 'Reason', value: reason }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
    
    try {
      await member.send(`You have been warned in **${interaction.guild.name}**\nReason: ${reason}`);
    } catch (e) {
      await interaction.followUp({ content: '⚠️ Could not DM the user.', ephemeral: true });
    }
  }

  if (commandName === 'clear') {
    const amount = interaction.options.getInteger('amount');

    try {
      await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `✅ Deleted ${amount} messages.`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to delete messages. They might be older than 14 days.', ephemeral: true });
    }
  }

  // ==================== GIVEAWAY COMMANDS ====================

  if (commandName === 'gstart') {
    const duration = interaction.options.getString('duration');
    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners') || 1;

    const time = parseDuration(duration);
    if (!time) {
      return interaction.reply({ content: '❌ Invalid duration. Use format like: 1m, 1h, 1d', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor((Date.now() + time) / 1000)}:R>`)
      .setFooter({ text: `Hosted by ${interaction.user.tag}` })
      .setTimestamp(Date.now() + time);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('🎉 Enter Giveaway')
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
    const messageId = interaction.options.getString('message_id');
    const giveaway = activeGiveaways.get(messageId);
    
    if (!giveaway) {
      return interaction.reply({ content: '❌ Giveaway not found or already ended.', ephemeral: true });
    }

    if (giveaway.participants.size === 0) {
      return interaction.reply({ content: '❌ No participants to reroll.', ephemeral: true });
    }

    const winners = selectWinners(giveaway.participants, giveaway.winners);
    const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

    await interaction.reply(`🎉 **Rerolled!** New winner(s): ${winnerMentions}`);
  }
});

// Helper Functions
function parseDuration(str) {
  const regex = /(\d+)([smhd])/;
  const match = str.match(regex);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

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
        .setTitle('🎉 GIVEAWAY ENDED 🎉')
        .setDescription(`**Prize:** ${giveaway.prize}\n**Winner:** No valid entries`)
        .setTimestamp();

      message.edit({ embeds: [embed], components: [] });
      channel.send('😢 No one entered the giveaway!');
    } else {
      const winners = selectWinners(giveaway.participants, giveaway.winners);
      const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 GIVEAWAY ENDED 🎉')
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
