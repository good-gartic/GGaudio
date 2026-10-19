import "dotenv/config";
import { readFile, writeFile, mkdir } from "fs/promises";
import { Client, EmbedBuilder, Message, TextChannel, VoiceChannel } from "discord.js";
import { getChickenKills, getOnlinePlayers } from "./minecraft";
import { BOT_TOKEN } from './credentials';
import {
    CHANNELS,
    INACTIVITY_TIMEOUT,
    MINECRAFT_UPDATE_INTERVAL,
    MINECRAFT_STATUS_NAME_FORMAT,
    MINECRAFT_STATUS_EMPTY_NAME_FORMAT,
    MINECRAFT_RENAME_COOLDOWN
} from "./constants";
import { getHumanMemberCount, hideChannel, isCodeNamesVoiceChannel, isGarticPhoneVoiceChannel, isVoiceOrMusicChannel, showChannel } from "./utilities";
import { client } from "./client";

let voicechatTimeoutId: NodeJS.Timeout|undefined;
let codenamesChatTimeoutId: NodeJS.Timeout|undefined;
let garticphoneChatTimeoutId: NodeJS.Timeout|undefined;

let minecraftHideTimeoutId: NodeJS.Timeout|undefined;
let minecraftStatusMessageId: string|undefined;
let minecraftRenameCooldownUntil = 0;
let minecraftPendingName: string | undefined;

type MinecraftPlayerHistory = {
    lastSeen: number;
    chickenKills: number;
};

type MinecraftHistory = {
    players: Record<string, MinecraftPlayerHistory>;
    statusMessageId: string | null;
};

const MINECRAFT_HISTORY_FILE = "./data/minecraft-history.json";
const loadMinecraftHistory = async (): Promise<MinecraftHistory> => {
    try {
        const data = await readFile(MINECRAFT_HISTORY_FILE, "utf8");
        return JSON.parse(data);
    } catch {
        return {
            players: {},
            statusMessageId: null
        };
    }
};
const saveMinecraftHistory = async (history: MinecraftHistory) => {
    await mkdir("./data", { recursive: true });
    await writeFile(
        MINECRAFT_HISTORY_FILE,
        JSON.stringify(history, null, 2)
    );
};


let minecraftPlayerHistory: Record<string, MinecraftPlayerHistory> = {};

const updateMinecraftStatusChannelName = async (playerCount: number) => {
    try {
        const minecraftStatusChannel = client.channels.cache.get(
            CHANNELS.MINECRAFT_STATUS_CHANNEL
        ) as TextChannel;

        if (!minecraftStatusChannel) {
            console.error("Minecraft status channel not found for rename.");
            return;
        }

        const nameFormat = playerCount > 0
            ? MINECRAFT_STATUS_NAME_FORMAT
            : MINECRAFT_STATUS_EMPTY_NAME_FORMAT;

        const newName = nameFormat.replace(
            "{}",
            String(playerCount)
        );

        // The name is already correct.
        // Do NOT consume/reset the rename cooldown.
        if (minecraftStatusChannel.name === newName) {
            minecraftPendingName = undefined;
            return;
        }

        // Remember the name we actually want.
        minecraftPendingName = newName;

        const now = Date.now();

        // Discord rename cooldown is still active.
        // Don't attempt another rename.
        if (now < minecraftRenameCooldownUntil) {
            return;
        }

        const pendingName = minecraftPendingName;

        if (!pendingName) {
            return;
        }

        console.log(
            `Renaming Minecraft status channel to: ${pendingName}`
        );

        await minecraftStatusChannel.edit({
            name: pendingName,
            reason: "Minecraft player count update"
        });

        minecraftPendingName = undefined;

        // Start our own conservative cooldown after a successful rename.
        minecraftRenameCooldownUntil =
            Date.now() + MINECRAFT_RENAME_COOLDOWN;

        console.log(
            `Minecraft status channel renamed to: ${pendingName}`
        );

    } catch (error: any) {

        if (error?.status === 429) {
            const retryAfter =
                Number(
                    error?.retry_after ??
                    error?.rawError?.retry_after ??
                    300
                );

            minecraftRenameCooldownUntil =
                Date.now() + retryAfter * 1000;

            console.log(
                `Minecraft status channel rename rate limited. ` +
                `Waiting ${retryAfter}s.`
            );

            return;
        }

        console.error(
            "Minecraft status channel rename failed:",
            error
        );
    }
};

const updateMinecraftStatus = async () => {
    try {
        const players = await getOnlinePlayers();
        
        // Update the channel name if necessary.
        // This function handles the Discord rename cooldown itself.
        await updateMinecraftStatusChannelName(players.length);
        
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

        
        // Remember when each currently-online player was last seen,
        // and update their chicken-kill total.
        for (const player of players) {
            const chickenKills = await getChickenKills(player);

            minecraftPlayerHistory[player] = {
                lastSeen: now,
                chickenKills
            };
        }

        await saveMinecraftHistory({
            players: minecraftPlayerHistory,
            statusMessageId: minecraftStatusMessageId ?? null
        });

        const recentPlayers = Object.entries(minecraftPlayerHistory)
            .filter(([player, history]) =>
                history.lastSeen >= oneDayAgo && !players.includes(player)
            )
            .map(([player, history]) =>
                `${player} — chickens killed 🐔 ${history.chickenKills}`
            );

const monthlyPlayers = Object.entries(minecraftPlayerHistory)
    .filter(([player, history]) =>
        history.lastSeen >= oneMonthAgo &&
        !players.includes(player) &&
        history.lastSeen < oneDayAgo
    )
    .map(([player, history]) =>
        `${player} — chickens killed 🐔 ${history.chickenKills}`
    );

        const minecraftStatusChannel = client.channels.cache.get(
            CHANNELS.MINECRAFT_STATUS_CHANNEL
        ) as TextChannel;

        if (!minecraftStatusChannel) {
            console.error("Minecraft status channel not found.");
            return;
        }

    const onlineLines = players.map(player => {
        const history = minecraftPlayerHistory[player];
        const chickenKills = history?.chickenKills ?? 0;

        return `🟢 ${player} — chickens killed 🐔 ${chickenKills}`;
    });

    const embed = new EmbedBuilder()
        .setTitle("🎮 Minecraft")
        .addFields(
            {
                name: "🟢 Online now",
                value: onlineLines.length > 0
                    ? onlineLines.join("\n")
                    : "Nobody is currently playing."
            },
            {
                name: "🕐 Played in the last 24 hours",
                value: recentPlayers.length > 0
                    ? recentPlayers.join("\n")
                    : "Nobody else."
            },
            {
                name: "📅 Played in the last 30 days",
                value: monthlyPlayers.length > 0
                    ? monthlyPlayers.join("\n")
                    : "Nobody else."
            }
        )
        .setFooter({
            text: `Online: ${players.length} • Chicken kills are tracked permanently`
        })
        .setTimestamp();

            if (minecraftStatusMessageId) {
                try {
                    const message = await minecraftStatusChannel.messages.fetch(
                        minecraftStatusMessageId
                    );

                    await message.edit({ embeds: [embed] });
                    return;
                } catch {
                    minecraftStatusMessageId = undefined;
                }
            }

            // If we don't know the message ID, look for an existing GG Bot message.
            const messages = await minecraftStatusChannel.messages.fetch({
                limit: 20
            });

            const existingMessage = messages.find(
                message =>
                    message.author.id === client.user?.id &&
                    message.embeds.length > 0 &&
                    message.embeds[0].title === "🎮 Minecraft"
            );

            if (existingMessage) {
                minecraftStatusMessageId = existingMessage.id;
                await saveMinecraftHistory({
                    players: minecraftPlayerHistory,
                    statusMessageId: minecraftStatusMessageId
});

                await existingMessage.edit({
                    embeds: [embed]
                });

                return;
            }

            const message = await minecraftStatusChannel.send({
                embeds: [embed]
            });

            minecraftStatusMessageId = message.id;
            await saveMinecraftHistory({
                players: minecraftPlayerHistory,
                statusMessageId: minecraftStatusMessageId
});

    } catch (error) {
        console.error("Minecraft status update failed:", error);
    }
};

const updateMinecraftVisibility = async () => {
    try {
        const players = await getOnlinePlayers();

        const minecraftVoiceChannel = client.channels.cache.get(
            CHANNELS.MINECRAFT_VOICE_CHANNEL
        ) as VoiceChannel;

        const minecraftVoiceMembers = minecraftVoiceChannel
            ? getHumanMemberCount(minecraftVoiceChannel)
            : 0;

        const minecraftChannelGroup = client.channels.cache.get(
            CHANNELS.MINECRAFT_CHANNEL_GROUP
        ) as TextChannel;

        const minecraftStatusChannel = client.channels.cache.get(
            CHANNELS.MINECRAFT_STATUS_CHANNEL
        ) as TextChannel;

        if (!minecraftChannelGroup || !minecraftStatusChannel) {
            console.error(
                "Minecraft category or status channel not found."
            );
            return;
        }

        // The status channel is ALWAYS visible.
        showChannel(minecraftStatusChannel);

        // ====================================================
        // MINECRAFT ACTIVE
        // ====================================================

        if (players.length > 0 || minecraftVoiceMembers > 0) {

            // Someone is using Minecraft.
            // Cancel the pending hide timer.
            clearTimeout(minecraftHideTimeoutId);
            minecraftHideTimeoutId = undefined;

            // Show the Minecraft category.
            // Its child channels inherit this visibility.
            showChannel(minecraftChannelGroup);

        }

        // ====================================================
        // MINECRAFT INACTIVE
        // ====================================================

        else {

            // Nobody is playing and nobody is in the Minecraft
            // voice channel.

            if (!minecraftHideTimeoutId) {

                console.log(
                    "Minecraft inactive. Starting 1 hour hide timer."
                );

                minecraftHideTimeoutId = setTimeout(async () => {

                    console.log(
                        "Minecraft inactive for 1 hour. Hiding Minecraft category."
                    );

                    // Hide the CATEGORY.
                    // Its child channels should inherit this.
                    hideChannel(minecraftChannelGroup);

                    // DO NOT hide the status channel.
                    // It must remain visible permanently.

                    minecraftHideTimeoutId = undefined;

                }, INACTIVITY_TIMEOUT);
            }
        }

    } catch (error) {
        console.error(
            "Minecraft visibility update failed:",
            error
        );
    }
};

// Event: Bot is ready
client.once('ready', async() => {
    if (client.user) {
        console.log(`Logged in as ${client.user.tag}!`);
    } else {
        console.log('Logged in, but client.user is null.');
    }
    
    const minecraftHistory = await loadMinecraftHistory();

    minecraftPlayerHistory = minecraftHistory.players;
    minecraftStatusMessageId = minecraftHistory.statusMessageId ?? undefined;
    
    await updateMinecraftStatus();
    await updateMinecraftVisibility();

    setInterval(updateMinecraftStatus, MINECRAFT_UPDATE_INTERVAL);
    setInterval(updateMinecraftVisibility, MINECRAFT_UPDATE_INTERVAL);
});



// Event: Message received
client.on('messageCreate', (message: Message) => {
    if (message.author.bot) return;
    if (message.channelId === CHANNELS.PING_CHANNEL) {
        if (message.mentions.roles.has(CHANNELS.CODENAMES_PING)) {
            const pingsChannel = message.channel as TextChannel;
            const codenamesChannelGroup = client.channels.cache.get(CHANNELS.CODENAMES_CHAT_CHANNEL_GROUP) as TextChannel;
            showChannel(codenamesChannelGroup);
            pingsChannel.send(`Codenames Portal opened \n\n Quick someone, join the <#${CHANNELS.CODENAMES_VOICE_CHANNEL}> to keep the portal open\n chat here <#${CHANNELS.CODENAMES_CHAT_CHANNEL}>`);
            clearTimeout(codenamesChatTimeoutId);
            codenamesChatTimeoutId = setTimeout(hideChannel, INACTIVITY_TIMEOUT, codenamesChannelGroup);
        }
        if (message.mentions.roles.has(CHANNELS.GARTICPHONE_PING)) {
            const pingsChannel = message.channel as TextChannel;
            const garticphoneChannelGroup = client.channels.cache.get(CHANNELS.GARTICPHONE_CHANNEL_GROUP) as TextChannel;
            showChannel(garticphoneChannelGroup);
            pingsChannel.send(`Garticphone Portal opened \n\n Join the <#${CHANNELS.GARTICPHONE_VOICE_CHANNEL}> to keep the portal open\n chat here <#${CHANNELS.GARTICPHONE_CHAT_CHANNEL}>`);
            clearTimeout(garticphoneChatTimeoutId);
            garticphoneChatTimeoutId = setTimeout(hideChannel, INACTIVITY_TIMEOUT, garticphoneChannelGroup);
        }
    }
    
});

// Event: Voice State Update
client.on('voiceStateUpdate', (oldState, newState) => {

    if (isVoiceOrMusicChannel(oldState.channelId) || isVoiceOrMusicChannel(newState.channelId)) {
        const voiceChannel = client.channels.cache.get(CHANNELS.VOICE_CHANNEL) as VoiceChannel;
        const musicChannel = client.channels.cache.get(CHANNELS.MUSIC_CHANNEL) as VoiceChannel;
        const voiceChatChannelGroup = client.channels.cache.get(CHANNELS.MUSIC_CHAT_CHANNEL_GROUP) as TextChannel;

        const memberCount = getHumanMemberCount(voiceChannel) + getHumanMemberCount(musicChannel);

        if (memberCount < 1) {
            clearTimeout(voicechatTimeoutId);
            voicechatTimeoutId = setTimeout(hideChannel, INACTIVITY_TIMEOUT, voiceChatChannelGroup);
        } else {
            clearTimeout(voicechatTimeoutId);
            showChannel(voiceChatChannelGroup);
        }
    }
    if ( isCodeNamesVoiceChannel(oldState.channelId) ) {
        const codenamesVoiceChannel = client.channels.cache.get(CHANNELS.CODENAMES_VOICE_CHANNEL) as VoiceChannel;
        const codenamesChannelGroup = client.channels.cache.get(CHANNELS.CODENAMES_CHAT_CHANNEL_GROUP) as TextChannel;
        const memberCount = getHumanMemberCount(codenamesVoiceChannel);
        
        if(memberCount < 1) {
            clearTimeout(codenamesChatTimeoutId);
            codenamesChatTimeoutId = setTimeout(hideChannel, INACTIVITY_TIMEOUT, codenamesChannelGroup);
        } else {
            clearTimeout(codenamesChatTimeoutId);
            showChannel(codenamesChannelGroup);
        }

    }
    if ( isGarticPhoneVoiceChannel(oldState.channelId) ) {
        const garticphoneVoiceChannel = client.channels.cache.get(CHANNELS.GARTICPHONE_VOICE_CHANNEL) as VoiceChannel;
        const garticphoneChannelGroup = client.channels.cache.get(CHANNELS.GARTICPHONE_CHANNEL_GROUP) as TextChannel;
        const memberCount = getHumanMemberCount(garticphoneVoiceChannel);
        
        if(memberCount < 1) {
            clearTimeout(garticphoneChatTimeoutId);
            garticphoneChatTimeoutId = setTimeout(hideChannel, INACTIVITY_TIMEOUT, garticphoneChannelGroup);
        } else {
            clearTimeout(garticphoneChatTimeoutId);
            showChannel(garticphoneChannelGroup);
        }

    }
});

// Optional playlist module shares the existing Discord client and token.
if (process.env.SPOTIFY_PLAYLIST_ENABLED === "true") {
    try {
        const { installPlaylist } = require("./playlist/install");
        installPlaylist(client);
    } catch (error) {
        console.error("Playlist feature failed to load; existing features remain active.");
    }
}

client.login(BOT_TOKEN);
