"""Mux a browser-rendered deterministic H.264 film with an original synthesized score."""
import argparse, hashlib, json, os, shutil, subprocess, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'outputs/evix-brand-film-20261011'
def executable(name):
    override=os.environ.get(name.upper())
    if override:return override
    found=shutil.which(name)
    if found:
        p=Path(found)
        try:return str(p.resolve(strict=True))
        except OSError:pass
    candidates=list((Path.home()/'AppData/Local/Microsoft/WinGet/Packages').glob(f'Gyan.FFmpeg*/ffmpeg*/bin/{name}.exe'))
    if candidates:return str(candidates[-1])
    raise RuntimeError(f'{name} executable unavailable')

def run(args,log):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace')
    log.write_text(p.stdout+'\n'+p.stderr,encoding='utf-8')
    if p.returncode:raise RuntimeError(f'Command failed ({p.returncode}), see {log}')
    return p

def main():
    ap=argparse.ArgumentParser();ap.add_argument('render_id');ap.add_argument('--name',default='未见之光-证见EVI-X-1080p.mp4');args=ap.parse_args()
    if Path(args.render_id).name!=args.render_id or Path(args.name).name!=args.name:raise ValueError('Names only')
    render=OUT/'renders'/args.render_id
    receipt=json.loads((render/'complete.json').read_text(encoding='utf-8'))
    if receipt['encodedFrames']!=round(receipt['duration']*24) or receipt['errors']:raise ValueError('Invalid frame receipt or render errors')
    ff=executable('ffmpeg');fp=executable('ffprobe')
    score=OUT/'score.wav';dst=OUT/args.name
    source=json.loads((render/'render.json').read_text(encoding='utf-8'))
    start=receipt['start'];duration=receipt['duration']
    print('Measuring score loudness',flush=True)
    p=run([ff,'-hide_banner','-ss',str(start),'-t',str(duration),'-i',str(score),'-af','loudnorm=I=-16:TP=-1.5:LRA=13:print_format=json','-f','null','-'],render/'loudness-input.log')
    s=p.stderr;measure=json.loads(s[s.rfind('{'):s.rfind('}')+1])
    norm=f"loudnorm=I=-16:TP=-1.5:LRA=13:measured_I={measure['input_i']}:measured_TP={measure['input_tp']}:measured_LRA={measure['input_lra']}:measured_thresh={measure['input_thresh']}:offset={measure['target_offset']}:linear=true"
    print('Encoding master MP4',flush=True)
    run([ff,'-y','-hide_banner','-r','24','-i',str(render/'video.h264'),'-ss',str(start),'-t',str(duration),'-i',str(score),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r','24','-af',norm+',aresample=48000','-c:a','aac','-b:a','256k','-t',str(duration),'-movflags','+faststart','-metadata','title=未见之光 | THE UNSEEN LIGHT','-metadata','artist=证见 EVI-X','-metadata','comment=Original procedural imagery and synthesized score; AI-assisted code production. Conceptual brand film.',str(dst)],render/'encode.log')
    probe=run([fp,'-v','error','-show_streams','-show_format','-of','json',str(dst)],render/'ffprobe.json')
    data=json.loads(probe.stdout);v=next(s for s in data['streams'] if s['codec_type']=='video');a=next(s for s in data['streams'] if s['codec_type']=='audio')
    assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'24/1')
    assert int(v['nb_frames'])==receipt['encodedFrames']
    assert abs(float(data['format']['duration'])-duration)<.1
    assert a['sample_rate']=='48000' and a['channels']==2
    print('Decoding full output for errors',flush=True)
    run([ff,'-v','error','-i',str(dst),'-f','null','-'],render/'decode.log')
    print('Measuring delivered audio and checking black/frozen intervals',flush=True)
    quality=run([ff,'-hide_banner','-i',str(dst),'-vf','blackdetect=d=0.3:pix_th=0.02:pic_th=0.98,freezedetect=n=-50dB:d=3','-af','loudnorm=I=-16:TP=-1.5:LRA=13:print_format=json','-f','null','-'],render/'quality.log')
    q=quality.stderr;delivered=json.loads(q[q.rfind('{'):q.rfind('}')+1])
    report={'file':dst.name,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest(),'bytes':dst.stat().st_size,'duration':float(data['format']['duration']),'frames':int(v['nb_frames']),'width':v['width'],'height':v['height'],'fps':24,'audio_sample_rate':48000,'audio_channels':2,'decode_exit':0,'render_receipt':receipt,'source':source,'loudness_input':measure,'loudness_delivered':delivered,'quality_events':[line for line in q.splitlines() if 'black_start:' in line or 'freeze_' in line], 'limitations':['This is a conceptual brand film, not footage of a field study.','A complete human watch-and-listen and target festival eligibility review remain before submission.']}
    (OUT/(dst.stem+'-验收.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k]for k in ['file','duration','frames','bytes','sha256']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
