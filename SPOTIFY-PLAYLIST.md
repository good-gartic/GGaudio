# Shared Spotify playlist in GGaudio

The optional playlist module shares GGaudio's existing client and DISCORD_BOT_TOKEN. It adds listeners without replacing Minecraft, channel visibility, or ping listeners. It upserts just `/playlist`, preserving other application commands. Startup failures disable playlist actions without destroying the existing client.

## Configure

Requires Node.js 22.12+ (24 recommended). Append the settings from `spotify-playlist.env.example` to the existing `.env`; do not replace the file or change DISCORD_BOT_TOKEN. The playlist ID is prefilled for the user's existing list. Set the Client ID from the Spotify developer app and Discord guild/channel IDs. JOCKIE_BOT_IDS must contain actual Jockie bot user IDs, comma-separated if using multiple bots. Enable Developer Mode in Discord to copy IDs. Both text channels can be the same.

Use `SPOTIFY_PLAYLIST_ENABLED=false` until ready. Enable Message Content Intent in the existing bot's Developer Portal settings (already required by GGaudio). Ensure the bot can view and send in the playlist channel and view/read history in Jockie's announcement channel. The existing installation needs the applications.commands scope for slash commands; reauthorize the same existing bot if needed. No new Discord application or token is required.

The Premium account owning the Spotify developer app must authorize access to a playlist it owns. Register exactly `http://127.0.0.1:8888/callback` as a redirect URI. Add the owner to the app's allowed users if required. The bot uses PKCE and never needs a Spotify Client Secret. Other Discord members do not authorize Spotify.

From the GGaudio project on the Pi:

```bash
npm ci
npm run build
npm run spotify:authorize
```

For authorization from a Windows browser, first open a second PowerShell terminal and keep this connection open:

```powershell
ssh -N -L 8888:127.0.0.1:8888 tim@eggdraw-pi
```

Open the authorization URL printed on the Pi in your Windows browser. After success, close the forwarding terminal. No public port forwarding is needed. Authorization stores a refresh token in `data/spotify-playlist/spotify-token.json`. Never commit that directory, upload it, or paste its contents into chat. Set the enable flag to true and restart GGaudio using its existing service/process manager. Do not start an additional bot instance.

## Commands

- Post one Spotify track link in PLAYLIST_CHANNEL_ID: add it, with duplicate prevention.
- `=add` / `=delete`: use the last fresh Jockie Started playing announcement from your voice channel. Requires a unique trusted Jockie in that voice channel.
- `=add <Spotify track link>` / `=delete <Spotify track link>`: select an exact song.
- Reply to a trusted Jockie announcement with either command to select that announcement explicitly, including an older announcement.
- `=undo`: reverse the last playlist change, only if Spotify's snapshot has not changed since. Removal deletes all copies; undo restores up to 100 copies at the end, not at original positions.
- `=playlist` and `=help`.
- `/playlist add`, `/playlist delete`, `/playlist undo`, `/playlist link`, `/playlist help`: private commands/replies. Optional track parameter accepts a full Spotify link.

All members with access to the configured channel can edit and undo the last shared change. No contributor IDs are persisted. Typed commands and pasted links remain visible; slash commands are preferable for anonymity. DELETE_INPUT_MESSAGES=true attempts to delete successful inputs and requires Manage Messages; deletion is not guaranteed anonymity.

## Limitations

Jockie's queue is independent of the saved playlist. Deleting does not skip or remove an already queued track. YouTube links and title matching are not implemented in this version.

The module reads announcements rather than a Jockie playback API. It requires Started playing, a single Spotify track link, and Length/Duration. Expiry uses the announced duration. Pauses may expire early, and a stopped track can remain selectable until expiry if Jockie stays in voice. Explicit links and replies select a known song. Restart clears announcement memory until the next announcement; voice channel changes clear that bot's current track.

Writes are serialized within one instance. Keep one running copy. Avoid external edits while issuing commands; API writes do not support full compare-and-swap isolation. Undo checks the playlist snapshot. If a write times out, playlist writes stop until restart reconciliation compares before/expected contents. Conflicting external edits cause the playlist module to refuse startup. Inspect the real playlist and pending journal before manually clearing `pending` in `data/spotify-playlist/state.json`. Existing Minecraft features keep running.

To disable the integration, set SPOTIFY_PLAYLIST_ENABLED=false and restart the existing service. This does not delete the saved Spotify playlist or token. If changing playlist IDs, archive the old state.json first; the module rejects state from a different playlist. Preserve Minecraft's separate data files.

## Verification and rollout

```bash
npm run test:playlist
```

Tests cover parsing the user's supplied announcement, duplicate prevention, undo, external-edit refusal, uncertain-write recovery, endpoint payloads, pagination, disabled initialization, command registration and Spotify failure isolation. Live OAuth, Discord embeds and Spotify writes need acceptance testing with the actual account. First exercise add/delete/undo with a disposable song, then verify Minecraft status and channel visibility still operate.

The integration is based on fix-voice-detection commit 507827f. Before deploying, compare the Pi's working tree and commit with that base: the Pi may contain unpushed changes. Never overwrite an existing Pi checkout or copy the old standalone project's .env over GGaudio's .env.

Official Spotify API documentation:
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
- https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist
