# Nutty Sucks™ — Shooting Gallery

Photos and videos of Nutty float around the screen. You shoot them. A Nutty audio clip plays on every kill.

## Adding media

### Step 1 — Windows (where your files are)
```powershell
mkdir nutty-fan-site\media
# drag all your photos/videos into that folder
cd nutty-fan-site
git add .
git commit -m "add media"
git push
```

### Step 2 — Linux box (one-time setup + every time you add files)
```bash
cd ~/nutty-fan-site
git pull
sudo apt install imagemagick   # first time only
bash convert-heic.sh           # converts HEICs → JPG
python3 build-manifest.py      # scans media/ and writes manifest.json
git add . && git commit -m "update media" && git push
```

Site updates at https://monkbuddy62.github.io/nutty-fan-site/ within ~60 seconds.

## File size limits
- GitHub blocks files over 100MB — trim long MP4s if needed
- Repo soft limit is 1GB total — fine for ~100 photos + short clips

## Local testing
The site needs a web server to load media (browser blocks fetch on file://).
Quick option: `python3 -m http.server` then open http://localhost:8000
