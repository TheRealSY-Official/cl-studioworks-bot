const Discord = require('discord.js');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

const PREFIX = '!';
const activeGiveaways = new Map();

// Bot Ready Event
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);
  client.user.setActivity('C.L. StudioWorks', { type: 'WATCHING' });
});

// Message Handler
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ==================== MODERATION COMMANDS ====================
  
  // Kick Command
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply('❌ You need the "Kick Members" permission.');
    }

    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Please mention a user to kick.');

    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      await member.kick(reason);
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('🥾 Member Kicked')
        .addFields(
          { name: 'User', value: `${member.user.tag}`, inline: true },
          { name: 'Moderator', value: `${message.author.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      message.reply('❌ Failed to kick member. Check my permissions.');
    }
  }

  // Ban Command
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply('❌ You need the "Ban Members" permission.');
    }

    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Please mention a user to ban.');

    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      await member.ban({ reason });
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🔨 Member Banned')
        .addFields(
          { name: 'User', value: `${member.user.tag}`, inline: true },
          { name: 'Moderator', value: `${message.author.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      message.reply('❌ Failed to ban member. Check my permissions.');
    }
  }

  // Timeout/Mute Command
  if (command === 'timeout' || command === 'mute') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ You need the "Moderate Members" permission.');
    }

    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Please mention a user to timeout.');

    const duration = parseInt(args[1]);
    if (!duration || duration < 1) {
      return message.reply('❌ Please specify a duration in minutes (1-40320).');
    }

    const reason = args.slice(2).join(' ') || 'No reason provided';

    try {
      await member.timeout(duration * 60 * 1000, reason);
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⏰ Member Timed Out')
        .addFields(
          { name: 'User', value: `${member.user.tag}`, inline: true },
          { name: 'Duration', value: `${duration} minutes`, inline: true },
          { name: 'Moderator', value: `${message.author.tag}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      message.reply('❌ Failed to timeout member. Check my permissions.');
    }
  }

  // Warn Command
  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ You need moderation permissions.');
    }

    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Please mention a user to warn.');

    const reason = args.slice(1).join(' ') || 'No reason provided';

    const embed = new EmbedBuilder()
      .setColor('#FFFF00')
      .setTitle('⚠️ Member Warned')
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'Moderator', value: `${message.author.tag}`, inline: true },
        { name: 'Reason', value: reason }
      )
      .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
    
    try {
      await member.send(`You have been warned in **${message.guild.name}**\nReason: ${reason}`);
    } catch (e) {
      message.channel.send('⚠️ Could not DM the user.');
    }
  }

  // Clear/Purge Messages
  if (command === 'clear' || command === 'purge') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('❌ You need the "Manage Messages" permission.');
    }

    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
      return message.reply('❌ Please specify a number between 1 and 100.');
    }

    try {
      await message.channel.bulkDelete(amount + 1, true);
      const reply = await message.channel.send(`✅ Deleted ${amount} messages.`);
      setTimeout(() => reply.delete(), 3000);
    } catch (error) {
      message.reply('❌ Failed to delete messages. They might be older than 14 days.');
    }
  }

  // ==================== GIVEAWAY COMMANDS ====================

  // Start Giveaway
  if (command === 'gstart' || command === 'giveaway') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('❌ You need the "Manage Server" permission.');
    }

    const duration = args[0];
    const winners = parseInt(args[1]) || 1;
    const prize = args.slice(2).join(' ');

    if (!duration || !prize) {
      return message.reply('❌ Usage: `!gstart <duration> <winners> <prize>`\nExample: `!gstart 1h 1 Discord Nitro`');
    }

    const time = parseDuration(duration);
    if (!time) {
      return message.reply('❌ Invalid duration. Use format like: 1m, 1h, 1d');
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor((Date.now() + time) / 1000)}:R>`)
      .setFooter({ text: `Hosted by ${message.author.tag}` })
      .setTimestamp(Date.now() + time);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('🎉 Enter Giveaway')
          .setStyle(ButtonStyle.Primary)
      );

    const giveawayMsg = await message.channel.send({ embeds: [embed], components: [row] });

    const giveawayData = {
      messageId: giveawayMsg.id,
      channelId: message.channel.id,
      guildId: message.guild.id,
      prize,
      winners,
      endTime: Date.now() + time,
      host: message.author.id,
      participants: new Set()
    };

    activeGiveaways.set(giveawayMsg.id, giveawayData);

    setTimeout(() => endGiveaway(giveawayMsg.id), time);
    message.delete().catch(() => {});
  }

  // Reroll Giveaway
  if (command === 'greroll') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('❌ You need the "Manage Server" permission.');
    }

    const messageId = args[0];
    if (!messageId) {
      return message.reply('❌ Please provide the giveaway message ID.');
    }

    const giveaway = activeGiveaways.get(messageId);
    if (!giveaway) {
      return message.reply('❌ Giveaway not found or already ended.');
    }

    if (giveaway.participants.size === 0) {
      return message.reply('❌ No participants to reroll.');
    }

    const winners = selectWinners(giveaway.participants, giveaway.winners);
    const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

    message.channel.send(`🎉 **Rerolled!** New winner(s): ${winnerMentions}`);
  }

  // Help Command
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('🤖 C.L. StudioWorks Bot - Commands')
      .setDescription('Moderation and Giveaway Bot')
      .addFields(
        { 
          name: '🛡️ Moderation', 
          value: '`!kick @user [reason]`\n`!ban @user [reason]`\n`!timeout @user <minutes> [reason]`\n`!warn @user [reason]`\n`!clear <amount>`' 
        },
        { 
          name: '🎉 Giveaways', 
          value: '`!gstart <duration> <winners> <prize>`\n`!greroll <message_id>`\nExample: `!gstart 1h 1 Discord Nitro`' 
        }
      )
      .setFooter({ text: 'C.L. StudioWorks' })
      .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
  }
});

// Button Interaction Handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

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
