# Numeric Heart

A real-time, interactive 3D heart made of thousands of glowing, flowing digits.

## Install

Python 3.8+.

```bash
pip install -r requirements.txt
```

(or `pip install pygame numpy`)

## Run

```bash
python numeric_heart.py
```

Options:

```bash
python numeric_heart.py --fullscreen
python numeric_heart.py --size 1920x1080 --particles 8000
python numeric_heart.py --message "for you, in every digit" --palette 2 --bpm 72
```

`--show-fps` (or the `P` key) displays the frame rate. If it drops on a slow
machine, lower `--particles` or `--size`.

## Controls

| Input | Effect |
|---|---|
| Move the mouse | Ripples, and the numbers part around the cursor |
| Left click | Explosion; the digits fly back and re-form the heart |
| Hold right button | Gravity well: numbers swirl toward the cursor |
| `M` | Cursor mode: repel / attract |
| Mouse wheel, `Up` / `Down`, slider | Heartbeat speed (30-180 BPM) |
| `Left` / `Right`, slider | Intensity: glow, density, motion |
| `1` `2` `3` `4`, `C`, colour dots | Crimson, Neon Pink, Purple, Golden |
| `G` | Gravity: the heart melts into a pool that jumps on each beat |
| `N` | Number pattern: pi stream, wave interference, Fibonacci mod 10, times table |
| `T` / `Enter` | Type a message (`Enter` sets it, `Esc` cancels) |
| `Tab` | Message beneath / inside the heart |
| `R` | Full camera orbit |
| `Space` | Replay the opening animation |
| `H` | Hide / show the control strip (it also fades when idle) |
| `F` / `S` | Fullscreen / save a screenshot |
| `Esc`, `Q` | Quit |
