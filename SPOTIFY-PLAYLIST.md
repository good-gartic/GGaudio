# Shared Spotify playlist in GGaudio

The optional playlist module shares GGaudio's existing client and DISCORD_BOT_TOKEN. It adds listeners without replacing Minecraft, channel visibility, or ping listeners. It upserts just `/playlist`, preserving other application commands. Startup failures disable playlist actions without destroying the existing client.

## Configure

Requires Node.js 22.12+ (24 recommended). Append the settings from `spotify-playlist.env.example` to the existing `.env`; do not replace the file or change DISCORD_BOT_TOKEN. The playlist ID is prefilled for the user's existing list. Set the Client ID from the Spotify developer app and Discord guild/channel IDs. JOCKIE_BOT_IDS must contain actual Jockie bot user IDs, comma-separated if using multiple bots. Enable Developer Mode in Discord to copy IDs. PLAYLIST_CHANNEL_ID remains required and allowed. Optionally set PLAYLIST_CHANNEL_IDS to additional comma-separated channel IDs; surrounding whitespace, empty entries and duplicates are ignored. Include the designated music text channel and any voice channels whose built-in text chats should accept commands (copy the voice channel ID). JOCKIE_CHANNEL_ID remains required; optional JOCKIE_CHANNEL_IDS adds comma-separated trusted announcement channels. These are separate from command channels. An announcement channel can also be an allowed playlist channel.

Use `SPOTIFY_PLAYLIST_ENABLED=false` until ready. Enable Message Content Intent in the existing bot's Developer Portal settings (already required by GGaudio). Ensure the bot can view and send in every allowed playlist channel (including voice-channel text chats) and view/read history in every configured Jockie announcement channel. The existing installation needs the applications.commands scope for slash commands; reauthorize the same existing bot if needed. No new Discord application or token is required.

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

- Post one Spotify track link in any allowed playlist channel: add it, with duplicate prevention.
- `=add` / `=delete`: use the last fresh Jockie Started playing announcement from your voice channel. Requires a unique trusted Jockie in that voice channel.
- `=add <Spotify track link>` / `=delete <Spotify track link>`: select an exact song.
- Reply to a trusted Jockie announcement with either command to select that announcement explicitly, including an older announcement.
- `=undo`: reverse the last playlist change, only if Spotify's snapshot has not changed since. Removal deletes all copies; undo restores up to 100 copies at the end, not at original positions.
- `=playlist` and `=help`.
- `/playlist add`, `/playlist delete`, `/playlist undo`, `/playlist link`, `/playlist help`: private commands/replies. Optional track parameter accepts a full Spotify link.

Prefix commands, pasted Spotify links, private `/playlist` commands and match-confirmation buttons all require the configured guild and an allowed channel. Other channels are ignored for message commands; slash commands and buttons receive private refusals. This allowlist does not change Discord channel permissions or grant access. Jockie announcements are accepted only from the configured announcement channels and trusted JOCKIE_BOT_IDS.

All members with access to an allowed channel can edit and undo the last shared change. No contributor IDs are persisted. Typed commands and pasted links remain visible; slash commands are preferable for anonymity. DELETE_INPUT_MESSAGES=true attempts to delete successful inputs and requires Manage Messages; deletion is not guaranteed anonymity.

## Limitations

Jockie's queue is independent of the saved playlist. Deleting does not skip or remove an already queued track. Raw non-Spotify links alone are not accepted. Reply to a Jockie announcement or use a fresh announcement in your voice channel for cross-source matching.

The module reads announcements rather than a Jockie playback API. It requires Started playing, a Spotify track link or a readable Playing field (linked title/artist or unambiguous `Artist - Title` metadata), plus Length/Duration. The Started playing label can be in the embed author or title. Expiry uses the announced duration. Pauses may expire early, and a stopped track can remain selectable until expiry if Jockie stays in voice. Explicit links and replies select a known song. Bare commands refresh the latest 100 messages per configured announcement channel, recovering pre-startup announcements using their original timestamps and duration. Expired or unreadable latest announcements cannot revive an older song. A Jockie voice change observed by GGaudio invalidates announcements from before the move.

Writes are serialized within one instance. Keep one running copy. Avoid external edits while issuing commands; API writes do not support full compare-and-swap isolation. Undo checks the playlist snapshot. If a write times out, playlist writes stop until restart reconciliation compares before/expected contents. Conflicting external edits cause the playlist module to refuse startup. Inspect the real playlist and pending journal before manually clearing `pending` in `data/spotify-playlist/state.json`. Existing Minecraft features keep running.

To disable the integration, set SPOTIFY_PLAYLIST_ENABLED=false and restart the existing service. This does not delete the saved Spotify playlist or token. If changing playlist IDs, archive the old state.json first; the module rejects state from a different playlist. Preserve Minecraft's separate data files.

## Verification and rollout

```bash
npm run test:playlist
```

Tests cover parsing the user's supplied announcement, duplicate prevention, undo, external-edit refusal, uncertain-write recovery, endpoint payloads, pagination, disabled initialization, command registration, allowed/disallowed channels across playlist entry points, and Spotify failure isolation. Live OAuth, Discord embeds and Spotify writes need acceptance testing with the actual account. First exercise add/delete/undo with a disposable song, then verify Minecraft status and channel visibility still operate.

The integration is based on fix-voice-detection commit 507827f. Before deploying, compare the Pi's working tree and commit with that base: the Pi may contain unpushed changes. Never overwrite an existing Pi checkout or copy the old standalone project's .env over GGaudio's .env.

Official Spotify API documentation:
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
- https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist


## Cross-source matching update

Jockie announcements from Deezer, Apple Music, Tidal, SoundCloud, YouTube and other sources can be parsed using their common title/artist/duration fields. This does not mean every source track exists on Spotify or every custom announcement format is supported. No audio is fetched or converted.

Direct Spotify IDs remain immediate. Other-source tracks use a previously confirmed source mapping or present up to five Spotify candidates with Choose buttons. Nothing changes before confirmation. Only the requester may confirm; choices expire after two minutes and are single-use. Slash-command choices stay private. A change of playing song does not change the song selected by an already-issued confirmation prompt.

For additions, Deezer metadata ISRC lookup is attempted on the fixed api.deezer.com host with a five-second timeout, then Spotify ISRC search. Missing/unavailable Deezer metadata falls back to Spotify artist/title search. Other sources use announcement metadata without fetching their URLs. Candidates must match normalized title and artist closely; duration ranks candidates, while version labels remain significant. All first-time cross-source matches require confirmation, including ISRC matches.

For deletions, candidates are drawn only from the current managed playlist, rather than the wider Spotify catalogue. Confirmed source URL-to-track-ID mappings are saved in data/spotify-playlist/source-mappings.json, with no contributor IDs. YouTube video and Apple track query identifiers are retained; tracking parameters are discarded. Clear a mistaken mapping in that private local file while the service is stopped, or select an explicit Spotify track link for the immediate action.

These checks use mocked APIs. Live cross-source search and confirmation must be checked on the Pi after deployment. Spotify search access errors are reported without changing the playlist. No new credentials or scopes are required.

## Metadata-only Jockie announcements

A Playing value such as `GRAVEYARD TRAIN - Mummy.mp4` also works without a URL or separate artist field. The parser preserves the original Playing text and removes a recognized trailing audio/video extension only for search. Spaced hyphens produce alternative Artist - Title, Title - Artist, and Film/album - Title - Artist search interpretations, including hyphens within either name. If those fail, it searches the full title without assigning an artist, then a title following a film/album prefix. Searches stop at the first matching interpretation; duplicate Spotify IDs are removed. Empty components are rejected. Parentheses and meaningful live/remix/version labels remain significant. Duration ranks recordings without excluding longer recordings of excerpts or edits. Every metadata-only selection requires explicit requester confirmation and never saves a speculative mapping. A Playing title without a separator is handled as title-only metadata.

Metadata-only selections use Spotify matching and require requester confirmation before every edit. They are never stored in the source URL mapping cache, so unrelated announcements cannot share an empty URL key. Existing URL-based confirmed mappings continue to work.

## Bare-command diagnostics and history recovery

Bare `=add`/`=delete` and slash commands without a track require the requester and trusted Jockie to share a voice channel. Every attempt refreshes bounded announcement history; unavailable history causes a refusal rather than selecting potentially stale cached playback. Only the latest Started playing message per trusted bot counts, including an unreadable latest message. Recovery never resets playback time to fetch time. No server-wide song fallback is used. If a channel has more than 100 recent messages, older announcements may be unavailable; reply explicitly or supply a Spotify link. Moves during GGaudio downtime and pauses/stops cannot be reconstructed from announcement history; original-duration expiry and current voice membership still apply.

Errors distinguish requester absence, no trusted Jockie in that voice channel, missing announcements, unreadable announcements, pre-move announcements, expiry, multiple fresh candidates and unavailable history. `Playlist live:` logs include reason codes, channel/message/bot IDs, timestamps and voice IDs. Observation also diagnoses untrusted bots and unconfigured announcement channels. No announcement content, song metadata or credentials are logged. A reply selects an explicit announcement and may intentionally use an older song, so reply success does not establish freshness for a bare command.

## Title-only announcements

Trusted Started playing announcements with only a Playing title and Length are accepted without inventing an artist or source. Spotify searches use the original title first; a fallback removes only a whole `(Best Version Ever)` or `[Best Version Ever]` annotation. Keys, catalogue numbers, movements and meaningful version labels remain intact. Candidate titles must match the original or fallback title after normalization; different recordings are ranked by duration and shown with their actual artists and durations. Every title-only add/delete requires requester confirmation and is never cached. Deletions consider only tracks in the managed playlist.

Freshness remains original timestamp plus duration. A 23:41 announcement lasting 09:20 expires at 23:50:20, so bare commands at 00:14 reject it as expired. An explicit reply may select that older song and presents confirmation choices.

## General video and unstructured metadata matching

The parser retains the original Playing text and explicit `by Artist` metadata. Search hypotheses can use a parenthetical song title with that artist, alternate spaced-hyphen interpretations, a film/album context, or the full unstructured text. Bracketed video context can produce an additional query without changing the stored announcement. No artist is guessed by splitting unstructured words, and no YouTube API is used.

Candidate retrieval and ranking are separate. Each resolution makes at most 12 metadata searches, trying precise queries followed by full-text and broader queries as needed. Results are deduplicated by Spotify track ID; retrieval stops once useful evidence exists. Ranking compares title tokens, named or returned artist metadata, context and duration. Duration ranks recordings rather than excluding excerpts or edits. Conflicting keys, catalogue numbers and meaningful version labels remain significant. At most five plausible recordings are offered with their actual names, artists, durations and Spotify links. Weaker results are labeled `Possible matches—please check` and always need requester confirmation. Uncertain matches are not eligible for saved source mappings, even after confirmation; metadata-only matches are never cached.

Deletion ranks only recordings already in the managed playlist. Existing confirmed URL mappings and explicit Spotify links still identify known recordings; the editor checks playlist membership before deleting. API access and rate-limit errors remain errors, rather than becoming no-match responses. Resolver diagnostics distinguish returned results from accepted candidates for each retrieval stage without recording announcement text or credentials. Spotify search is bounded and relevance-dependent, so a plausible recording can still be unavailable in the returned results; an explicit Spotify link remains the fallback.

## Recording-level duplicate prevention

Every addition path checks a fresh, consistent playlist snapshot inside the serialized editor. An identical Spotify ID is refused immediately. A case-insensitive, non-empty ISRC match also refuses alternate-release IDs and shows the existing playlist recording. Missing or blank ISRCs never match each other.

Similar title and artist metadata within ten seconds of duration produces `This may already be in the playlist`, showing the existing and proposed recordings with links and durations. This remains a warning even when both recordings have different ISRCs. Only the requester can choose `Add anyway` or `Cancel` in an allowed command channel; buttons expire after two minutes and are single-use. Confirmation reads metadata and the current playlist again. It cannot override an ID or ISRC duplicate; newly discovered metadata duplicates produce a fresh warning. Meaningful version suffixes, live dates, named remixes and different cover artists remain distinct without a confirmed shared ISRC.

Warnings, refusals and cancellations do not write the playlist, replace undo, or save a source mapping. A completed addition creates the normal undo entry. Undo of a deletion restores the intended original IDs/copy count rather than applying the new-add duplicate rules. No persistent state migration is required. The single-track metadata endpoint is required for new additions; access failures and rate limits refuse the addition before creating a pending write. Spotify can omit ISRCs or metadata, and its API provides no atomic protection against edits by other clients between the final read and write. Keep one running GGaudio instance and avoid concurrent external playlist edits.
