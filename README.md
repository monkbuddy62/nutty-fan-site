# Nutty Sucks™ — Official Fan Site

A prank website for the ages.

## Setup

### 1. Add your audio files

Copy all your `.wav` files into the `audio/` folder. The filenames must match exactly what's in `script.js`. The files are referenced by the exact names you gave me, so just drop them in and they'll work.

### 2. Test locally

Open `index.html` directly in your browser. Everything works offline — no server needed.

> **Note on audio:** Some browsers block audio on file:// URLs. If clips don't play locally, just push to GitHub Pages and test there — it works fine over https.

---

## Deploy to GitHub Pages

### First time setup

You'll need the [GitHub CLI](https://cli.github.com/) installed. If you have it:

```bash
cd ~/nutty-fan-site

# Initialize git
git init
git add .
git commit -m "launch the fan site"

# Create repo and push (replace YOUR_USERNAME)
gh repo create nutty-fan-site --public --source=. --remote=origin --push

# Enable GitHub Pages
gh api repos/YOUR_USERNAME/nutty-fan-site/pages \
  --method POST \
  -f "source[branch]=main" \
  -f "source[path]=/"
```

Your site will be live at: `https://YOUR_USERNAME.github.io/nutty-fan-site/`

(Takes about 60 seconds to go live the first time.)

---

### Pushing updates

Every time you change something:

```bash
cd ~/nutty-fan-site
git add .
git commit -m "update"
git push
```

The site updates automatically within ~60 seconds. No other steps needed.

---

## Adding new audio clips

1. Drop the `.wav` file into `audio/`
2. Add an entry to the `clips` array in `script.js`:
   ```js
   { label: 'Button Label Here', file: 'Your File Name.wav' },
   ```
3. Push.

---

## Combo easter egg

Press these three buttons in order to trigger the chaos combo:
**"I pee on him"** → **"Shoving bread in the hole"** → **"I will shit on this table"**
