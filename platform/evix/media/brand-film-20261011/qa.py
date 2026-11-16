"""Extract actual encoded frames for visual review; never certify aesthetics."""
import argparse, json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from finish import OUT, executable

TIMES=[3,8,18,29,39.2,46,52,61,69,76,86,95,103,110,115,121,129,138,146,154,162,170,178,186,194,201,208,215,222,228,234]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--file',default='未见之光-证见EVI-X-1080p.mp4');args=ap.parse_args()
    if Path(args.file).name!=args.file:raise ValueError('Filename only')
    frames=OUT/'encoded-frames';frames.mkdir(exist_ok=True)
    filt='select='+ '+'.join(f'eq(n\\,{round(t*24)})' for t in TIMES)
    subprocess.run([executable('ffmpeg'),'-y','-v','error','-i',str(OUT/args.file),'-vf',filt,'-fps_mode','vfr',str(frames/'shot-%02d.png')],check=True)
    files=sorted(frames.glob('shot-*.png'));assert len(files)==len(TIMES)
    sheet=Image.new('RGB',(1600,8*251),'#080e18');d=ImageDraw.Draw(sheet)
    font_path=Path('C:/Windows/Fonts/arial.ttf')
    font=ImageFont.truetype(str(font_path),17) if font_path.exists() else ImageFont.load_default()
    for i,(p,t) in enumerate(zip(files,TIMES)):
        im=Image.open(p).convert('RGB');im.thumbnail((400,225));x=(i%4)*400;y=(i//4)*251
        sheet.paste(im,(x,y));d.text((x+10,y+227),f'{i+1:02d} / {t:.1f}s',fill='#d3e0e6',font=font)
    sheet.save(OUT/'成片分镜总览.jpg',quality=94)
    subprocess.run([executable('ffmpeg'),'-y','-v','error','-ss','222','-i',str(OUT/args.file),'-frames:v','1',str(OUT/'poster.jpg')],check=True)
    (OUT/'encoded-frames.json').write_text(json.dumps({'source':args.file,'times':TIMES,'frames':[str(p.relative_to(OUT)) for p in files]},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Extracted {len(files)} actual encoded frames and poster.')

if __name__=='__main__':main()
