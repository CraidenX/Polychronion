# Вырезка мягких объектов (бугры): размешивание с пурпуром по синему каналу
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
D=sys.argv[1]
a=np.asarray(Image.open(D+'/sheet.png' if os.path.exists(D+'/sheet.png') else D+'/sheet.webp').convert('RGB')).astype(np.float32)
M=np.array([255,0,255],np.float32)
core=(a[...,2]<120)&(a[...,1]>80)
fb=np.median(a[...,2][core])
al=np.clip((255-a[...,2])/(255-fb),0,1)
al=np.clip((al-0.05)/0.95,0,1)
F=(a-(1-al[...,None])*M)/np.maximum(al[...,None],1e-3)
F=np.clip(F,0,255)
# у самого края цвет берём от ближайшего уверенного пикселя
sure=al>0.6; _,(iy,ix)=nd.distance_transform_edt(~sure,return_indices=True)
w=np.clip(al/0.6,0,1)[...,None]; F=F*w+F[iy,ix]*(1-w)
lab,n=nd.label(nd.binary_dilation(al>0.3,iterations=6)); sz=nd.sum(al>0.3,lab,range(1,n+1))
keep=[i for i in np.argsort(sz)[::-1] if sz[i]>0.2*sz.max()]; objs=nd.find_objects(lab)
for f in [f for f in os.listdir(D) if f.startswith('peak_')]: os.remove(D+'/'+f)
for k,i in enumerate(sorted(keep,key=lambda i:(objs[i][0].start//200,objs[i][1].start))):
    sl=objs[i]; mm=(lab[sl]==i+1)*al[sl]
    Image.fromarray(np.dstack([F[sl],mm*255]).astype(np.uint8),'RGBA').save(f'{D}/peak_{k}.png')
print(D,len(keep),'fb',fb)
