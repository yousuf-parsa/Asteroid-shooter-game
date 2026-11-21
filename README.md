# Void Shatter

A neon vector-style asteroid shooter that runs entirely in the browser. It's built with plain HTML, CSS and JavaScript, has no dependencies, works offline and makes no network requests.

**▶ Play it here: https://yousuf-parsa.github.io/Asteroid-shooter-game/**

## How to play

Shatter every asteroid to clear the wave. Big rocks split into medium rocks, which split into small, fast ones. Each wave brings more rocks, faster rocks and new threats.

| Action | Keys |
| --- | --- |
| Thrust | `W` / `↑` |
| Rotate | `A` `D` / `←` `→` |
| Fire | `Space` |
| Phase dash | `Shift` / `S` / `↓` |
| Pause | `P` / `Esc` |
| Mute | `M` |

A keyboard is required. There are no touch controls.

## Features

- **Phase dash.** A burst of speed with brief invulnerability that shoves nearby asteroids away and deflects saucer fire. Recharges in 3 seconds.
- **Combo multiplier.** Chain kills quickly to build the multiplier up to ×8.
- **Crystal asteroids** (green) drop power-ups: Spread shot, Overdrive rapid fire, Aegis shield and Nova pulse.
- **Volatile asteroids** (orange) take two hits and explode in a chain blast that damages everything nearby.
- **Saucers.** Scouts appear from wave 2 and hunters from wave 4. Hunters aim ahead of you and always drop a power-up.
- **Bonuses.** Wave clear bonus, extra flawless bonus for losing no lives, and an extra life every 12,000 points.
- **Sound.** All sound effects are generated live with the Web Audio API.
- **High score** is saved in your browser.

## Run it locally

Download the folder and open `index.html` in a modern browser. If your browser shows a blank page for local files, serve the folder instead:

```bash
python -m http.server
```

Then open http://localhost:8000.

## Tech notes

- Canvas 2D rendering with frame-rate–independent physics, so the game runs at the same speed on 60, 120 and 144 Hz displays.
- A strict Content Security Policy: no inline scripts or styles, no `eval`, no external resources.
