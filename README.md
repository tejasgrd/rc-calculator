# RC Calc

An offline toolkit for designing, building and flying RC planes. Everything runs in the browser.

| Page | What it does |
|---|---|
| `rc-plane-calculator.html` | Calculator: power system, wing loading and flight-time estimates, with explanations |
| `designer.html` | Aircraft Designer in 9 steps: sizing, airfoil, geometry, stability, wing analysis, performance, power system, 3D model, save and compare |
| `build.html` | Printable build templates (foam/Depron or balsa; A4, A5 or Letter paper) and a parts list |
| `guide.html` | Build guide and encyclopedia: every fundamental with live widgets, two worked Depron examples (trainer and flying wing) built step by step with the tools, and an A–Z glossary |
| `simulator.html` | Flight simulator (three.js): fly your designs, lessons with an instructor, weather, flight-log calibration, replay |

There's no build step, no server and no install. The pages are plain HTML with classic scripts, and three.js is already bundled in `assets/vendor/`.

## Run it on any machine

1. Get the files:
   ```bash
   git clone <your-repo-url> rc-calc
   ```
   You can also just copy the folder, for example from a USB stick or a zip file.
2. Open `rc-plane-calculator.html` (or any other page; new builders should start with `guide.html`) by double-clicking it. You can also drag it into a browser window.

That's it. It works without internet, straight from disk (`file://`).

**Browsers:** current Chrome, Edge, Firefox or Safari. The simulator needs WebGL. If the 3D view says it's unavailable, turn on hardware acceleration in the browser settings.

**Optional: serve over HTTP.** This is useful for opening it on a phone or tablet on the same Wi-Fi network. Run this inside the project folder:
```bash
python3 -m http.server 8000
```
Then browse to `http://<this-computer's-IP>:8000/rc-plane-calculator.html`.

## Controllers (simulator)

- **Keyboard:**
  - arrow keys: aileron and elevator
  - A / D: rudder
  - W / S: throttle
  - R: reset
  - Space: student switch (buddy box)
- **Xbox / standard gamepad:** plug it in (USB or Bluetooth) and press any button. It's detected automatically, in Mode 2.
- **RC transmitter** (for example a FlySky FS-i6): connect it with any USB simulator adapter or dongle, then go to **Controls → Set up** and follow the mapping wizard. The mapping is saved per device.
- **Touch:** on-screen sticks appear on phones and tablets.

## Where your data is kept

Everything stays in the browser on that machine; nothing is uploaded. The guide's step checkboxes and example tweaks use the key `rcGuide.v1`.

- **localStorage** (keys `rcCalc.v1`, `rcDesign.v1`, `rcDesigns.v1`, `rcMotors.v1`, `rcParts.v1`, `rcBuild.v1` and `rcSim.*`): settings, designs, lesson progress and controller mappings.
- **IndexedDB** (database `rcSim`): imported 3D models.

Data does not follow you to a new machine or browser. To move it:
- **Designs:** Designer step 9 → **Export JSON**, or share a `designer.html#design=…` link.
- **Simulator setups:** Fly tab → **Share this scenario**.
- **3D models:** Model tab → **Export .rcsim**.

## Tests (optional, for development)

| What | Needs | Command |
|---|---|---|
| Unit tests (about 190; physics, aero, calibration, lessons, import) | Node.js 18+ | `node tests/run-tests.mjs` |
| Page smoke test (calculator, Designer, Build; screenshots) | Node.js 22+ and Google Chrome | `node tests/browser-smoke.mjs /tmp/rc-smoke` |
| Simulator smoke test (WebGL, lessons, instructor, import, sharing) | Node.js 22+ and Google Chrome | `node tests/sim-smoke.mjs /tmp/rc-sim-smoke` |
| Regenerate the sample flight logs in `tests/fixtures/` | Node.js 18+ | `node tests/make-fixtures.mjs` |

Notes:
- There's nothing to `npm install`; the tests only use Node's built-in modules.
- The smoke tests start headless Chrome. They look for it at the standard macOS path (`/Applications/Google Chrome.app`) and at `/usr/bin/google-chrome` or `/usr/bin/chromium` on Linux. On Windows (or for a custom install), edit the `CHROME` list near the top of each smoke script.
- The argument is the folder for screenshots. Without it, they go to `tests/out/`, which is git-ignored.

Install Node.js from https://nodejs.org, or use your package manager:
```bash
brew install node
```
On Linux, use the distribution's package (Debian/Ubuntu: `sudo apt install nodejs`) or `nvm`.

## Project layout

```
*.html                     the five pages
assets/rc-style.css        shared styles (light and dark)
assets/rc-common.js        shared page helpers (storage, toasts, links)
assets/rc-core.js          units, calculator physics, air density, geometry
assets/rc-aero.js          airfoils, sizing, stability, lifting line, performance, motor matching
assets/rc-diagram.js       2D drawings      assets/rc-3d.js        3D model of a design
assets/rc-templates.js     build templates  assets/rc-charts.js    charts
assets/designer.js, build.js, simulator.js, guide.js  page scripts
assets/rc-info.js          glossary + "i" tooltips used on every page
assets/rc-sim-*.js         simulator: model, physics, world, input, import, calibration, lessons
assets/vendor/             three.js r186 bundle (MIT, see THREE-LICENSE.txt)
tests/                     test runners and fixtures
roadmap.yaml               done / next / backlog
```

## Licences

three.js is MIT-licensed (`assets/vendor/THREE-LICENSE.txt`). Any 3D models you import keep their own licences; the simulator shows each model's credit and stores it with the model.
