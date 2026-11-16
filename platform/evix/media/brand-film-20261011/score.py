"""THE UNCOUNTED WINDOW / 未被计入的光 — original procedural score.

Deterministic 240 s / 48 kHz stereo. Every oscillator, excitation, room impulse,
percussion and ambient sound is synthesized here; no recordings or sample packs.
The four-note question D–A–E–F is left incomplete until a transformed F# answers
it at dawn. A warm glass tone first belongs to a passing window, then returns as
an individual voice. No compressor/limiter or clipping is used in this premaster.

Run: python score.py [output.wav]
Root's mastering step applies measured two-pass loudness normalization.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SR = 48000
DURATION = 240.0
N = int(SR * DURATION)
RNG = np.random.default_rng(2026101107)
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DEFAULT_OUT = ROOT / 'outputs/evix-brand-film-20261011/score.wav'
HANDOFF = ROOT / '.collab/runs/20261011-film/handoffs/score.json'
MUSIC = np.zeros((2, N), dtype=np.float32)
SEND = np.zeros_like(MUSIC)
FOLEY = np.zeros_like(MUSIC)
CUES: list[dict] = []


def timeline(seconds):
    return np.arange(int(round(seconds * SR)), dtype=np.float64) / SR


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def shaped_noise(seconds, low=None, high=None, order=2):
    n = RNG.standard_normal(int(round(seconds * SR))).astype(np.float32)
    return filt(n, low, high, order)


def filt(x, low=None, high=None, order=2):
    """Smooth zero-phase Butterworth-magnitude shaping, using numpy only."""
    if not low and not high:
        return x
    spec = np.fft.rfft(x)
    frequencies = np.fft.rfftfreq(len(x), 1 / SR)
    if high:
        spec /= np.sqrt(1 + (frequencies / high) ** (2 * order))
    if low:
        spec /= np.sqrt(1 + (low / np.maximum(frequencies, 1e-8)) ** (2 * order))
    return np.fft.irfft(spec, n=len(x)).astype(np.float32)


def convolve_room(x, impulse):
    """Bounded-memory overlap-add convolution; no scipy runtime required."""
    block = 131072
    fft_size = 1 << (block + len(impulse) - 2).bit_length()
    kernel = np.fft.rfft(impulse, n=fft_size)
    result = np.zeros(len(x), dtype=np.float32)
    for start in range(0, len(x), block):
        segment = x[start:start + block]
        convolution = np.fft.irfft(np.fft.rfft(segment, n=fft_size) * kernel, n=fft_size)
        count = min(len(convolution), len(result) - start)
        result[start:start + count] += convolution[:count].astype(np.float32)
    return result


def envelope(t, attack=.8, release=1.5):
    dur = len(t) / SR
    a = np.clip(t / max(.001, attack), 0, 1)
    r = np.clip((dur - t) / max(.001, release), 0, 1)
    return (np.sin(a * np.pi / 2) ** 2 * np.sin(r * np.pi / 2) ** 2).astype(np.float32)


def put(signal, start, gain=1.0, pan=0.0, reverb=.25, sfx=False):
    start_i = int(round(start * SR))
    if start_i < 0 or start_i >= N:
        raise ValueError(f'Invalid cue {start}')
    signal = np.asarray(signal, dtype=np.float32)
    count = min(signal.shape[-1], N - start_i)
    if signal.ndim == 1:
        angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        signal = np.stack((signal * np.cos(angle), signal * np.sin(angle)))
    signal = signal[:, :count] * gain
    target = FOLEY if sfx else MUSIC
    target[:, start_i:start_i + count] += signal
    if not sfx:
        SEND[:, start_i:start_i + count] += signal * reverb


def cue(t, name, purpose):
    CUES.append({'time_seconds': t, 'name': name, 'purpose': purpose})


def strings(notes, seconds, attack=1.8, release=2.3, brightness=.4, voices=3):
    """Bowed ensemble: independent detuning and integrated vibrato, gentle bow air."""
    t = timeline(seconds)
    out = np.zeros((2, len(t)), dtype=np.float32)
    for note_i, note in enumerate(notes):
        for voice in range(voices):
            f = hz(note) * 2 ** (RNG.uniform(-7, 7) / 1200)
            rate = RNG.uniform(4.35, 5.25)
            phase0 = RNG.uniform(0, 2 * np.pi)
            vib_phase = -f * .0016 / rate * np.cos(2 * np.pi * rate * t + phase0)
            phase = 2 * np.pi * f * t + vib_phase
            tone = np.zeros(len(t), dtype=np.float32)
            for harmonic in range(1, 9):
                body = 1 + .35 * np.exp(-((f * harmonic - 460) / 300) ** 2)
                amp = np.exp(-harmonic * (.62 - brightness * .31)) / harmonic ** .8
                tone += (body * amp * np.sin(harmonic * phase + RNG.uniform(0, 6.28))).astype(np.float32)
            tone *= 1 + .055 * np.sin(2 * np.pi * RNG.uniform(.3, .6) * t + phase0)
            tone += shaped_noise(seconds, 700, 4200) * .008
            pan = np.clip((note_i / max(1, len(notes) - 1) - .5) * .7 + (voice - 1) * .2, -.85, .85)
            ang = (pan + 1) * np.pi / 4
            out[0] += tone * np.cos(ang)
            out[1] += tone * np.sin(ang)
    out *= envelope(t, attack, release)
    return out / (math.sqrt(len(notes)) * voices * 1.8)


def felt(note, seconds=5, velocity=.75):
    t = timeline(seconds)
    out = np.zeros(len(t), dtype=np.float32)
    f0 = hz(note)
    for detune in (-.00045, .00052):
        for h in range(1, 10):
            # Two piano strings, very modest inharmonicity and felt-muted high modes.
            f = f0 * h * (1 + detune) * np.sqrt(1 + .00007 * h * h)
            tau = (3.5 if note < 60 else 2.8) / h ** .65
            amp = np.exp(-h * .13) / h ** 1.27
            out += (amp * np.sin(2 * np.pi * f * t + .05 * h) * np.exp(-t / tau)).astype(np.float32)
    out *= (1 - np.exp(-t / .0035)) * envelope(t, .003, .45)
    contact = shaped_noise(min(seconds, .06), 450, 2600)
    out[:len(contact)] += contact * np.exp(-np.arange(len(contact)) / (SR * .013)) * .025
    return out * velocity * .32


def glass(note, seconds=8, velocity=.5):
    """Softly struck cup. Sparse modes retain a personal imperfect timbre."""
    t = timeline(seconds)
    out = np.zeros(len(t), dtype=np.float32)
    for ratio, level, decay in ((1, 1, 3.7), (2.71, .12, 1.5), (4.16, .048, .8), (5.43, .02, .4)):
        out += (np.sin(2 * np.pi * hz(note) * ratio * t) * level * np.exp(-t / decay)).astype(np.float32)
    return out * envelope(t, .008, .5) * velocity * .4


def horn(notes, seconds, attack=.6, release=1.2):
    t = timeline(seconds)
    out = np.zeros((2, len(t)), dtype=np.float32)
    for k, note in enumerate(notes):
        f = hz(note)
        phase = 2 * np.pi * f * t + .025 * np.sin(2 * np.pi * 4.1 * t)
        s = np.zeros(len(t), dtype=np.float32)
        for h in range(1, 7):
            s += (np.sin(phase * h) * np.exp(-h * .54) / h ** .45).astype(np.float32)
        s += shaped_noise(seconds, 300, 1700) * .005
        ang = (.34 + k / max(1, len(notes) - 1) * .32) * np.pi / 2
        out[0] += s * np.cos(ang)
        out[1] += s * np.sin(ang)
    return out * envelope(t, attack, release) / max(1, math.sqrt(len(notes)))


def low_note(note, seconds=5):
    t = timeline(seconds)
    phase = 2 * np.pi * hz(note) * t
    s = np.sin(phase) + .24 * np.sin(phase * 2) + .065 * np.sin(phase * 3)
    return s.astype(np.float32) * envelope(t, .1, min(1.2, seconds * .4)) * .5


def drum(note=38, seconds=2.5, strength=1):
    t = timeline(seconds)
    f = hz(note) * (1 + .34 * np.exp(-t * 19))
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t / .63)
    skin = shaped_noise(seconds, 80, 650) * np.exp(-t * 22) * .5
    skin += shaped_noise(seconds, 650, 2500) * np.exp(-t * 60) * .10
    return (body + skin).astype(np.float32) * envelope(t, .003, .15) * strength * .7


def impact(seconds=5, frequency=35, strength=1):
    t = timeline(seconds)
    f = frequency + 45 * np.exp(-t * 4)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.2)
    dust = shaped_noise(seconds, 35, 400) * np.exp(-t / .6)
    return (body * .7 + dust * 1.2).astype(np.float32) * envelope(t, .012, .8) * strength


def tick(seconds=.45, pitch=850):
    t = timeline(seconds)
    s = np.sin(2 * np.pi * pitch * t) * np.exp(-t * 120)
    s += np.sin(2 * np.pi * pitch * 1.61 * t) * np.exp(-t * 180) * .24
    s += shaped_noise(seconds, 900, 4500) * np.exp(-t * 140) * .3
    return s.astype(np.float32) * envelope(t, .001, .01) * .35


def air(seconds, strength=.01, pulse=13, low=80, high=1900):
    t = timeline(seconds)
    out = []
    common = shaped_noise(seconds, low, high)
    for ch in range(2):
        independent = shaped_noise(seconds, low, high)
        flutter = .62 + .22 * np.sin(2 * np.pi * t / pulse + ch * .9) + .12 * np.sin(2 * np.pi * t / 3.7)
        out.append((common * .55 + independent * .45) * flutter * envelope(t, 2.5, 3) * strength)
    return np.array(out, dtype=np.float32)


def sweep(seconds=2, strength=.15):
    t = timeline(seconds)
    x = shaped_noise(seconds, 300, 3500) * np.sin(np.pi * t / seconds) ** 3
    p = np.linspace(-.6, .6, len(t))
    return np.array([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], dtype=np.float32) * strength


def paper(seconds=.7):
    t = timeline(seconds)
    grain = shaped_noise(seconds, 1400, 6500)
    flutter = np.sin(np.pi * t / seconds) ** 2 * (.5 + .5 * np.sin(2 * np.pi * 37 * t))
    return grain * flutter * .04


HARMONY = {
    'open': [38, 50, 57, 64],
    'Dm9': [50, 57, 62, 64, 65],
    'Bb': [46, 53, 57, 62, 65],
    'F': [41, 53, 60, 64, 69],
    'C': [48, 55, 60, 64, 67],
    'Gm': [43, 50, 58, 62, 65],
    'Asus': [45, 52, 57, 62, 64],
    'G': [43, 50, 59, 62, 67],
    'D': [38, 50, 57, 62, 66, 69],
    'A': [45, 52, 57, 61, 64],
    'Bm': [47, 54, 59, 62, 66],
}


def chord(name, start, seconds, gain=.18, attack=1.5, release=2, bright=.35):
    put(strings(HARMONY[name], seconds, attack, release, bright), start, gain, reverb=.45)


def question(start, spacing, gain=.2, register=0, fourth=False, major=False):
    notes = [62, 69, 76]
    if fourth:
        notes += [78 if major else 77]
    for i, note in enumerate(notes):
        put(felt(note + register, 6, .8 - i * .04), start + spacing * i,
            gain, pan=-.22 + i * .13, reverb=.43)


def arrange():
    # I. Eclipse. Vast exterior, a single small warm response inside it.
    cue(0, 'Eclipse', 'Nearly inaudible room of the universe; scale emerges gradually.')
    put(air(24, .035, low=30, high=700), 0, sfx=True)
    chord('open', .4, 23.6, .12, attack=5.5, release=5)
    put(low_note(26, 18), 3, .10, reverb=.08)
    put(strings([69, 76], 10, 4, 3, .12), 8, .045, reverb=.8)
    put(impact(7, 31), 10.8, .21, reverb=.5)
    put(glass(62, 7, .35), 16.1, .18, pan=.48, reverb=.7)
    put(sweep(4, .20), 21, .35, reverb=.65)
    cue(16.1, 'First light', 'Unresolved warm glass, a small individual response.')

    # II. City. Three widely separated notes search across monumental architecture.
    cue(24, 'City nocturne', 'Slow incomplete motif; spacious strings, city wind.')
    put(air(32, .075, pulse=19, low=45, high=2300), 24, sfx=True)
    put(impact(4, 36), 24, .19, reverb=.42)
    for name, start in [('Dm9', 24), ('Bb', 32), ('F', 40), ('Asus', 48)]:
        chord(name, start, 10, .17, attack=2.3, release=3.3)
    question(28, 5.5, .37)
    put(glass(69, 8, .48), 39.2, .31, pan=.5, reverb=.36)
    cue(39.2, 'Passing window', 'Soft cup resonance belongs to a window the camera almost overlooks.')
    put(felt(50, 6, .8), 47, .3, pan=-.2, reverb=.6)
    put(felt(64, 5, .6), 52, .26, pan=.24, reverb=.6)
    put(sweep(2.4, .16), 54.2, .6, reverb=.3)

    # III. Archive. 12 four-beat bars, 80 BPM; a machine is seductive precisely
    # because it seems tidy. The rhythm never becomes a four-minute trailer loop.
    cue(56, 'Archive mechanism', 'Meter at 80 BPM with unpitched paper/wood detail.')
    put(air(36, .022, pulse=9, low=160, high=1700), 56, sfx=True)
    for bar in range(12):
        start = 56 + bar * 3
        name = ['Dm9', 'Dm9', 'Bb', 'Bb', 'F', 'F', 'C', 'C', 'Gm', 'Gm', 'Asus', 'Asus'][bar]
        if bar % 2 == 0:
            chord(name, start, 7.2, .16 + bar * .006, attack=1.1, release=2)
        roots = HARMONY[name]
        for beat in range(4):
            at = start + beat * .75
            put(tick(pitch=660 + 80 * (beat % 2)), at, .09 + bar * .005,
                pan=(-1) ** beat * .45, reverb=.13)
            note = roots[[0, 2, 3, 2][beat]] + (12 if beat == 2 else 0)
            put(felt(note, 1.8, .45), at + .018, .20 + bar * .009,
                pan=(-1) ** beat * .2, reverb=.2)
        if bar >= 4:
            put(drum(38, 2), start, .10 + .015 * bar, reverb=.3)
        if bar in (1, 3, 6, 9):
            put(paper(), start + 1.1, 1, pan=.45 if bar % 2 else -.45, sfx=True)
    question(75, 3, .34, register=0)

    # IV. Perfect grid. 32 beats at 96 BPM, acceleration and illusory certainty.
    cue(92, 'The closed circle', 'Increasingly locked rhythmic order; held suspended harmony.')
    for name, start in [('Dm9', 92), ('Bb', 97), ('Gm', 102), ('Asus', 107)]:
        chord(name, start, 6.5, .30 + (start - 92) * .007, attack=.7, release=1)
        put(horn(HARMONY[name][1:4], 5, .9, 1), start, .08 + (start - 92) * .005, reverb=.45)
    for beat in range(32):
        start = 92 + beat * .625
        strength = .17 + beat * .008
        if beat % 2 == 0:
            put(drum(38 if beat % 4 == 0 else 45, 1.7), start, strength, reverb=.3)
        put(felt([62, 69, 74, 76][beat % 4], 1.2, .55), start,
            .18 + beat * .004, pan=(-1) ** beat * .33, reverb=.25)
        put(tick(pitch=1050), start + .3125, .10, pan=.5, reverb=.1)
    put(strings([74, 76, 81], 6.2, 5.5, .1, .52), 105.8, .23, reverb=.55)
    put(sweep(3.2, .28), 108.8, .95, reverb=.4)
    # Foley at the break is kept outside the music mute, with an actual small
    # silence after the crack. The cut is expressive, not another huge impact.
    cue(112, 'Omission', 'Hard score cut; a dry hairline crack and the absence of a voice.')
    t = timeline(.3)
    crack = shaped_noise(.3, 800, 6000) * np.exp(-t * 45) * .07
    put(crack, 112, 1, pan=-.12, sfx=True)
    put(air(11.2, .013, pulse=14, low=120, high=1500), 112.8, sfx=True)

    # V. One window. The same cup returns. No swelling emotional instruction;
    # the viewer has room to notice a person-sized sound.
    cue(124, 'The uncounted window', 'A room, a cup, air. Recognition before orchestration.')
    put(air(34, .025, pulse=17, low=100, high=1300), 124, sfx=True)
    t = timeline(34)
    room = (np.sin(2 * np.pi * 50 * t) * .0017 + np.sin(2 * np.pi * 100 * t) * .00045)
    put(room.astype(np.float32) * envelope(t, 2, 3), 124, sfx=True)
    put(glass(69, 10, .50), 126.0, .46, pan=.28, reverb=.16)
    put(felt(50, 8, .5), 132.4, .19, pan=-.18, reverb=.22)
    put(glass(62, 8, .4), 137.7, .34, pan=.18, reverb=.20)
    put(felt(69, 7, .55), 144, .18, pan=-.12, reverb=.22)
    put(paper(.85), 148.8, .65, pan=-.45, sfx=True)
    put(glass(76, 7, .35), 151.2, .29, pan=.10, reverb=.25)
    put(strings([50, 57], 12, 5, 2.5, .18), 146, .048, reverb=.45)

    # VI. Reopening. The fragile voice is included, not overwritten by the mass.
    cue(158, 'Open one gap', 'Warm glass remains audible inside the returning collective.')
    for bar in range(8):
        start = 158 + bar * 4
        name = ['Dm9', 'Bb', 'F', 'C', 'G', 'Bm', 'G', 'Asus'][bar]
        chord(name, start, 5.8, .17 + bar * .022, attack=1.2, release=2.2, bright=.38)
        root = HARMONY[name][0]
        put(low_note(root, 4), start, .13 + bar * .012, reverb=.15)
        for step in range(4):
            n = HARMONY[name][[1, 2, 3, 2][step]]
            put(felt(n + 12, 2.8, .55), start + step + .02 * (step % 2),
                .23 + bar * .012, pan=(-1) ** step * .24, reverb=.34)
        if bar > 1:
            put(drum(38, 2.6), start, .17 + .01 * bar, reverb=.3)
            put(drum(45, 1.4), start + 2.5, .085 + .008 * bar, pan=.15, reverb=.28)
        if bar in (0, 3, 6):
            put(glass([69, 76, 74][bar // 3], 8, .5), start + .4, .37,
                pan=.3, reverb=.25)
    question(170, 3, .38)
    put(horn([50, 57, 62], 9, 3, 2), 181, .14, reverb=.45)
    put(sweep(2.5, .16), 187.6, .5, reverb=.3)

    # VII. Q → D → I → A. Four timbres keep identity while handing over a theme.
    cue(190, 'Q / Question', 'Felt piano asks, over an open fifth.')
    cue(197, 'D / Data', 'Individual cup/glass notes become a plural, irregular pattern.')
    cue(204, 'I / Insight', 'Bowed voices bring relations into focus.')
    cue(211, 'A / Action', 'Rounded brass and skin percussion give the pattern direction.')
    for i, (name, start) in enumerate([('D', 190), ('Bm', 197), ('G', 204), ('Asus', 211)]):
        chord(name, start, 8.5, .35 + i * .025, attack=1, release=2, bright=.48)
        put(low_note(HARMONY[name][0], 6.8), start, .22, reverb=.18)
        put(impact(3.5, hz(26)), start, .11, reverb=.32)
        for step, offset in enumerate((0, 2, 3.5, 5.5)):
            put(drum(38 if step % 2 == 0 else 45, 2), start + offset,
                .26 if step == 0 else .15, pan=.05, reverb=.35)
        if i == 0:
            question(start + .4, 1.75, .5)
        elif i == 1:
            for j, offset in enumerate((.4, 1.45, 2.9, 4.35, 5.8)):
                put(glass([62, 69, 76, 69, 74][j], 4.8, .6), start + offset, .43,
                    pan=(-1) ** j * .35, reverb=.3)
        elif i == 2:
            for j, note in enumerate((62, 69, 76)):
                put(strings([note], 4, .65, 1.2, .4), start + j * 1.8, .22, reverb=.48)
        else:
            put(horn([50, 57, 62], 6.5, 1, 1.2), start, .28, reverb=.48)
            for j, note in enumerate((62, 69, 76)):
                put(felt(note, 3.5, .7), start + j * 1.7, .32, reverb=.35)
    put(sweep(3.3, .18), 214.7, .6, reverb=.5)

    # VIII. Dawn. The missing note arrives transformed; no borrowed composition.
    cue(218, 'Dawn / the fourth note', 'First complete motif, minor expectation opens into D major.')
    for name, start, dur in [('D', 218, 6), ('G', 223, 4.6), ('A', 227, 3.6), ('D', 230, 9)]:
        chord(name, start, dur, .42 if start == 218 else .33, attack=1.1, release=2.5, bright=.5)
    put(horn([50, 57, 62, 66], 10.5, 1.8, 3), 218, .24, reverb=.52)
    put(impact(4.5, 33), 218, .18, reverb=.45)
    for start, note in [(218.5, 62), (220.0, 69), (221.65, 76), (223.5, 78), (226, 74), (228.5, 69), (231, 62)]:
        put(felt(note, 7, .8), start, .49, pan=-.12, reverb=.46)
        if start < 228:
            put(strings([note], 4.6, .65, 1.8, .35), start, .11, reverb=.48)
    put(glass(69, 9, .45), 227.8, .26, pan=.35, reverb=.38)
    put(drum(38, 3.5), 218, .27, reverb=.4)
    put(drum(45, 2.8), 223, .13, reverb=.4)
    put(air(22, .028, pulse=16, low=170, high=2200), 218, sfx=True)
    cue(232, 'Credits / room for air', 'Motif settles; warm glass is still an individual voice.')
    put(glass(74, 8, .35), 232, .22, pan=.27, reverb=.35)
    put(felt(50, 8, .55), 232, .25, pan=-.15, reverb=.45)
    put(felt(66, 7, .45), 233.2, .17, pan=.1, reverb=.5)


def room_impulse(channel):
    seconds = 4.8
    t = timeline(seconds)
    noise = shaped_noise(seconds, 130, 4200)
    ir = noise * np.exp(-6.9078 * t / 3.1)
    ir[:int(.025 * SR)] = 0
    # Early reflections precede diffuse late field, with different wall paths.
    for delay, amplitude in ((.031, .36), (.049, .27), (.073, .19), (.113, .14)):
        ir[int((delay + channel * .0037) * SR)] += amplitude
    ir /= np.sqrt(np.sum(ir.astype(np.float64) ** 2))
    return ir.astype(np.float32)


def db(v):
    return float(20 * np.log10(max(float(v), 1e-12)))


def stats(x):
    return {
        'peak_dbfs': round(db(np.max(np.abs(x))), 4),
        'rms_dbfs': round(db(np.sqrt(np.mean(x.astype(np.float64) ** 2))), 4),
    }


def render():
    print('Composing original 240 s score and synthesized location sound...', flush=True)
    arrange()
    print('Rendering two independent diffuse room responses...', flush=True)
    mix = np.zeros_like(MUSIC)
    for ch in range(2):
        wet = convolve_room(filt(SEND[ch], 130, 5800), room_impulse(ch))
        mix[ch] = MUSIC[ch] + wet * .31
    del wet
    # The deliberate hard cut removes room tails too. A 12 ms boundary prevents
    # electrical clicks, while keeping the 112.000 s visual break perceptually hard.
    cut = int(112 * SR)
    ramp = int(.012 * SR)
    mix[:, cut - ramp:cut] *= np.linspace(1, 0, ramp, dtype=np.float32)
    mix[:, cut:int(124 * SR)] = 0
    mix += FOLEY
    for ch in range(2):
        mix[ch] = filt(mix[ch], 24, 14500)
    mix[:, :int(.08 * SR)] *= np.linspace(0, 1, int(.08 * SR), dtype=np.float32)
    mix[:, int(238 * SR):] *= np.linspace(1, 0, int(2 * SR), dtype=np.float32) ** 1.7
    assert np.isfinite(mix).all()
    # Preserve score dynamics. Global peak scaling is not dynamic compression.
    unscaled_peak = float(np.max(np.abs(mix)))
    gain = 10 ** (-3 / 20) / max(unscaled_peak, 1e-9)
    mix *= gain
    pcm = np.rint(mix.T * 32767).astype('<i2')
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())
    measured = pcm.astype(np.float64).T / 32768
    boundaries = [0, 24, 56, 92, 112, 124, 158, 190, 197, 204, 211, 218, 232, 240]
    sections = [dict(start_seconds=a, end_seconds=b, **stats(measured[:, int(a*SR):int(b*SR)]))
                for a, b in zip(boundaries, boundaries[1:])]
    clipped = int(np.count_nonzero(np.abs(pcm.astype(np.int32)) >= 32767))
    assert clipped == 0
    assert pcm.shape == (11520000, 2)
    assert np.max(np.abs(pcm[-1])) == 0
    score_hash = hashlib.sha256(out.read_bytes()).hexdigest()
    source_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    completed = datetime.now(timezone.utc).isoformat()
    report = {
        'protocol_version': 'agent-collab/v1', 'nonce': 'film-score-01',
        'sender': '/root/film_score', 'receiver': '/root',
        'issued_at': completed, 'expires_at': '2026-10-11T11:00:00Z',
        'base_revision': '6ef94bddde38523443e51d93e91e6fbe7102a6f28001445693a850b99e177f77',
        'target_revision': {'score.py_sha256': source_hash, 'score.wav_sha256': score_hash},
        'data_classification': 'internal', 'content_classification': 'original_synthetic',
        'capabilities_used': ['declared file reads', 'declared output writes', 'local Python numerical execution'],
        'claims': [
            {'class': 'observed', 'text': '240 second stereo 48000 Hz PCM16 audio written; exact 11520000 frames.'},
            {'class': 'observed', 'text': 'All audio generated numerically; no external samples or voices read.'},
            {'class': 'observed', 'text': 'No PCM sample reaches clipping; final sample exactly zero.'},
            {'class': 'inferred', 'text': 'Varied orchestration and dynamic contrast are intended to support the locked narrative.'},
        ],
        'evidence_refs': [
            {'path': 'media/brand-film-20261011/score.py', 'sha256': source_hash},
            {'path': 'outputs/evix-brand-film-20261011/score.wav', 'sha256': score_hash}],
        'commands': [{'command': 'bundled Python media/brand-film-20261011/score.py', 'exit_code': 0}],
        'audio': {'duration_seconds': DURATION, 'sample_rate': SR, 'channels': 2,
                  'sample_width_bits': 16, 'frames': len(pcm), 'clipped_samples': clipped,
                  'premaster_gain': gain, 'peak_before_gain': unscaled_peak,
                  'channel_rms_dbfs': [round(db(np.sqrt(np.mean(measured[ch]**2))), 4) for ch in range(2)],
                  'channel_correlation': round(float(np.corrcoef(measured)[0, 1]), 5),
                  **stats(measured), 'sections': sections},
        'cue_sheet': sorted(CUES, key=lambda c: c['time_seconds']),
        'unresolved_items': ['Root two-pass loudness mastering and encoded-audio measurements pending.',
                             'No subjective human listening test claimed; review the mastered film on speakers/headphones.'],
        'risks': ['Synthesized acoustic timbres are stylized, not recorded acoustic performers.'],
        'next_action': 'Root master to -16 LUFS / -1.5 dBTP, verify accents against frames, independently check playback.',
        'outcome': 'done'
    }
    HANDOFF.parent.mkdir(parents=True, exist_ok=True)
    HANDOFF.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'wav': str(out), 'sha256': score_hash, 'audio': report['audio']}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    render()
