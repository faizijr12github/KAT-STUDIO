"""Word-timed caption layouts for the GLK Introduction."""
from functools import lru_cache


def caption_groups(words):
    limits = [
        (0,4),(4,6),(6,9),(9,12),(12,14),(14,18),(18,22),(22,24),
        (24,28),(28,32),(32,35),(35,38),(38,42),(42,45),(45,50),(50,52),
        (52,55),(55,59),(59,62),(62,64),(64,68),(68,72),(72,75),(75,80),
        (80,85),(85,88),(88,92),(92,95),
    ]
    emphasis = {
        4:(4,6,False), 14:(14,16,False), 22:(22,24,True), 32:(33,34,False),
        42:(42,44,True), 52:(52,54,True), 62:(62,64,False),
        80:(84,85,True), 88:(91,92,False),
    }
    return [(words[a][1], words[b][1] if b<len(words) else 29.4667, a,b,emphasis.get(a)) for a,b in limits]


def build_painter(words, fonts, italic, Image, ImageDraw, ImageFilter, modern=False, modern_size=46):
    groups=caption_groups(words)
    @lru_cache(maxsize=None)
    def regular(size):
        return fonts("Bold",size)
    @lru_cache(maxsize=None)
    def serif(size):
        return italic.font_variant(size=size)
    @lru_cache(maxsize=None)
    def layout(group_index):
        _,_,a,b,accent=groups[group_index]
        if modern:
            size=modern_size
            face=regular(size)
            phrase=lambda start,end:" ".join(w[0] for w in words[start:end])
            if face.getlength(phrase(a,b))<=612:
                rows=[(a,b,size,747,False,False)]
            else:
                pivot=min(range(a+1,b),key=lambda k:max(face.getlength(phrase(a,k)),face.getlength(phrase(k,b))))
                rows=[(a,pivot,size,747,False,False),(pivot,b,size,802,False,False)]
        elif accent:
            first,last,gold=accent
            rows=[(a,first,33,755,False,False),(first,last,54,808,True,gold),(last,b,31,839,False,False)]
        else:
            rows=[(a,b,41,803,False,False)]
        placed=[]
        for start,end,size,y,featured,gold in rows:
            if start==end:continue
            face=(serif if featured else regular)(size)
            while face.getlength(" ".join(w[0] for w in words[start:end]))>605:
                size-=1
                face=(serif if featured else regular)(size)
            phrase=" ".join(w[0] for w in words[start:end])
            x=(720-face.getlength(phrase))/2
            for j in range(start,end):
                prefix=" ".join(w[0] for w in words[start:j])
                if prefix:prefix+=" "
                highlighted=gold
                if modern and accent:
                    first,last,use_gold=accent
                    highlighted=use_gold and first<=j<last
                placed.append((j,words[j][0],face,x+face.getlength(prefix),y,highlighted))
        return placed
    def state(frame):
        t=frame/30
        for i,(start,end,a,b,_) in enumerate(groups):
            if start<=t<end:
                seen=[(j, min(4 if modern else 3,max(1,1+int((t-words[j][1])*30+.0001)))) for j in range(a,b) if t+.0001>=words[j][1]]
                return i,tuple(seen)
        return None
    def paint(image, state_key):
        i,visible=state_key
        opacity=dict(visible)
        placed=layout(i)
        shadow=Image.new("RGBA",image.size)
        d=ImageDraw.Draw(shadow)
        for j,word,face,x,y,gold in placed:
            if j in opacity:
                step=opacity[j]
                d.text((x,y+3),word,font=face,anchor="ls",fill=(13,17,22,step*(45 if modern else 57)),stroke_width=2,stroke_fill=(13,17,22,step*(38 if modern else 49)))
        image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(1.6)))
        layer=Image.new("RGBA",image.size)
        d=ImageDraw.Draw(layer)
        for j,word,face,x,y,gold in placed:
            if j not in opacity:continue
            step=opacity[j]
            color=(246,217,130) if gold else (255,255,255)
            alpha=((140,201,240,255) if modern else (160,227,255))[step-1]
            d.text((x,y if modern else y+(3-step)),word,font=face,anchor="ls",fill=(*color,alpha))
        image.alpha_composite(layer)
    return state,paint
