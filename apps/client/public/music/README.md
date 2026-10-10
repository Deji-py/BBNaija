# Party DJ set

The mixer plays whatever is listed in `setlist.json`, blending tracks with an 8-second crossfade when someone starts the party.

**Do not drop commercial Nigerian hits here.** We cannot ship Wizkid, Burna Boy, Davido, Asake, Rema or any other copyrighted record.

The files in this folder are original Afrobeats-style instrumentals generated for the house (`pnpm --filter @bbn/client music:afrobeats`). To use your own set, put royalty-free tracks (Pixabay Content License or similar — a licence that allows public use inside a game) in this folder, delete the generated wavs if you want, then run:

```
pnpm --filter @bbn/client music
```
