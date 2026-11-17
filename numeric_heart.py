#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NUMERIC HEART  --  a living heart made of numbers
=================================================

A real-time, interactive digital-art piece: thousands of glowing digits flow
over the surface of a true 3D heart (Taubin's implicit heart surface), beat
with a "lub-dub" cardiac rhythm, and react to the mouse.

Install
-------
    pip install pygame numpy          (Python 3.8+)

    On a Mac with a Retina screen use pygame-ce instead, otherwise macOS
    stretches the picture 2x and it looks soft:
        pip uninstall -y pygame && pip install pygame-ce numpy

Run
---
    python numeric_heart.py
    python numeric_heart.py --fullscreen
    python numeric_heart.py --size 1920x1080 --particles 8000
    python numeric_heart.py --message "for you, in every digit"

Controls
--------
    Mouse move          ripples + push the numbers away (or pull, see M)
    Left click          explosion of numbers that fly back into the heart
    Right button (hold) gravity well: numbers swirl toward the cursor
    Mouse wheel / Up / Down     heartbeat speed (BPM)
    Left / Right        intensity (glow, density, motion)
    1 2 3 4  /  C       palettes: Crimson, Neon Pink, Purple, Golden
    G                   toggle gravity (the heart melts and re-forms)
    N                   cycle number pattern (pi stream, interference,
                        Fibonacci mod 10, times table)
    M                   cursor mode: repel <-> attract
    T or Enter          type a custom message (Enter = set, Esc = cancel)
    Tab                 message position: beneath <-> inside the heart
    R                   toggle full cinematic orbit
    Space               replay the opening animation
    H                   hide / show the control strip
    F                   fullscreen        S   save a screenshot
    B                   depth-of-field blur on / off (off = every digit crisp)
    Esc / Q             quit

How it stays fast
-----------------
* All particle maths is vectorised NumPy (no per-particle Python maths).
* Every glyph variant (digit x size x blur x colour x brightness) is
  pre-rendered once into a sprite atlas; a frame is one batched
  ``Surface.blits`` call with additive blending.
* Glow is a cheap multi-resolution bloom (down-scale / up-scale chain).
"""

import argparse
import math
import os
import sys
import time
from itertools import repeat

import numpy as np
import pygame

# ----------------------------------------------------------------------------
# Tunables
# ----------------------------------------------------------------------------
TAU = 2.0 * math.pi

GLYPH_PX = (8, 10, 12, 15, 18, 22, 28)   # font sizes in the atlas (at 720p)
SZ = len(GLYPH_PX)
BL = 3                                   # depth-of-field blur levels
TN = 8                                   # colour steps along the gradient
BN = 6                                   # brightness steps
BRIGHT = (0.10, 0.22, 0.40, 0.62, 0.85, 1.00)
WHITEN = (0.00, 0.00, 0.00, 0.04, 0.16, 0.40)   # hot cores drift to white
BASE_STRIDE = BL * SZ * 10               # white master glyphs
PAL_STRIDE = TN * BN * BASE_STRIDE       # sprites per palette

DOT_SIGMA = (1.3, 2.2, 3.6, 6.0, 10.0)   # soft dots for sparks / stars
DS = len(DOT_SIGMA)

CAM_DIST = 4.2          # camera distance (world units; the heart is ~2.3 tall)
FOCUS_Z = -0.45         # focal plane (view space): the front of the heart
SPRING_K = 42.0
SPRING_C = 9.5
FLOOR_Y = -1.30

PALETTES = [
    dict(name="CRIMSON",
         stops=[(112, 4, 24), (184, 8, 38), (228, 20, 58), (250, 52, 100),
                (238, 64, 172), (255, 194, 170)],
         bg_in=(30, 8, 38), bg_out=(3, 1, 8), accent=(255, 70, 110)),
    dict(name="NEON PINK",
         stops=[(110, 0, 92), (214, 0, 140), (255, 20, 150), (255, 84, 204),
                (255, 150, 240), (255, 226, 250)],
         bg_in=(34, 6, 44), bg_out=(4, 1, 10), accent=(255, 40, 170)),
    dict(name="PURPLE",
         stops=[(52, 12, 130), (104, 32, 204), (150, 62, 255), (190, 108, 255),
                (232, 130, 255), (246, 218, 255)],
         bg_in=(20, 8, 52), bg_out=(2, 1, 10), accent=(160, 80, 255)),
    dict(name="GOLDEN",
         stops=[(110, 40, 0), (180, 88, 6), (232, 134, 14), (255, 176, 44),
                (255, 206, 104), (255, 236, 190)],
         bg_in=(34, 16, 26), bg_out=(5, 2, 8), accent=(255, 176, 50)),
]
NPAL = len(PALETTES)
NUMBER_MODES = ("PI STREAM", "INTERFERENCE", "FIBONACCI", "TIMES TABLE")


# ----------------------------------------------------------------------------
# Small maths helpers
# ----------------------------------------------------------------------------
def smoothstep(x):
    """Hermite ease 0..1 (works on scalars and arrays)."""
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def ease_in_out_cubic(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x < 0.5, 4.0 * x * x * x, 1.0 - (-2.0 * x + 2.0) ** 3 / 2.0)


def ease_out_cubic(x):
    x = min(max(x, 0.0), 1.0)
    return 1.0 - (1.0 - x) ** 3


def beat_curve(p):
    """Cardiac 'lub-dub': a strong systolic bump followed by a softer one."""
    return (np.exp(-((p - 0.10) / 0.055) ** 2)
            + 0.55 * np.exp(-((p - 0.36) / 0.07) ** 2))


def lerp_color(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(stops, t):
    """Sample a multi-stop colour gradient at t in [0, 1]."""
    t = min(max(t, 0.0), 1.0) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    return lerp_color(stops[i], stops[i + 1], t - i)


def pi_digits(n):
    """First n decimal digits of pi via Machin's formula (pure integers)."""
    unity = 10 ** (n + 10)

    def arctan_inv(x):
        total = term = unity // x
        x2, k, sign = x * x, 3, -1
        while term:
            term //= x2
            total += sign * (term // k)
            sign, k = -sign, k + 2
        return total

    val = 4 * (4 * arctan_inv(5) - arctan_inv(239))
    return np.array([int(c) for c in str(val)[:n]], dtype=np.int32)


def fibonacci_mod10():
    """Fibonacci numbers mod 10 repeat with (Pisano) period 60."""
    a, b, out = 0, 1, []
    for _ in range(60):
        out.append(a)
        a, b = b, (a + b) % 10
    return np.array(out, dtype=np.int32)


# ----------------------------------------------------------------------------
# The heart: Taubin's implicit surface
#     (x^2 + 9/4 y^2 + z^2 - 1)^3 - x^2 z^3 - 9/80 y^2 z^3 = 0
# The surface is star-shaped about the origin, so it can be described by a
# radius r(direction).  We tabulate r once (vectorised bisection) and look it
# up every frame, which lets particles *flow* over the surface for free.
# ----------------------------------------------------------------------------
class HeartField:
    TU, TP = 256, 512

    def __init__(self):
        u = np.linspace(-1.0, 1.0, self.TU)                    # cos(polar)
        p = np.arange(self.TP) * (TAU / self.TP)               # azimuth
        uu, pp = np.meshgrid(u, p, indexing="ij")
        st = np.sqrt(np.maximum(0.0, 1.0 - uu * uu))
        dx, dy, dz = st * np.cos(pp), st * np.sin(pp), uu
        lo = np.zeros_like(uu)
        hi = np.full_like(uu, 2.0)
        for _ in range(36):
            mid = 0.5 * (lo + hi)
            x, y, z = dx * mid, dy * mid, dz * mid
            f = (x * x + 2.25 * y * y + z * z - 1.0) ** 3 \
                - x * x * z ** 3 - 0.1125 * y * y * z ** 3
            inside = f < 0.0
            lo = np.where(inside, mid, lo)
            hi = np.where(inside, hi, mid)
        self.table = (0.5 * (lo + hi)).astype(np.float32)

    def radius(self, u, phi):
        iu = np.rint((u + 1.0) * (0.5 * (self.TU - 1))).astype(np.intp)
        ip = (phi * (self.TP / TAU)).astype(np.intp) % self.TP
        return self.table[iu, ip]


# ----------------------------------------------------------------------------
# The installation
# ----------------------------------------------------------------------------
class NumericHeart:
    def __init__(self, screen, args, mouse_scale=1.0, can_toggle_fullscreen=True):
        self.screen = screen
        self.mouse_scale = mouse_scale      # window points -> render pixels (Retina)
        self.can_toggle_fullscreen = can_toggle_fullscreen
        self.W, self.H = screen.get_size()
        self.rng = np.random.default_rng(args.seed)
        self.n = int(args.particles)          # heart digits
        self.ns = 280                         # floating sparks
        self.nb = 480                         # explosion pool

        # ---- user-controllable state -------------------------------------
        self.bpm = float(args.bpm)
        self.intensity = float(np.clip(args.intensity, 0.0, 1.0))
        self.pal = int(args.palette) % NPAL
        self.gravity = False
        self.attract_mode = False
        self.number_mode = 0
        self.orbit = False
        self.message = args.message
        self.msg_inside = False
        self.editing = False
        self.edit_text = ""
        self.ui_hidden = False
        self.show_fps = args.show_fps
        self.dof = not args.sharp           # depth-of-field blur on/off

        # ---- animation state ---------------------------------------------
        self.t = 0.0
        self.phase = 0.0            # heartbeat phase 0..1
        self.beat = 0.0
        self.tnum = 0.0             # clock driving the digit patterns
        self.gmix = 0.0             # eased gravity amount
        self.orbit_angle = 0.0
        self.cam_mx = self.cam_my = 0.0
        self.mouse = (self.W * 0.5, self.H * 0.5)
        self.mouse_seen = False
        self.rmb = False
        self.ripples = []           # [x, y, age, amplitude]
        self.ripple_acc = 0.0
        self.idle = 0.0
        self.ui_alpha = 1.0
        self.pal_prev = self.pal
        self.pal_wave = 1.0
        self.msg_t = 0.0
        self.msg_mix = 0.0
        self.drag = None
        self.fps = 60.0

        # keep overall exposure constant when the particle count changes
        self.expo = float(np.clip((5600.0 / self.n) ** 0.6, 0.45, 1.25))
        self.field = HeartField()
        self.PI = pi_digits(4096)
        self.FIB = fibonacci_mod10()

        self._init_particles()
        self._build_static()
        self.start_intro()

    # ------------------------------------------------------------------
    # Particles
    # ------------------------------------------------------------------
    def _init_particles(self):
        rng, n, ns = self.rng, self.n, self.ns
        N = self.N = n + ns

        # Sample directions; weight by r^2 so the *surface* is evenly covered.
        m = n * 5
        cu = rng.uniform(-1, 1, m)
        cp = rng.uniform(0, TAU, m)
        w = self.field.radius(cu, cp).astype(np.float64) ** 2
        pick = rng.choice(m, n, replace=False, p=w / w.sum())
        self.u = cu[pick].astype(np.float32)
        self.phi = cp[pick].astype(np.float32)
        self.sin_t = np.sqrt(1.0 - self.u ** 2)

        # Three layers: crisp shell, dim interior volume, faint outer mist.
        kind = rng.random(n)
        shell = kind < 0.70
        mist = kind > 0.94
        rho = np.where(shell, 1.0 - np.abs(rng.normal(0, 0.028, n)),
                       0.22 + 0.70 * rng.random(n) ** 0.6)
        rho = np.where(mist, 1.03 + 0.16 * rng.random(n) ** 1.5, rho)
        self.rho = rho.astype(np.float32)

        base = np.where(shell, 0.50 + 0.50 * rng.random(n),
                        0.22 + 0.36 * rng.random(n))
        base = np.where(mist, 0.14 + 0.22 * rng.random(n), base)
        size = np.where(shell, 0.68 + 0.62 * rng.random(n) ** 2,
                        0.55 + 0.35 * rng.random(n))
        size = np.where(rng.random(n) < 0.035, 1.55 + 0.5 * rng.random(n), size)
        size = np.where(mist, 0.5 + 0.3 * rng.random(n), size)
        self.tone0 = (0.03 + 0.46 * rng.random(n) ** 1.7
                      + np.where(shell, 0.08, -0.04)).astype(np.float32)

        # Flow: each layer drifts around the heart at its own speed; the
        # interior counter-rotates, which reads as depth.
        omega = np.where(shell, 0.085 * (0.55 + 0.9 * rng.random(n)),
                         -0.13 * (0.5 + rng.random(n)))
        omega = np.where(mist, 0.16 * (0.5 + rng.random(n)), omega)
        self.omega = omega.astype(np.float32)

        # Lattice coordinates used by the number patterns.
        self.band = ((self.u + 1.0) * 20.0).astype(np.int64)
        self.layer = (self.rho * 4.0).astype(np.int64)
        self.rate = (3.0 + (self.band * 7 % 5)).astype(np.float32)
        self.rank = rng.random(n).astype(np.float32)      # density ordering

        # Arrays shared by heart digits [0:n] and sparks [n:N].
        self.base = np.concatenate([base, 0.35 + 0.65 * rng.random(ns)]).astype(np.float32)
        self.size = np.concatenate([size, rng.random(ns)]).astype(np.float32)
        self.sh_f = (0.6 + 2.6 * rng.random(N)).astype(np.float32)   # shimmer speed
        self.sh_p = rng.uniform(0, TAU, N).astype(np.float32)
        self.P = np.zeros((N, 3), np.float32)
        self.V = np.zeros((N, 3), np.float32)
        self.rel = np.zeros(N, np.float32)       # 1 = blown free of its spring
        self.flash = np.zeros(n, np.float32)
        self.digit = np.zeros(n, np.int64)
        self.pal_i = np.full(N, self.pal, np.int64)
        self.pal_key = np.concatenate(
            [np.clip(self.rho, 0, 1.2) * 0.75 + 0.2 * rng.random(n),
             1.0 + 0.25 * rng.random(ns)]).astype(np.float32)
        self.kspring = np.concatenate(
            [np.full(n, SPRING_K), np.full(ns, 5.0)]).astype(np.float32)
        self.cdamp = np.concatenate(
            [np.full(n, SPRING_C), np.full(ns, 2.2)]).astype(np.float32)
        self.is_heart = np.concatenate([np.ones(n), np.zeros(ns)]).astype(np.float32)
        self.rest = (0.25 + 0.4 * rng.random(N)).astype(np.float32)

        # Sparks orbit the heart on slow, tilted, bobbing rings.
        self.sp_R = (1.35 + 1.5 * rng.random(ns) ** 1.3).astype(np.float32)
        self.sp_a = rng.uniform(0, TAU, ns).astype(np.float32)
        self.sp_w = ((0.05 + 0.16 * rng.random(ns))
                     * rng.choice([-1, 1], ns)).astype(np.float32)
        self.sp_y = rng.uniform(-1.25, 1.25, ns).astype(np.float32)
        self.sp_f = (0.2 + 0.5 * rng.random(ns)).astype(np.float32)
        self.sp_tint = (rng.random(ns) < 0.35).astype(np.int64)

        # Intro choreography.
        d = rng.normal(size=(n, 3))
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        self.intro_start = (d * rng.uniform(4.0, 9.0, (n, 1))).astype(np.float32)
        self.intro_swirl = rng.uniform(1.2, 3.4, n).astype(np.float32)
        self.intro_rand = rng.random(n).astype(np.float32)
        self.intro_dur = rng.uniform(2.3, 3.5, n).astype(np.float32)

        # Explosion pool.
        nb = self.nb
        self.bP = np.zeros((nb, 3), np.float32)
        self.bV = np.zeros((nb, 3), np.float32)
        self.b_age = np.full(nb, 9.0, np.float32)
        self.b_dur = np.ones(nb, np.float32)
        self.b_tgt = np.zeros(nb, np.int64)
        self.b_seed = rng.integers(0, 10, nb)
        self.b_size = (0.8 + 0.9 * rng.random(nb)).astype(np.float32)
        self.b_next = 0

        # Stars: a far shell around the scene (gives camera parallax).
        nst = 900
        d = rng.normal(size=(nst, 3))
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        self.star_P = (d * rng.uniform(7.0, 13.0, (nst, 1))).astype(np.float32)
        self.star_b = (0.15 + 0.85 * rng.random(nst) ** 2.5).astype(np.float32)
        self.star_f = (0.4 + 2.2 * rng.random(nst)).astype(np.float32)
        self.star_p = rng.uniform(0, TAU, nst).astype(np.float32)
        self.star_big = (rng.random(nst) < 0.06).astype(np.int64)

        self.sx = np.zeros(N, np.float32)
        self.sy = np.zeros(N, np.float32)
        self.fpersp = np.ones(N, np.float32)
        self.vz = np.zeros(N, np.float32)
        self.glow = np.zeros(N, np.float32)

    def start_intro(self):
        """Scatter every digit into the dark and let it fly home."""
        self.intro_t = 0.0
        self.intro_on = True
        self.msg_t = -5.2
        self.V[:] = 0.0
        self.rel[:] = 0.0
        self.P[:self.n] = self.intro_start
        self.P[self.n:] = self._spark_home()

    # ------------------------------------------------------------------
    # Static, resolution-dependent resources
    # ------------------------------------------------------------------
    def _build_static(self):
        W, H = self.W, self.H
        self.us = min(H / 720.0, W / 1280.0)          # UI / glyph scale
        self.S = 0.29 * min(H, W * 0.62)              # world -> pixels
        self.cx, self.cy = W * 0.5, H * 0.44

        names = "consolas,menlo,sfmono,dejavusansmono,liberationmono,couriernew"
        self.glyph_fonts = [pygame.font.SysFont(names, max(6, int(px * self.us)), bold=True)
                            for px in GLYPH_PX]
        self.size_px = np.array(GLYPH_PX, np.float32) * self.us
        ui = "helveticaneue,segoeui,avenirnext,dejavusans,liberationsans,arial"
        self.font_ui = pygame.font.SysFont(ui, max(9, int(12 * self.us)))
        self.font_hint = pygame.font.SysFont(ui, max(8, int(10.5 * self.us)))
        serif = "georgia,palatino,palatinolinotype,baskerville,didot,dejavuserif,liberationserif,timesnewroman"
        self.font_msg = pygame.font.SysFont(serif, max(14, int(34 * self.us)), italic=True)

        # --- master (white) glyphs for every blur / size / digit ----------
        self.base_glyphs = []
        hw, hh = [], []
        for bl in range(BL):
            for si in range(SZ):
                for d in range(10):
                    g = self.glyph_fonts[si].render(str(d), True, (255, 255, 255), (0, 0, 0))
                    g = g.convert(self.screen)
                    if bl:
                        g = self._blur(g, self.size_px[si] * (0.11 if bl == 1 else 0.26))
                    self.base_glyphs.append(g)
                    hw.append(g.get_width() * 0.5)
                    hh.append(g.get_height() * 0.5)
        self.g_hw = np.array(hw, np.float32)
        self.g_hh = np.array(hh, np.float32)

        # --- sprite list: [palette glyph atlases ...][dots] ----------------
        self.DOT0 = NPAL * PAL_STRIDE
        self.sprites = [None] * self.DOT0
        self.pal_built = [False] * NPAL
        self.d_h = []
        for pal in PALETTES:
            for tint in (pal["accent"], (255, 236, 244)):
                for b in range(BN):
                    for si, sg in enumerate(DOT_SIGMA):
                        self.sprites.append(self._dot(
                            sg * self.us, tint,
                            BRIGHT[b] / (1.0 + 0.45 * si)).convert(self.screen))
        self.d_h = np.array([self.sprites[self.DOT0 + i].get_width() * 0.5
                             for i in range(DS)], np.float32)
        self._ensure_palette(self.pal)

        # --- backgrounds, bloom buffers, aura ------------------------------
        self.q_size = (max(8, W // 8), max(8, H // 8))
        self.s_size = (max(4, W // 28), max(4, H // 28))
        self.buf_q = pygame.Surface(self.q_size).convert(self.screen)
        self.buf_s = pygame.Surface(self.s_size).convert(self.screen)
        self.buf_qs = pygame.Surface(self.q_size).convert(self.screen)
        self.buf_full = pygame.Surface((W, H)).convert(self.screen)
        self.bgs, self.bgs_q, self.auras = [], [], []
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.hypot((xx - self.cx) / (W * 0.62), (yy - self.cy) / (H * 0.80))
        noise = self.rng.random((H, W, 1), dtype=np.float32)          # dither
        fall = np.clip(1.0 - r, 0.0, 1.0) ** 1.7
        for pal in PALETTES:
            a = np.array(pal["bg_out"], np.float32)
            b = np.array(pal["bg_in"], np.float32)
            img = a + (b - a) * fall[..., None] + noise
            bg = pygame.surfarray.make_surface(
                np.transpose(img, (1, 0, 2)).astype(np.uint8)).convert(self.screen)
            self.bgs.append(bg)
            self.bgs_q.append(pygame.transform.smoothscale(bg, self.q_size))
            self.auras.append(self._aura(pal["accent"]))
        self.bg_fade = pygame.Surface((W, H)).convert(self.screen)

        self._build_message()
        self._layout_ui()
        self.ui_surf = pygame.Surface((W, int(96 * self.us)), pygame.SRCALPHA)

    @staticmethod
    def _blur(surf, radius):
        """Cheap gaussian-ish blur: pad, shrink, grow (twice for smoothness)."""
        m = int(math.ceil(radius * 2.2)) + 1
        w, h = surf.get_width() + 2 * m, surf.get_height() + 2 * m
        big = pygame.Surface((w, h), 0, surf)
        big.blit(surf, (m, m))
        k = 1.0 + radius
        for _ in range(2):
            small = pygame.transform.smoothscale(big, (max(1, int(w / k)), max(1, int(h / k))))
            big = pygame.transform.smoothscale(small, (w, h))
        return big

    @staticmethod
    def _dot(sigma, color, amp):
        r = int(math.ceil(sigma * 2.6)) + 1
        y, x = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float32)
        g = np.exp(-(x * x + y * y) / (sigma * sigma)) * amp
        img = np.clip(g[..., None] * np.array(color, np.float32), 0, 255).astype(np.uint8)
        return pygame.surfarray.make_surface(img)

    def _aura(self, color):
        """Soft heart-shaped halo, stored at bloom resolution in BN levels."""
        qw, qh = self.q_size
        yy, xx = np.mgrid[0:qh, 0:qw].astype(np.float32)
        x = (xx * (self.W / qw) - self.cx) / self.S
        z = -(yy * (self.H / qh) - self.cy) / self.S + 0.1
        f = (x * x + z * z - 1.0) ** 3 - x * x * z ** 3      # heart slice y=0
        d = np.cbrt(np.maximum(f, 0.0))                       # ~distance outside
        halo = np.exp(-d * 1.15) * 0.55 + np.exp(-d * 5.0) * 0.45
        out = []
        for lv in range(8):
            a = halo * (0.10 + 0.05 * lv)
            img = np.clip(a[..., None] * np.array(color, np.float32), 0, 255)
            out.append(pygame.surfarray.make_surface(
                np.transpose(img, (1, 0, 2)).astype(np.uint8)).convert(self.screen))
        return out

    def _ensure_palette(self, p):
        """Tint the master glyphs for one palette (lazily, ~50 ms)."""
        if self.pal_built[p]:
            return
        stops = PALETTES[p]["stops"]
        i = p * PAL_STRIDE
        mult = pygame.BLEND_RGB_MULT
        for tone in range(TN):
            col = gradient(stops, tone / (TN - 1))
            for b in range(BN):
                c = lerp_color(col, (255, 255, 255), WHITEN[b])
                c = tuple(int(v * BRIGHT[b]) for v in c)
                for g in self.base_glyphs:
                    s = g.copy()
                    s.fill(c, special_flags=mult)
                    self.sprites[i] = s
                    i += 1
        self.pal_built[p] = True

    # ------------------------------------------------------------------
    # Message
    # ------------------------------------------------------------------
    def _build_message(self):
        text = self.edit_text if self.editing else self.message
        col = lerp_color(PALETTES[self.pal]["stops"][-1], (255, 255, 255), 0.35)
        track = 0.07 * self.font_msg.get_height()
        self.msg_chars, x = [], 0.0
        for ch in text:
            s = self.font_msg.render(ch, True, col)
            self.msg_chars.append((s, x))
            x += s.get_width() + track
        self.msg_w = max(0.0, x - track)
        self.msg_h = self.font_msg.get_height()

    def set_message(self, text):
        self.message = text
        self.msg_t = 0.0
        self._build_message()

    def _msg_center(self):
        if self.msg_inside:
            return self.cx, self.cy - 0.08 * self.S
        return self.cx, self.cy + 1.42 * self.S

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------
    def _layout_ui(self):
        u = self.us
        widths = [("bpm", 180), ("int", 180), ("pal", 108), ("grav", 92),
                  ("num", 132), ("mouse", 92), ("msg", 92)]
        gap = 30 * u
        total = sum(w for _, w in widths) * u + gap * (len(widths) - 1)
        x = (self.W - total) * 0.5
        self.ui_top = self.H - int(96 * u)
        y = 44 * u                                    # row centre in ui_surf
        self.ui = {}
        for name, w in widths:
            self.ui[name] = pygame.Rect(int(x), int(y - 13 * u), int(w * u), int(26 * u))
            x += w * u + gap
        self.ui_pal = []
        r = self.ui["pal"]
        for i in range(NPAL):
            self.ui_pal.append((int(r.x + (i + 0.5) * r.w / NPAL), r.centery))

    def _ui_hit(self, pos):
        if self.ui_hidden or self.ui_alpha < 0.3:
            return None
        x, y = pos[0], pos[1] - self.ui_top
        for name, r in self.ui.items():
            if r.inflate(int(10 * self.us), int(18 * self.us)).collidepoint(x, y):
                if name == "pal":
                    i = int((x - r.x) / (r.w / NPAL))
                    return ("pal", min(max(i, 0), NPAL - 1))
                return (name, None)
        return None

    def _slider_set(self, name, mx):
        r = self.ui[name]
        v = min(max((mx - r.x) / float(r.w), 0.0), 1.0)
        if name == "bpm":
            self.bpm = round(30 + v * 150)
        else:
            self.intensity = v

    def _draw_ui(self):
        s, u = self.ui_surf, self.us
        s.fill((0, 0, 0, 0))
        acc = PALETTES[self.pal]["accent"]
        soft = (226, 208, 222)
        dim = (150, 130, 150)

        def label(text, rect, color=dim):
            t = self.font_hint.render(text, True, color)
            s.blit(t, (rect.x, rect.y - t.get_height() - int(2 * u)))

        def slider(name, text, v):
            r = self.ui[name]
            label(text, r)
            cy = r.centery
            pygame.draw.line(s, (90, 70, 96), (r.x, cy), (r.right, cy), max(1, int(2 * u)))
            kx = int(r.x + v * r.w)
            pygame.draw.line(s, acc, (r.x, cy), (kx, cy), max(1, int(2 * u)))
            pygame.draw.circle(s, (255, 255, 255), (kx, cy), int(6 * u))
            pygame.draw.circle(s, acc, (kx, cy), int(9 * u), max(1, int(1.5 * u)))

        def chip(name, title, text, on=False):
            r = self.ui[name]
            label(title, r)
            rad = r.h // 2
            if on:
                pygame.draw.rect(s, acc + (70,), r, border_radius=rad)
            pygame.draw.rect(s, acc if on else (110, 90, 116), r,
                             max(1, int(1.2 * u)), border_radius=rad)
            t = self.font_ui.render(text, True, (255, 255, 255) if on else soft)
            s.blit(t, t.get_rect(center=r.center))

        slider("bpm", "HEARTBEAT   %d BPM" % self.bpm, (self.bpm - 30) / 150.0)
        slider("int", "INTENSITY   %d%%" % round(self.intensity * 100), self.intensity)
        label("PALETTE   " + PALETTES[self.pal]["name"], self.ui["pal"])
        for i, (px, py) in enumerate(self.ui_pal):
            pygame.draw.circle(s, PALETTES[i]["accent"], (px, py), int(7 * u))
            if i == self.pal:
                pygame.draw.circle(s, (255, 255, 255), (px, py), int(11 * u),
                                   max(1, int(1.5 * u)))
        chip("grav", "GRAVITY  [G]", "ON" if self.gravity else "OFF", self.gravity)
        chip("num", "NUMBERS  [N]", NUMBER_MODES[self.number_mode])
        chip("mouse", "CURSOR  [M]", "ATTRACT" if self.attract_mode else "REPEL",
             self.attract_mode)
        chip("msg", "MESSAGE  [T]", "TYPING" if self.editing else "EDIT", self.editing)

        hint = ("click: burst    right-drag: gravity well    wheel: heartbeat    "
                "1-4: palette    Tab: message inside/beneath    R: orbit    "
                "Space: replay intro    F: fullscreen    S: save    H: hide")
        t = self.font_hint.render(hint, True, (120, 104, 124))
        s.blit(t, t.get_rect(center=(self.W // 2, int(80 * u))))
        s.set_alpha(int(255 * self.ui_alpha))
        self.screen.blit(s, (0, self.ui_top))

    # ------------------------------------------------------------------
    # Interaction
    # ------------------------------------------------------------------
    def set_palette(self, p):
        p %= NPAL
        if p == self.pal:
            return
        self._ensure_palette(p)
        self.pal_prev, self.pal, self.pal_wave = self.pal, p, 0.0
        self._build_message()

    def toggle_gravity(self):
        self.gravity = not self.gravity

    def start_edit(self):
        self.editing = True
        self.edit_text = self.message
        self._build_message()
        pygame.key.start_text_input()

    def stop_edit(self, commit):
        self.editing = False
        if commit:
            self.set_message(self.edit_text)
        else:
            self._build_message()

    def add_ripple(self, x, y, amp):
        self.ripples.append([x, y, 0.0, amp])
        if len(self.ripples) > 10:
            self.ripples.pop(0)

    def explode(self, mx, my):
        """Blast the digits near the click and release a burst of new ones."""
        gain = 0.65 + 0.7 * self.intensity
        dx, dy = self.sx - mx, self.sy - my
        d = np.sqrt(dx * dx + dy * dy) + 1.0
        r0 = 0.30 * self.H
        w = np.exp(-(d / r0) ** 2) + 0.10 / (1.0 + d / r0)
        speed = (0.8 + 6.5 * self.rng.random(self.N) ** 1.6) * w * gain
        fv = np.stack([dx / d * speed, -dy / d * speed,
                       self.rng.normal(0, 0.7, self.N) * speed], axis=1)
        self.V += (fv @ self.R).astype(np.float32)
        self.rel = np.maximum(self.rel, np.clip(w * 1.4, 0, 1)).astype(np.float32)
        self.add_ripple(mx, my, 0.9)

        # New glowing digits born at the click, in world space on the z=0 plane.
        k = 150
        ids = (self.b_next + np.arange(k)) % self.nb
        self.b_next = (self.b_next + k) % self.nb
        origin = np.array([(mx - self.cx) / self.S, -(my - self.cy) / self.S, 0.0]) @ self.R
        d3 = self.rng.normal(size=(k, 3))
        d3 /= np.linalg.norm(d3, axis=1, keepdims=True)
        self.bP[ids] = origin + d3 * 0.03
        self.bV[ids] = d3 * (0.8 + 4.4 * self.rng.random((k, 1)) ** 1.6) * gain
        self.b_age[ids] = 0.0
        self.b_dur[ids] = self.rng.uniform(2.4, 3.8, k)
        self.b_tgt[ids] = self.rng.integers(0, self.n, k)

    def handle_event(self, e):
        """Returns False when the app should quit."""
        if e.type == pygame.QUIT:
            return False
        pos = getattr(e, "pos", None)
        if pos is not None and self.mouse_scale != 1.0:
            pos = (pos[0] * self.mouse_scale, pos[1] * self.mouse_scale)
        if e.type == pygame.MOUSEMOTION:
            ox, oy = self.mouse
            self.mouse, self.mouse_seen, self.idle = pos, True, 0.0
            if self.drag:
                self._slider_set(self.drag, pos[0])
            else:
                self.ripple_acc += math.hypot(pos[0] - ox, pos[1] - oy)
                if self.ripple_acc > 85 * self.us:
                    self.ripple_acc = 0.0
                    self.add_ripple(pos[0], pos[1], 0.55)
        elif e.type == pygame.MOUSEBUTTONDOWN:
            self.mouse, self.mouse_seen, self.idle = pos, True, 0.0
            if e.button == 1:
                hit = self._ui_hit(pos)
                if hit is None:
                    self.explode(*pos)
                elif hit[0] in ("bpm", "int"):
                    self.drag = hit[0]
                    self._slider_set(self.drag, pos[0])
                elif hit[0] == "pal":
                    self.set_palette(hit[1])
                elif hit[0] == "grav":
                    self.toggle_gravity()
                elif hit[0] == "num":
                    self.number_mode = (self.number_mode + 1) % len(NUMBER_MODES)
                elif hit[0] == "mouse":
                    self.attract_mode = not self.attract_mode
                elif hit[0] == "msg":
                    self.stop_edit(True) if self.editing else self.start_edit()
            elif e.button == 3:
                self.rmb = True
        elif e.type == pygame.MOUSEBUTTONUP:
            if e.button == 1:
                self.drag = None
            elif e.button == 3:
                self.rmb = False
        elif e.type == pygame.MOUSEWHEEL:
            self.bpm = float(np.clip(self.bpm + 4 * e.y, 30, 180))
            self.idle = 0.0
        elif e.type == pygame.TEXTINPUT and self.editing:
            if len(self.edit_text) < 60:
                self.edit_text += e.text
                self._build_message()
        elif e.type == pygame.KEYDOWN:
            self.idle = 0.0
            return self._key(e)
        return True

    def _key(self, e):
        k = e.key
        if self.editing:                     # typing swallows the shortcuts
            if k in (pygame.K_RETURN, pygame.K_KP_ENTER):
                self.stop_edit(True)
            elif k == pygame.K_ESCAPE:
                self.stop_edit(False)
            elif k == pygame.K_BACKSPACE:
                self.edit_text = self.edit_text[:-1]
                self._build_message()
            return True
        if k in (pygame.K_ESCAPE, pygame.K_q):
            return False
        if k == pygame.K_UP:
            self.bpm = min(180.0, self.bpm + 4)
        elif k == pygame.K_DOWN:
            self.bpm = max(30.0, self.bpm - 4)
        elif k == pygame.K_RIGHT:
            self.intensity = min(1.0, self.intensity + 0.05)
        elif k == pygame.K_LEFT:
            self.intensity = max(0.0, self.intensity - 0.05)
        elif pygame.K_1 <= k <= pygame.K_4:
            self.set_palette(k - pygame.K_1)
        elif k == pygame.K_c:
            self.set_palette(self.pal + 1)
        elif k == pygame.K_g:
            self.toggle_gravity()
        elif k == pygame.K_n:
            self.number_mode = (self.number_mode + 1) % len(NUMBER_MODES)
        elif k == pygame.K_m:
            self.attract_mode = not self.attract_mode
        elif k in (pygame.K_t, pygame.K_RETURN, pygame.K_KP_ENTER):
            self.start_edit()
        elif k == pygame.K_TAB:
            self.msg_inside = not self.msg_inside
            self.msg_t = 0.0
        elif k == pygame.K_r:
            self.orbit = not self.orbit
        elif k == pygame.K_SPACE:
            self.start_intro()
        elif k == pygame.K_h:
            self.ui_hidden = not self.ui_hidden
        elif k == pygame.K_b:
            self.dof = not self.dof
        elif k == pygame.K_p:
            self.show_fps = not self.show_fps
        elif k == pygame.K_f:
            if self.can_toggle_fullscreen:
                pygame.display.toggle_fullscreen()
            else:
                print("Retina mode: restart with --fullscreen instead")
        elif k == pygame.K_s:
            name = time.strftime("numeric_heart_%Y%m%d_%H%M%S.png")
            pygame.image.save(self.screen, name)
            print("saved", os.path.abspath(name))
        return True

    # ------------------------------------------------------------------
    # Simulation
    # ------------------------------------------------------------------
    def _spark_home(self):
        a = self.sp_a + self.sp_w * self.t
        y = self.sp_y + 0.22 * np.sin(self.t * self.sp_f + self.sp_a * 3.0)
        return np.stack([self.sp_R * np.cos(a), y, 0.85 * self.sp_R * np.sin(a)],
                        axis=1).astype(np.float32)

    def _digits(self, home):
        """The number field.  Every mode is a deterministic function of a
        particle's place on the heart and of time - nothing flickers randomly."""
        n, mode = self.n, self.number_mode
        slot = (self.phi * (72.0 / TAU)).astype(np.int64) % 72
        tick = (self.tnum * self.rate).astype(np.int64)
        if mode == 0:      # pi flows around every latitude ring like ticker tape
            d = self.PI[(self.band * 131 + self.layer * 977 + slot + tick) % len(self.PI)]
        elif mode == 1:    # two circular wave sources (one per lobe) interfere
            t = self.tnum
            d1 = np.sqrt((home[:n, 0] - 0.55) ** 2 + (home[:n, 1] - 0.45) ** 2 + home[:n, 2] ** 2)
            d2 = np.sqrt((home[:n, 0] + 0.55) ** 2 + (home[:n, 1] - 0.45) ** 2 + home[:n, 2] ** 2)
            v = np.sin(9.0 * d1 - 2.2 * t) + np.sin(7.0 * d2 - 1.7 * t)
            d = ((v + 2.0) * 2.4999).astype(np.int64)
        elif mode == 2:    # Fibonacci mod 10 (Pisano period 60)
            d = self.FIB[(self.band * slot + self.layer * 7 + tick) % 60]
        else:              # a living multiplication table mod 10
            d = ((slot + tick) * (self.band + self.layer + 1)) % 10
        return d

    def update(self, dt):
        dt = min(dt, 1.0 / 24.0)
        n, N, I = self.n, self.N, self.intensity
        anim = 0.45 + 0.9 * I
        self.t += dt
        self.idle += dt
        self.fps += (1.0 / max(dt, 1e-4) - self.fps) * 0.05

        # ---- heartbeat ---------------------------------------------------
        self.phase += dt * self.bpm / 60.0
        beat_event = self.phase >= 1.0
        self.phase %= 1.0
        self.beat = float(beat_curve(self.phase))
        self.gmix += ((1.0 if self.gravity else 0.0) - self.gmix) * min(1.0, dt * 2.2)
        gm = self.gmix

        # ---- camera: slow sway, optional orbit, mouse parallax ------------
        mx, my = self.mouse
        self.cam_mx += ((mx / self.W - 0.5) - self.cam_mx) * min(1.0, dt * 1.5)
        self.cam_my += ((my / self.H - 0.5) - self.cam_my) * min(1.0, dt * 1.5)
        if self.orbit:
            self.orbit_angle += dt * 0.42
        else:   # glide back to the nearest front-facing angle
            tgt = round(self.orbit_angle / TAU) * TAU
            self.orbit_angle += (tgt - self.orbit_angle) * min(1.0, dt * 1.2)
        yaw = 0.50 * math.sin(self.t * 0.21) + 0.45 * self.cam_mx + self.orbit_angle
        pitch = 0.10 * math.sin(self.t * 0.16 + 1.0) + 0.22 * self.cam_my
        cy_, sy_, cp_, sp_ = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
        ry = np.array([[cy_, 0, sy_], [0, 1, 0], [-sy_, 0, cy_]])
        rx = np.array([[1, 0, 0], [0, cp_, -sp_], [0, sp_, cp_]])
        self.R = R = (rx @ ry).astype(np.float32)        # view = R @ world

        # ---- homes: digits flow over the heart ----------------------------
        r_tab = self.field.radius(self.u, self.phi)
        self.phi = (self.phi + dt * anim * self.omega / (r_tab * r_tab)) % TAU
        breathe = 1.0 + 0.014 * np.sin(self.t * self.sh_f[:n] + self.sh_p[:n])
        r = r_tab * self.rho * breathe
        home = np.empty((N, 3), np.float32)
        home[:n, 0] = r * self.sin_t * np.cos(self.phi)
        home[:n, 1] = r * self.u - 0.10
        home[:n, 2] = r * self.sin_t * np.sin(self.phi)
        home[n:] = self._spark_home()

        # ---- numbers ------------------------------------------------------
        self.tnum += dt * anim
        d = self._digits(home)
        changed = d != self.digit
        self.digit = d
        self.flash = np.where(changed, 1.0, self.flash * math.exp(-dt * 5.0)).astype(np.float32)

        # ---- palette wave: colour blooms outward from the core ------------
        if self.pal_wave < 1.0:
            self.pal_wave = min(1.0, self.pal_wave + dt / 1.6)
            self.pal_i[self.pal_key < self.pal_wave * 1.5] = self.pal

        # ---- external forces (computed in screen space, applied in 3D) ----
        sx, sy = self.sx, self.sy
        fx = np.zeros(N, np.float32)
        fy = np.zeros(N, np.float32)
        glow = np.zeros(N, np.float32)
        if self.mouse_seen and not self.drag:
            dx, dy = sx - mx, sy - my
            d2 = dx * dx + dy * dy
            dd = np.sqrt(d2) + 1e-3
            if self.attract_mode or self.rmb:        # gravity well with swirl
                rad = 0.34 * self.H
                w = np.exp(-d2 / (rad * rad)) * (dd / (dd + 30.0 * self.us))
                fx += (-dx / dd * 30.0 - dy / dd * 13.0) * w
                fy += (-dy / dd * 30.0 + dx / dd * 13.0) * w
            else:                                    # soft repulsion bubble
                rad = 0.15 * self.H
                w = np.exp(-d2 / (rad * rad))
                fx += dx / dd * 17.0 * w
                fy += dy / dd * 17.0 * w
            glow += 0.45 * w
        for rp in self.ripples:                      # expanding ring waves
            rp[2] += dt
            dx, dy = sx - rp[0], sy - rp[1]
            dd = np.sqrt(dx * dx + dy * dy) + 1e-3
            ring = (dd - 560.0 * self.us * rp[2]) / (40.0 * self.us)
            w = np.exp(-ring * ring) * (rp[3] * (1.0 - rp[2] / 1.5) ** 2)
            fx += dx / dd * 20.0 * w
            fy += dy / dd * 20.0 * w
            glow += w
        self.ripples = [rp for rp in self.ripples if rp[2] < 1.5]
        self.glow = glow
        fmag = np.sqrt(fx * fx + fy * fy)
        fv = np.stack([fx, -fy, -0.45 * fmag], axis=1)       # bulge toward camera
        F = fv @ R                                           # view -> world

        # ---- integrate springs --------------------------------------------
        self.rel *= math.exp(-dt / 0.9)
        free = 1.0 - self.rel
        k = self.kspring * free * free * (1.0 - gm * self.is_heart)
        c = self.cdamp * (1.0 - 0.8 * self.rel) * (1.0 - 0.75 * gm * self.is_heart)
        acc = (home - self.P) * k[:, None] - self.V * c[:, None] + F
        acc[:, 1] -= 3.4 * gm * self.is_heart
        self.V += acc * dt
        self.P += self.V * dt

        if gm > 0.02:                                # floor: bounce and settle
            below = (self.P[:, 1] < FLOOR_Y) & (self.is_heart > 0)
            vy = self.V[:, 1]
            hard = below & (vy < -0.25)
            splash = (np.abs(vy) * 0.38 * hard)[:, None]         # spread into a pool
            self.V[:, ::2] += self.rng.normal(0, 1, (N, 2)).astype(np.float32) * splash
            self.V[:, 1] = np.where(below, np.where(hard, -vy * self.rest, 0.0), vy)
            self.V[below, 0] *= 0.96
            self.V[below, 2] *= 0.96
            self.P[:, 1] = np.where(below, FLOOR_Y, self.P[:, 1])
            if beat_event:                           # the pile jumps on each beat
                near = (self.P[:, 1] < FLOOR_Y + 0.06) & (self.is_heart > 0)
                self.V[:, 1] += near * gm * (0.5 + 2.0 * self.rng.random(N) ** 2)

        # ---- opening: fly in from the dark on spiral paths ----------------
        self.intro_fade = np.ones(n, np.float32)
        if self.intro_on:
            self.intro_t += dt
            hgt = np.clip((home[:n, 1] + 1.1) / 2.3, 0, 1)        # tip assembles first
            delay = 0.25 + 1.5 * self.intro_rand + 1.3 * hgt
            uu = (self.intro_t - delay) / self.intro_dur
            e = ease_in_out_cubic(uu).astype(np.float32)
            off = (self.intro_start - home[:n]) * (1.0 - e)[:, None]
            ang = self.intro_swirl * (1.0 - e)
            ca, sa = np.cos(ang), np.sin(ang)
            fly = uu < 1.0
            px = home[:n, 0] + off[:, 0] * ca + off[:, 2] * sa
            py = home[:n, 1] + off[:, 1]
            pz = home[:n, 2] - off[:, 0] * sa + off[:, 2] * ca
            self.P[:n, 0] = np.where(fly, px, self.P[:n, 0])
            self.P[:n, 1] = np.where(fly, py, self.P[:n, 1])
            self.P[:n, 2] = np.where(fly, pz, self.P[:n, 2])
            self.V[:n][fly] = 0.0
            self.intro_fade = smoothstep(uu * 2.2).astype(np.float32)
            if self.intro_t > 6.6:
                self.intro_on = False

        # ---- explosion pool: fly out, then home in on the heart -----------
        self.b_age += dt
        ub = self.b_age / self.b_dur
        live = ub < 1.0
        if live.any():
            homing = smoothstep((ub - 0.28) / 0.5)
            tgt = self.P[self.b_tgt]
            bacc = (tgt - self.bP) * (30.0 * homing)[:, None] \
                - self.bV * (1.3 + 6.0 * homing)[:, None]
            self.bV += (bacc * dt).astype(np.float32)
            self.bP += self.bV * dt

        # ---- message timing / UI fade -------------------------------------
        self.msg_t += dt
        want = 1.0 if (self.message or self.editing) else 0.0
        self.msg_mix += (want - self.msg_mix) * min(1.0, dt * 3.0)
        show = (not self.ui_hidden) and (self.idle < 6.0 or self.editing or self.drag)
        self.ui_alpha += ((1.0 if show else 0.0) - self.ui_alpha) * min(1.0, dt * 3.5)

        # ---- project everything to the screen -----------------------------
        amp = (0.045 + 0.06 * I) * self.beat * (1.0 - gm)
        scale = 1.0 + amp * (self.is_heart + 0.12 * (1.0 - self.is_heart))
        Pr = self.P * scale[:, None]
        vx, vy, vz = Pr @ R[0], Pr @ R[1], Pr @ R[2]
        den = np.maximum(CAM_DIST + vz, 0.6)
        f = CAM_DIST / den
        self.sx = (self.cx + vx * self.S * f).astype(np.float32)
        self.sy = (self.cy - vy * self.S * f).astype(np.float32)
        self.fpersp, self.vz = f, vz

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------
    def draw(self):
        scr, W, H = self.screen, self.W, self.H
        n, N, I = self.n, self.N, self.intensity
        ADD = pygame.BLEND_RGB_ADD
        intro_g = float(smoothstep((self.intro_t - 0.3) / 3.5)) if self.intro_on else 1.0

        # ---- background (cross-fades between palettes) --------------------
        scr.blit(self.bgs[self.pal], (0, 0))
        if self.pal_wave < 1.0:
            self.bg_fade.blit(self.bgs[self.pal_prev], (0, 0))
            self.bg_fade.set_alpha(int(255 * (1.0 - smoothstep(self.pal_wave))))
            scr.blit(self.bg_fade, (0, 0))

        idx_parts, x_parts, y_parts = [], [], []

        # ---- stars ----------------------------------------------------------
        sp = self.star_P
        vz = sp @ self.R[2]
        f = CAM_DIST / np.maximum(CAM_DIST + vz, 1.0)
        sx = self.cx + (sp @ self.R[0]) * self.S * f
        sy = self.cy - (sp @ self.R[1]) * self.S * f
        ok = (vz > 1.0) & (sx > 0) & (sx < W) & (sy > 0) & (sy < H)
        tw = self.star_b * (0.55 + 0.45 * np.sin(self.t * self.star_f + self.star_p))
        b = np.clip((tw * (BN - 1) * 0.9).astype(np.int64), 0, BN - 1)
        idx = self.DOT0 + (1 * BN + b) * DS + self.star_big
        idx_parts.append(idx[ok])
        x_parts.append((sx - self.d_h[self.star_big])[ok])
        y_parts.append((sy - self.d_h[self.star_big])[ok])

        # ---- heart digits ---------------------------------------------------
        sx, sy, f, vz = self.sx[:n], self.sy[:n], self.fpersp[:n], self.vz[:n]
        wph = (self.phase - 0.22 * self.rho) % 1.0           # pulse of light
        wave = beat_curve(wph) * (1.0 - self.gmix)           # travelling outward
        shim = 0.5 + 0.5 * np.sin(self.t * self.sh_f[:n] * (0.6 + I) + self.sh_p[:n])
        depth = np.clip(1.0 - 0.36 * (vz + 0.7), 0.35, 1.15)  # front is brighter
        br = self.base[:n] * depth * (0.50 + 0.50 * shim)
        br = br + 0.42 * self.flash + 0.34 * wave * self.base[:n] \
            + 0.30 * np.minimum(self.glow[:n], 1.0) + 0.25 * self.rel[:n]
        br *= (0.40 + 0.27 * I) * self.expo * (1.0 - 0.5 * self.gmix) * self.intro_fade
        dens = 0.30 + 0.70 * I                               # soft density cut
        br *= np.clip((dens - self.rank) * 14.0 + 1.0, 0.0, 1.0)

        cxm, cym = self._msg_center()
        if self.msg_inside and self.msg_mix > 0.02 and self.msg_w > 0:
            ex = np.clip((np.abs(sx - cxm) - self.msg_w * 0.5 - 14 * self.us) / (46 * self.us), 0, 1)
            ey = np.clip((np.abs(sy - cym) - self.msg_h * 0.55) / (30 * self.us), 0, 1)
            br *= 1.0 - self.msg_mix * 0.86 * (1.0 - np.maximum(ex, ey))

        tone = self.tone0 + 0.022 * self.digit + 0.24 * self.flash + 0.18 * wave \
            + 0.25 * np.minimum(self.glow[:n], 1.0)
        ti = np.clip((tone * TN).astype(np.int64), 0, TN - 1)
        bi = np.clip((br * BN).astype(np.int64), 0, BN - 1)
        dz = np.abs(vz - FOCUS_Z)
        blur = ((dz > 0.62).astype(np.int64) + (dz > 1.25)) * int(self.dof)
        px = self.size_px[2] * self.size[:n] * f * (1.0 + 0.22 * self.flash)
        si = np.clip(np.searchsorted(self.size_px, px * 0.93), 0, SZ - 1)
        sub = (blur * SZ + si) * 10 + self.digit
        idx = ((self.pal_i[:n] * TN + ti) * BN + bi) * BASE_STRIDE + sub
        ok = (br > 0.035) & (f < 3.2) & (sx > -30) & (sx < W + 30) & (sy > -30) & (sy < H + 30)
        idx_parts.append(idx[ok])
        x_parts.append((sx - self.g_hw[sub])[ok])
        y_parts.append((sy - self.g_hh[sub])[ok])

        # ---- sparks (out-of-focus ones swell into soft bokeh) --------------
        sx, sy, f, vz = self.sx[n:], self.sy[n:], self.fpersp[n:], self.vz[n:]
        tw = self.base[n:] * (0.45 + 0.55 * np.sin(self.t * self.sh_f[n:] + self.sh_p[n:]) ** 2)
        tw = (tw + 0.6 * self.glow[n:]) * (0.55 + 0.6 * I) * intro_g
        dz = np.abs(vz - FOCUS_Z)
        ds = np.clip((self.size[n:] * 1.6 * f).astype(np.int64) + (dz > 1.0) + (dz > 2.0),
                     0, DS - 1)
        b = np.clip((tw * BN).astype(np.int64), 0, BN - 1)
        idx = self.DOT0 + ((self.pal_i[n:] * 2 + self.sp_tint) * BN + b) * DS + ds
        ok = (tw > 0.05) & (f < 3.0) & (sx > -20) & (sx < W + 20) & (sy > -20) & (sy < H + 20)
        idx_parts.append(idx[ok])
        x_parts.append((sx - self.d_h[ds])[ok])
        y_parts.append((sy - self.d_h[ds])[ok])

        # ---- explosion digits (they count upward as they fly) -------------
        ub = self.b_age / self.b_dur
        live = ub < 1.0
        if live.any():
            bp = self.bP[live]
            vz = bp @ self.R[2]
            f = CAM_DIST / np.maximum(CAM_DIST + vz, 0.6)
            sx = self.cx + (bp @ self.R[0]) * self.S * f
            sy = self.cy - (bp @ self.R[1]) * self.S * f
            u = ub[live]
            br = (1.0 - smoothstep((u - 0.72) / 0.28)) * (0.75 + 0.25 * np.sin(self.b_age[live] * 23.0))
            dg = (self.b_seed[live] + (self.b_age[live] * 14.0).astype(np.int64)) % 10
            px = self.size_px[2] * self.b_size[live] * f * (1.25 - 0.45 * u)
            si = np.clip(np.searchsorted(self.size_px, px), 0, SZ - 1)
            dz = np.abs(vz - FOCUS_Z)
            blur = ((dz > 0.7).astype(np.int64) + (dz > 1.4)) * int(self.dof)
            ti = np.clip(((0.95 - 0.5 * u) * TN).astype(np.int64), 0, TN - 1)
            bi = np.clip((br * BN).astype(np.int64), 0, BN - 1)
            sub = (blur * SZ + si) * 10 + dg
            idx = ((self.pal * TN + ti) * BN + bi) * BASE_STRIDE + sub
            ok = (br > 0.04) & (f < 3.0) & (sx > -30) & (sx < W + 30) & (sy > -30) & (sy < H + 30)
            idx_parts.append(idx[ok])
            x_parts.append((sx - self.g_hw[sub])[ok])
            y_parts.append((sy - self.g_hh[sub])[ok])

        # ---- one batched additive draw for every sprite -------------------
        idx = np.concatenate(idx_parts).tolist()
        xs = np.concatenate(x_parts).astype(np.int32).tolist()
        ys = np.concatenate(y_parts).astype(np.int32).tolist()
        scr.blits(list(zip(map(self.sprites.__getitem__, idx), zip(xs, ys),
                           repeat(None), repeat(ADD))), doreturn=False)
        self.drawn = len(idx)

        # ---- cursor light ---------------------------------------------------
        if self.mouse_seen:
            dot = self.sprites[self.DOT0 + ((self.pal * 2) * BN + 3) * DS + DS - 1]
            scr.blit(dot, (self.mouse[0] - dot.get_width() // 2,
                           self.mouse[1] - dot.get_height() // 2), special_flags=ADD)

        self._draw_message()

        # ---- bloom + aura ---------------------------------------------------
        st = pygame.transform.smoothscale
        st(scr, self.q_size, self.buf_q)
        self.buf_q.blit(self.bgs_q[self.pal], (0, 0), special_flags=pygame.BLEND_RGB_SUB)
        st(self.buf_q, self.s_size, self.buf_s)
        st(self.buf_s, self.q_size, self.buf_qs)
        self.buf_q.blit(self.buf_qs, (0, 0), special_flags=ADD)       # wide halo
        lvl = int(np.clip((0.25 + 0.75 * self.beat) * (0.35 + 0.65 * I) * intro_g
                          * (1.0 - 0.7 * self.gmix) * 8, 0, 7))
        self.buf_q.blit(self.auras[self.pal][lvl], (0, 0), special_flags=ADD)
        g = int(255 * min(1.0, 0.22 + 0.40 * I))
        self.buf_q.fill((g, g, g), special_flags=pygame.BLEND_RGB_MULT)
        st(self.buf_q, (W, H), self.buf_full)
        scr.blit(self.buf_full, (0, 0), special_flags=ADD)

        # ---- crisp overlays -------------------------------------------------
        if self.ui_alpha > 0.01:
            self._draw_ui()
        if self.editing:
            t = self.font_hint.render("type your message   -   Enter to set   -   Esc to cancel",
                                      True, (190, 170, 190))
            scr.blit(t, t.get_rect(center=(int(cxm), int(cym + self.msg_h * 0.95))))
        if self.show_fps:
            t = self.font_hint.render("%d fps   %d sprites" % (self.fps, self.drawn),
                                      True, (150, 130, 150))
            scr.blit(t, (10, 8))

    def _draw_message(self):
        """Letter-by-letter eased reveal; the bloom pass makes it glow."""
        if self.msg_mix < 0.01 or (self.msg_t < 0 and not self.editing):
            return
        cxm, cym = self._msg_center()
        x0 = cxm - self.msg_w * 0.5
        y0 = cym - self.msg_h * 0.5
        pulse = 0.82 + 0.18 * self.beat
        x_end = x0
        for i, (s, x) in enumerate(self.msg_chars):
            e = 1.0 if self.editing else ease_out_cubic((self.msg_t - i * 0.05) / 0.7)
            if e <= 0.0:
                continue
            s.set_alpha(int(255 * e * pulse * self.msg_mix))
            self.screen.blit(s, (int(x0 + x), int(y0 + (1.0 - e) * 12 * self.us)))
            x_end = x0 + x + s.get_width()
        if self.editing and (self.t * 2.0) % 1.0 < 0.55:
            pygame.draw.line(self.screen, (255, 235, 240),
                             (int(x_end + 4), int(y0 + 4)),
                             (int(x_end + 4), int(y0 + self.msg_h - 4)), max(1, int(2 * self.us)))


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Numeric Heart - a living heart made of numbers")
    ap.add_argument("--size", default="auto",
                    help="render resolution, e.g. 1920x1080 (auto: 1280x720 windowed, native fullscreen)")
    ap.add_argument("--sharp", action="store_true", help="start with depth-of-field blur off (B toggles)")
    ap.add_argument("--fullscreen", action="store_true")
    ap.add_argument("--particles", type=int, default=5600, help="digits forming the heart")
    ap.add_argument("--bpm", type=float, default=66.0)
    ap.add_argument("--intensity", type=float, default=0.7, help="0..1")
    ap.add_argument("--palette", type=int, default=0, help="0 crimson, 1 neon pink, 2 purple, 3 golden")
    ap.add_argument("--message", default="every number beats for you")
    ap.add_argument("--fps", type=int, default=60, help="frame-rate cap")
    ap.add_argument("--show-fps", action="store_true")
    ap.add_argument("--no-retina", action="store_true",
                    help="macOS + pygame-ce: skip the high-DPI window (faster, softer)")
    ap.add_argument("--seed", type=int, default=7)
    return ap.parse_args(argv)


def enable_hidpi():
    """Without this, Windows renders the window small and stretches it by the
    display-scaling factor (125 %, 150 %...), which makes everything blurry."""
    if sys.platform == "win32":
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass


def choose_size(args):
    if args.size.lower() != "auto":
        return tuple(int(v) for v in args.size.lower().split("x"))
    # Fullscreen renders at the screen's own resolution (capped at 1080 lines
    # for speed) so nothing is stretched; windowed defaults to 720p.
    w, h = 1280, 720
    if args.fullscreen:
        try:
            dw, dh = pygame.display.get_desktop_sizes()[0]
            k = min(1.0, 1080.0 / dh)
            w, h = int(dw * k), int(dh * k)
        except Exception:
            pass
    return w, h


def open_retina(args):
    """macOS Retina path.  Classic pygame cannot open a high-DPI window: it
    draws at half resolution and macOS stretches it 2x, which looks soft.
    pygame-ce (a drop-in replacement: `pip install pygame-ce`) can, through
    its Window class.  Returns None if that is not available."""
    if args.no_retina or sys.platform != "darwin" or not getattr(pygame, "IS_CE", False):
        return None
    try:
        if args.fullscreen:
            size = pygame.display.get_desktop_sizes()[0]
        else:
            size = choose_size(args)
        win = pygame.Window("Numeric Heart", size=size, allow_high_dpi=True,
                            fullscreen_desktop=bool(args.fullscreen))
        screen = win.get_surface()
        scale = screen.get_width() / float(win.size[0])
        return screen, win.flip, scale, False
    except Exception as exc:                      # fall back to the classic path
        print("Retina window unavailable (%s); using standard window" % exc)
        return None


def open_display(args):
    """Returns (screen, flip, mouse_scale, can_toggle_fullscreen)."""
    retina = open_retina(args)
    if retina:
        return retina
    w, h = choose_size(args)
    flags = pygame.SCALED | pygame.RESIZABLE | (pygame.FULLSCREEN if args.fullscreen else 0)
    try:        # SCALED keeps a fixed render size and lets the GPU stretch it
        screen = pygame.display.set_mode((w, h), flags, vsync=1)
    except pygame.error:
        screen = pygame.display.set_mode((w, h), pygame.FULLSCREEN if args.fullscreen else 0)
    pygame.display.set_caption("Numeric Heart")
    return screen, pygame.display.flip, 1.0, True


def main(argv=None):
    args = parse_args(argv)
    enable_hidpi()
    pygame.init()
    screen, flip, mouse_scale, can_fs = open_display(args)
    screen.fill((6, 2, 12))
    flip()

    app = NumericHeart(screen, args, mouse_scale, can_fs)
    clock = pygame.time.Clock()
    running = True
    while running:
        dt = clock.tick(args.fps) / 1000.0
        for e in pygame.event.get():
            if not app.handle_event(e):
                running = False
        app.update(dt)
        app.draw()
        flip()
    pygame.quit()


if __name__ == "__main__":
    main()
