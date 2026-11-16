from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from concurrent.futures import ThreadPoolExecutor
import math, struct, subprocess, wave, os, json, sys

spec=json.loads(Path(sys.argv[1]).read_text())
base_source=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else None
root=Path(sys.argv[1]).resolve().parent
os.chdir(root)
settings=spec["settings"]
modern=spec.get("captionStyle")=="reference-modern-v7"
kinetic=modern or spec.get("captionStyle")=="reference-kinetic-v6"
corporate_mix=kinetic or spec.get("mixStyle")=="corporate-v5" or spec.get("captionStyle")=="reference-still-v5"
photo_captions=kinetic or spec.get("captionStyle") in ("reference-still","reference-still-v5")
short_captions=photo_captions or spec.get("captionStyle")=="reference-phrases"
full_overlay=photo_captions or settings.get("bannerAbove")
FPS=30
W,H=720,1280
render_w,render_h=(1080,1920) if photo_captions or spec.get("delivery")=="Vertical" else (W,H)
speech_end=884
close_at=speech_end if settings.get("cleanEnding") else 895
end_frame=close_at+138
portrait=spec["sources"]["portrait"]
office=spec["sources"]["office"]
meeting=spec["sources"]["meeting"]
desk=spec["sources"]["desk"]
end_card=spec["sources"]["end_card"]
def video(*args):
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",*map(str,args)],check=True)

fit=f"scale={render_w}:{render_h}:flags=lanczos,setsar=1"
jay="crop=1214:2160:1282:0,"+fit
tight="crop=1152:2048:1312:56,"+fit
push=jay+f",zoompan=z='1+0.055*(1-cos(PI*min(on/49,1)))/2':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={render_w}x{render_h}:fps=30"
firm=f"[0:v]fps=30,split=2[bg][fg];[bg]crop=1214:2160:1500:0,scale=180:320,boxblur=13:2,scale={render_w}:{render_h},eq=brightness=-0.19:saturation=0.66[base];[fg]crop=2800:2080:1040:40,scale={render_w}:-2[v];[base][v]overlay=0:{round(335*render_h/H)},setsar=1"
if settings["officeFullScreen"]:
    firm="crop=1214:2160:x='max(1300,1890-170*t)':y=0,"+fit if short_captions else "crop=1214:2160:x=1850:y=0,"+fit
office_end=settings.get("officeEndFrame",251)
mentoring_start=settings.get("mentoringStartFrame",739)
mentoring_end=settings.get("mentoringEndFrame",833)
segments=[
 (0,164,portrait,0,jay),
 (164,office_end,office,1.93,firm),
 (office_end,435,portrait,office_end/30,jay),
 (435,537,portrait,435/30,push),
 (537,606,portrait,537/30,tight),
 (606,652,desk,0.44,fit),
 (652,mentoring_start,portrait,652/30,tight),
 (mentoring_start,mentoring_end,meeting,22.20,"crop=1214:2160:1120:0,"+fit),
 (mentoring_end,speech_end,portrait,mentoring_end/30,tight),
 (speech_end,close_at,portrait,883/30,tight+",tpad=stop_mode=clone:stop_duration=1"),
 (close_at,end_frame,end_card,1.63,fit),
]
segments=[item for item in segments if item[1]>item[0]]
def cut(entry):
    index,(start,end,source,inpoint,filters)=entry
    output=f"segment-{index:02}.mp4"
    if source==office and not settings["officeFullScreen"]:
        args=["-filter_complex_threads","1","-filter_complex",filters]
    else:
        prepared=("" if source==portrait and "zoompan" in filters else "fps=30,")+filters
        args=["-filter_threads","1","-vf",prepared]
    video("-ss",inpoint,"-i",source,*args,"-an","-frames:v",end-start,"-c:v","libx264","-preset","ultrafast","-threads","2","-crf","15","-pix_fmt","yuv420p","-r",30,output)
    metadata=json.loads(subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_entries","stream=nb_frames","-of","json",output]))
    n=int(metadata["streams"][0]["nb_frames"])
    if n!=end-start: raise RuntimeError(f"{output}: {n} frames instead of {end-start}")
    return output
if base_source is None:
    with ThreadPoolExecutor(max_workers=2) as pool:
        files=list(pool.map(cut,enumerate(segments)))
    Path("segments.txt").write_text("".join(f"file '{file}'\n" for file in files))
    video("-f","concat","-safe",0,"-i","segments.txt","-c:v","copy","base.mp4")
    base_source=Path("base.mp4")

cues=[
 (0,1.83,"Hi, my name is Jay Dankner."),
 (1.83,3.38,"I am admitted to practice law"),
 (3.38,4.74,"in both New York and Florida,"),
 (4.74,6.49,"and I am currently Of Counsel"),
 (6.49,8.86,"to the firm of\nGersowitz, Libo & Korek."),
 (8.86,10.35,"My subspecialty within"),
 (10.35,12.23,"the area of personal injury\nlitigation is"),
 (12.23,13.72,"products liability law."),
 (13.72,15.48,"And I’ve been doing that\nfor almost"),
 (15.48,16.60,"50 years now,"),
 (16.60,17.73,"believe it or not."),
 (17.73,19.08,"The status of Of Counsel"),
 (19.08,20.15,"is a senior status,"),
 (20.15,21.30,"which means that you"),
 (21.30,23.04,"can basically handle\nthose cases"),
 (23.04,24.60,"that you desire,"),
 (24.60,27.24,"and that you can mentor,\nassist, and help"),
 (27.24,29.47,"all the other attorneys\nin the office."),
]
if short_captions:
    cues=[
      (0,0.89,"Hi, my name is"),
      (0.89,1.83,"*Jay Dankner.*"),
      (1.83,3.40,"I am admitted to practice law"),
      (3.40,4.74,"in both *New York* and *Florida,*"),
      (4.74,6.49,"and I am currently *Of Counsel*"),
      (6.49,7.10,"to the firm of"),
      (7.10,8.86,"Gersowitz, Libo & Korek."),
      (8.86,10.35,"My subspecialty within"),
      (10.35,11.43,"the area of personal"),
      (11.43,12.23,"injury litigation is"),
      (12.23,13.72,"*products liability* law."),
      (13.72,14.60,"And I’ve been doing that"),
      (14.60,15.48,"for almost"),
      (15.48,16.60,"*50 years* now,"),
      (16.60,17.73,"believe it or not."),
      (17.73,19.08,"The status of *Of Counsel*"),
      (19.08,20.15,"is a senior status,"),
      (20.15,21.30,"which means that you"),
      (21.30,22.42,"can basically handle"),
      (22.42,23.62,"those cases that you"),
      (23.62,24.60,"desire,"),
      (24.60,26.01,"and that you can *mentor,*"),
      (26.01,27.24,"assist, and help"),
      (27.24,28.76,"all the other attorneys"),
      (28.76,29.47,"in the office."),
    ]
fonts=Path(os.environ.get("KAT_FONT_DIR", str(Path.home()/"Library/Fonts")))
def font_path(filename):
    for folder in (fonts, Path.home()/"Library/Fonts", Path(__file__).resolve().parent/"fonts"):
        candidate=folder/filename
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Missing {filename}. Set KAT_FONT_DIR to the directory containing the Studio fonts.")

font=lambda name,size: ImageFont.truetype(str(font_path(f"Poppins-{name}.ttf")),size)
caption=font("Regular" if short_captions and not photo_captions else "Bold",settings["captionSize"])
if short_captions:
    italic=ImageFont.truetype(str(font_path("PlayfairDisplay-Italic.ttf")),settings["captionSize"]+5)
name=font("Bold",31)
role=font("Regular",22)
callout=font("Bold",23)
gold="#c19733"
navy=(42,54,67,241)
folder=Path("overlays");folder.mkdir(exist_ok=True)
leak=Image.new("RGBA",(W,H))
if photo_captions:
    gradients=Image.new("L",(180,320))
    gradients.putdata([round((103 if kinetic else 41)*math.exp(-((x+9)/(57 if kinetic else 43))**2-((y-49)/91)**2)) for y in range(320) for x in range(180)])
    leak=Image.new("RGBA",(W,H),(252,168,90,0))
    leak.putalpha(gradients.resize((W,H),Image.Resampling.BICUBIC))
if kinetic:
    from importlib.util import module_from_spec, spec_from_file_location
    caption_spec=spec_from_file_location("glk_captions",Path(__file__).resolve().parent/"glk-captions.py")
    kinetic_module=module_from_spec(caption_spec)
    caption_spec.loader.exec_module(kinetic_module)
    word_times=json.loads((Path(__file__).resolve().parent/"glk-word-timing.json").read_text())
    kinetic_state,paint_kinetic=kinetic_module.build_painter(word_times,font,italic,Image,ImageDraw,ImageFilter,modern=modern,modern_size=settings["captionSize"])
def graphic(key, words, lower, label, caption_opacity, leak_level):
    file=folder/f"{key:03}.png"
    image=Image.new("RGBA",(W,H if full_overlay else 408))
    yoffset=752 if full_overlay else 0
    if leak_level:
        overlay=leak.copy()
        overlay.putalpha(leak.getchannel("A").point(lambda alpha:round(alpha*leak_level)))
        image.alpha_composite(overlay)
    d=ImageDraw.Draw(image)
    if lower:
        y=yoffset+settings.get("lowerThirdYOffset",0)+round((1-lower)*18)
        layer=Image.new("RGBA",image.size)
        g=ImageDraw.Draw(layer)
        g.rounded_rectangle((49,3+y,405,103+y),radius=10,fill=navy)
        g.rounded_rectangle((49,3+y,55,103+y),radius=3,fill=gold)
        g.text((70,14+y),"JAY W. DANKNER",font=name,fill="white")
        g.text((70,60+y),"Of Counsel  |  GLK",font=role,fill="#ead299")
        if lower<1:
            layer.putalpha(layer.getchannel("A").point(lambda alpha:round(alpha*lower)))
        image.alpha_composite(layer)
    if label:
        above=settings.get("bannerAbove",False)
        alpha=round(label*252) if above else 241
        y=(220+round((1-label)*10)) if above else 46+yoffset
        box=Image.new("RGBA",image.size)
        b=ImageDraw.Draw(box)
        b.rounded_rectangle((115,y,605,y+58),radius=10,fill=(42,54,67,alpha))
        b.line((130,y+6,130,y+51),fill=(193,151,51,alpha),width=4)
        b.text((360,y+29),"Cases involving defective products",font=callout,anchor="mm",fill=(255,255,255,alpha))
        image.alpha_composite(box)
        d=ImageDraw.Draw(image)
    if words and not short_captions:
        d.multiline_text((360,yoffset+227),words,font=caption,spacing=3,anchor="ma",align="center",fill="white",stroke_width=3,stroke_fill="#111821")
    if words and kinetic:
        paint_kinetic(image,words)
    if words and short_captions and not kinetic:
        layer=Image.new("RGBA",image.size)
        c=ImageDraw.Draw(layer)
        parts=[(part,bool(i%2) and not photo_captions) for i,part in enumerate(words.split("*")) if part]
        regular_face, emphasis_face=caption,italic
        def measure():
            chunks=[(part,emphasis_face if emphasis else regular_face, "#f5d477" if emphasis else "#ffffff")
                    for part,emphasis in parts]
            return chunks,[face.getlength(part) for part,face,_ in chunks]
        chunks,widths=measure()
        while sum(widths)>612:
            regular_face=regular_face.font_variant(size=regular_face.size-1)
            emphasis_face=emphasis_face.font_variant(size=emphasis_face.size-1)
            chunks,widths=measure()
        x=(W-sum(widths))/2
        # During the name card, leave space between the card and spoken captions.
        baseline=174 if words in {cue[2] for cue in cues if cue[0]<4.74} else 105
        if label: baseline=155
        if settings.get("stableCaptions"): baseline=307
        baseline+=yoffset+round(4*(1-caption_opacity))
        if photo_captions: baseline=803
        for (part,face,color),width in zip(chunks,widths):
            c.text((x,baseline+3),part,font=face,anchor="ls",fill=(12,17,24,190),stroke_width=2,stroke_fill=(12,17,24,160))
            x+=width
        if photo_captions: layer=layer.filter(ImageFilter.GaussianBlur(1.2))
        c=ImageDraw.Draw(layer)
        x=(W-sum(widths))/2
        for (part,face,color),width in zip(chunks,widths):
            c.text((x,baseline),part,font=face,anchor="ls",fill=color,stroke_width=0 if photo_captions else 1,stroke_fill=color)
            x+=width
        if caption_opacity<1:
            layer.putalpha(layer.getchannel("A").point(lambda alpha:round(alpha*caption_opacity)))
        image.alpha_composite(layer)
    image.save(file)
    return file
patterns={}
for frame in range(end_frame):
    t=frame/FPS
    cue=next(((a,line) for a,b,line in cues if a<=t<b),None) if frame<close_at else None
    words=(kinetic_state(frame) if frame<close_at else None) if kinetic else (cue[1] if cue else None)
    opacity=1.0
    if short_captions and cue and cue[0]>0 and not settings.get("stableCaptions"):
        q=max(0,min(1,(t-cue[0])/.11))
        opacity=round(1-(1-q)**3,3)
    lower=1.0 if t<4.77 else 0.0
    if lower and settings["animateLowerThird"]:
        x=max(0,min(1,t/.42,(4.77-t)/.28))
        lower=round(x*x*(3-2*x),3)
    label=1.0 if 11.68<=t<14.48 and settings["showCallout"] else 0.0
    if label and settings.get("bannerAbove"):
        u=max(0,min(1,(t-11.68)/.34,(14.48-t)/.29))
        label=round(u*u*(3-2*u),3)
    leak_level=0.0
    if photo_captions and frame<close_at:
        for cut_frame in ((164,mentoring_start) if kinetic or not corporate_mix else (164,)):
            u=(frame-cut_frame+(4 if kinetic else 2))/(14 if kinetic else 10)
            if 0<u<1: leak_level=round(math.sin(math.pi*u)**2*(.82 if kinetic else .55 if corporate_mix else 1),3)
    key=(words,lower,label,opacity,leak_level)
    if key not in patterns: patterns[key]=graphic(len(patterns),*key)
    dest=folder/f"frame-{frame:04}.png"
    dest.unlink(missing_ok=True)
    os.link(patterns[key],dest)

# Original low-level instrumental sketch with a soft bass pulse and brushed ticks.
rate=48000
length=end_frame/FPS
if corporate_mix:
    from importlib.util import module_from_spec, spec_from_file_location
    score_spec=spec_from_file_location("glk_score", Path(__file__).resolve().parent/"glk-score.py")
    score=module_from_spec(score_spec)
    score_spec.loader.exec_module(score)
    score.corporate_bed(length,close_at/FPS,rate,effects=kinetic)
else:
    samples=bytearray()
    chords=[(130.81,164.81,196),(110,130.81,164.81),(87.31,130.81,174.61),(98,146.83,196)]
    for i in range(round(rate*length)):
        t=i/rate
        chord=chords[int(t/4)%4]
        cross=min(1,(t%4)/.32)
        prev=chords[(int(t/4)-1)%4]
        pad=lambda tones:sum(math.sin(2*math.pi*f*t)*(.67 if j==0 else .31) for j,f in enumerate(tones))
        harmonic=.011*(cross*pad(chord)+(1-cross)*pad(prev))
        pulse=.010*math.sin(2*math.pi*chord[0]*.5*t)*math.exp(-(t%.66)*16)
        tick=.002*math.sin(2*math.pi*1120*t)*math.sin(2*math.pi*773*t)*math.exp(-((t+.32)%.66)*75)
        env=min(1,t/.55,max(0,(length-t)/.65))*(1+1.0*min(1,max(0,(t-close_at/FPS)/.75)))
        if settings.get("warmMusic"):
            beat=.75
            pos=t%beat
            phase=int(t/beat)%4
            f=chord[(0,1,2,1)[phase]]*2
            pluck=.010*(math.sin(2*math.pi*f*pos)+.22*math.sin(4*math.pi*f*pos))*min(1,pos/.012)*math.exp(-pos*5.4)
            bass=.011*math.sin(2*math.pi*chord[0]*.5*t)*min(1,pos/.015)*math.exp(-pos*9)
            brush_pos=(t+beat/2)%beat
            brush=.003*math.sin(2*math.pi*1643*t)*math.sin(2*math.pi*2231*t)*min(1,brush_pos/.008)*math.exp(-brush_pos*56)
            harmonic=.40*harmonic+pluck+bass+brush
            pulse=tick=0
        sfx=0.0
        if photo_captions:
            for trigger, level in ((.11,.010),(11.74,.009),(close_at/FPS,.010)):
                a=t-trigger
                if 0<=a<.15:
                    sfx+=level*math.sin(2*math.pi*(168*a-136*a*a))*min(1,a/.009)*math.exp(-a*32)
        samples+=struct.pack("<h",round(32767*(env*(harmonic+pulse+tick)+sfx)))
    with wave.open("bed.wav","wb") as bed:
        bed.setparams((1,2,rate,0,"NONE","not compressed"))
        bed.writeframes(samples)
overlay_y=0 if full_overlay else round(752*render_h/H)
video_mix=f"[0:v][1:v]overlay=0:{overlay_y}:format=auto[v];"
if (render_w,render_h)!=(W,H):
    video_mix=f"[1:v]format=rgba,scale={render_w}:-2:flags=lanczos[g];[0:v][g]overlay=0:{overlay_y}:format=auto[v];"
filtergraph=(video_mix+
    "[2:a]aresample=48000,volume=-3dB,afade=t=in:d=0.024,"
    "afade=t=out:st=29.39:d=0.076,apad=whole_dur=34.43334[voice];"
    "[voice][3:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.90:level=0[a]")
if corporate_mix:
    filtergraph=(video_mix+
        f"[2:a]aresample=48000,highpass=f=70,volume=-3dB,afade=t=in:d=0.024,"
        f"afade=t=out:st=29.39:d=0.076,apad=whole_dur={length:.7f},asplit=2[voice][key];"
        f"[3:a]volume={15 if kinetic else 6}dB[score];[score][key]sidechaincompress=threshold=0.025:ratio=1.5:attack=55:release=500[bed];"
        "[voice][bed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=0[a]")
video("-i",base_source,"-framerate",FPS,"-i","overlays/frame-%04d.png","-i",portrait,"-i","bed.wav",
      "-filter_complex_threads",2,"-filter_complex",filtergraph,"-map","[v]","-map","[a]",
      "-c:v","libx264","-threads",4,"-preset","fast","-crf",17 if photo_captions else 20,"-pix_fmt","yuv420p",
      "-color_primaries","bt709","-colorspace","bt709","-color_trc","bt709",
      "-c:a","aac","-b:a","160k","-movflags","+faststart","-t",length,
      "revision.mp4")
Path("edit.json").write_text(json.dumps({"fps":FPS,"segments":segments,"captions":cues},indent=2))
