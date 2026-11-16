"""Deterministic original score for the GLK Introduction review draft."""
import wave

import numpy as np


def corporate_bed(length, card_time, rate=48000, effects=False):
    count = round(length * rate)
    bed = np.zeros((count, 2), dtype=np.float32)
    rng = np.random.default_rng(4185)
    beat = 60 / 78
    progression = [
        (50, (57, 62, 64, 66)),  # D add9
        (47, (54, 59, 62, 64)),  # Bm add11
        (43, (55, 59, 62, 66)),  # G maj7
        (45, (55, 57, 61, 64)),  # A7
    ]

    def mix(at, samples, gain, pan=0.0):
        start = round(at * rate)
        samples = samples[:count-start]
        if len(samples):
            bed[start:start+len(samples), 0] += samples * gain * (1-pan)
            bed[start:start+len(samples), 1] += samples * gain * (1+pan)

    def note(midi, length, bass=False):
        t = np.arange(round(length*rate)) / rate
        f = 440 * 2**((midi-69)/12)
        a = 2*np.pi*f*t
        envelope = np.minimum(t/(.04 if bass else .026), 1) * np.exp(-t/(.46 if bass else .76))
        envelope *= np.minimum((length-t)/.15, 1)
        return envelope*(np.sin(a)+.19*np.sin(2*a)*np.exp(-2.3*t)+.07*np.sin(3*a)*np.exp(-4*t))

    for bar in range(int(length/(4*beat))+1):
        start = bar*4*beat
        bass, chord = progression[bar%len(progression)]
        mix(start, note(bass-12,1.7,True), .013)
        if start+2*beat<length:
            mix(start+2*beat,note(bass-5,1.3,True),.007)
        for i,offset in enumerate((0,.75,1.5,2.5,3.35)):
            at=start+offset*beat
            if at<length:
                mix(at,note(chord[(i+bar%2)%4],1.8),.012 if i in (0,3) else .009,(-1 if i%2 else 1)*.18)
        for offset in (.5,1.5,2.5,3.5):
            at=start+offset*beat
            if at>=length:continue
            t=np.arange(round(.10*rate))/rate
            noise=np.convolve(rng.uniform(-1,1,len(t)),np.ones(6)/6,mode='same')
            brush=noise*np.minimum(t/.014,1)*np.exp(-t*42)
            mix(at,brush,.006,.16 if offset in (.5,2.5) else -.16)

    t=np.arange(count)/rate
    fade=np.clip(t/.70,0,1)*np.clip((length-t)/1.10,0,1)
    bed*= (fade*(1+.29*np.clip((t-card_time)/.8,0,1)))[:,None]
    # One quiet soft tap, timed to the products-liability banner.
    fx=np.arange(round(.13*rate))/rate
    tap=np.sin(2*np.pi*(175*fx-190*fx*fx))*np.minimum(fx/.013,1)*np.exp(-fx*32)
    mix(11.74,tap,.010 if effects else .007)
    if effects:
        mix(5.46,tap,.013)
        mix(card_time,tap,.010)
    with wave.open('bed.wav','wb') as target:
        target.setparams((2,2,rate,0,'NONE','not compressed'))
        target.writeframes(np.rint(np.clip(bed,-1,1)*32767).astype('<i2').tobytes())
