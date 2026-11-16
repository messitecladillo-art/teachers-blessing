"""Create a lighter 1080p H.264 derivative without changing the mastered audio."""
import hashlib,json,subprocess
from finish import OUT,executable,run

def main():
    src=OUT/'未见之光-证见EVI-X-1080p.mp4'
    dst=OUT/'未见之光-证见EVI-X-网页播放版.mp4'
    ff=executable('ffmpeg');fp=executable('ffprobe')
    run([ff,'-y','-hide_banner','-i',str(src),'-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','medium','-crf','21','-maxrate','5000k','-bufsize','10000k','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(dst)],OUT/'web-encode.log')
    p=run([fp,'-v','error','-show_streams','-show_format','-of','json',str(dst)],OUT/'web-ffprobe.json');data=json.loads(p.stdout)
    v=next(s for s in data['streams'] if s['codec_type']=='video');a=next(s for s in data['streams'] if s['codec_type']=='audio')
    assert (v['width'],v['height'],v['r_frame_rate'],int(v['nb_frames']))==(1920,1080,'24/1',5760)
    assert abs(float(data['format']['duration'])-240)<.1
    assert a['sample_rate']=='48000' and a['channels']==2
    run([ff,'-v','error','-i',str(dst),'-f','null','-'],OUT/'web-decode.log')
    audio_hashes=[]
    for path in [src,dst]:
        r=subprocess.run([ff,'-v','error','-i',str(path),'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-'],capture_output=True,check=True,text=True)
        audio_hashes.append(r.stdout.strip())
    assert audio_hashes[0]==audio_hashes[1]
    report={'file':dst.name,'source':src.name,'duration':240,'frames':5760,'width':1920,'height':1080,'fps':24,'bytes':dst.stat().st_size,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest(),'audio_unchanged':True,'audio_hash':audio_hashes[0],'full_decode_exit':0}
    (OUT/'网页播放版-验收.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
