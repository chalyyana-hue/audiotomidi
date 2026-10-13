# Audio to MIDI (with key correction)

A static website. Upload audio, detect notes with Spotify's Basic Pitch model in the browser, snap the notes to a key and scale, and download a .mid file. No server needed.

## Put it on GitHub Pages

1. Create a new GitHub repository (for example `audio-to-midi`).
2. Upload `index.html`, `app.js` and this README to the repository root.
3. Go to Settings > Pages. Under "Build and deployment", choose "Deploy from a branch", branch `main`, folder `/ (root)`, then Save.
4. After a minute your site is at `https://YOUR-USERNAME.github.io/audio-to-midi/`.

## How to use

1. Choose an audio file. Wait for the notes to appear in the piano roll.
2. Under "Key and scale", pick the real scale and root if you know them. Leave Auto if you do not.
3. Notes outside the scale are moved to the nearest scale note (amber in the piano roll). Use "Custom" for scales such as Khmer or Thai modes: pick which of the 12 scale degrees are allowed.
4. Tune detection: lower onset sensitivity finds more notes, a higher "ignore quieter than" removes ghost notes.
5. Set the tempo and quantize grid if you want notes on the beat.
6. Download the MIDI file.

Tip: for full songs, split the audio into stems first (vocals, bass, other) with a tool like Moises or Demucs, then convert each stem. Results are much cleaner.

## Optional: host the model yourself

By default the model loads from jsDelivr. To host it in your repo instead:

1. Create a folder named `model` in the repository.
2. Download these two files into it, keeping the names:
   - https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json
   - https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/group1-shard1of1.bin

The page checks for `./model/model.json` and uses it when present.

## Troubleshooting

- **Blank page or "Could not process this file"**: open the browser console (F12). If the import from esm.sh fails, replace the import URL at the top of `app.js` with `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/+esm`.
- **Opening index.html by double-click does not work**: browsers block module scripts on `file://`. Use the GitHub Pages URL, or run `python3 -m http.server` in the folder and open `http://localhost:8000`.
- **Slow on long files**: analysis runs on your device. Try clips under a few minutes.
- **Notes are still wrong**: set the scale yourself instead of Auto, raise "Onset sensitivity" and "Ignore quieter than", and use stems instead of a full mix.

## Credits

Basic Pitch by Spotify (Apache 2.0), TensorFlow.js.
