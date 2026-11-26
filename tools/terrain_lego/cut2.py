# Вырезка с пурпурного фона с мягкими краями и тенями (тень на пурпуре считается фоном)
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
D=sys.argv[1]; MIN=float(sys.argv[2]) if len(sys.argv)>2 else 0.2
a=np.asarray(Image.open(D+'/sheet.png' if os.path.exists(D+'/sheet.png') else D+'/sheet.webp').convert('RGB')).astype(np.float32)
r,g,b=a[...,0],a[...,1],a[...,2]
# «пурпурность» с учётом яркости: доля пурпура в пикселе
m=np.clip(((r+b)/2-g)/np.maximum((r+b)/2,1),0,1)          # 1 у чистого пурпура и у тени на пурпуре
m=np.clip((m-0.35)/0.45,0,1)
alpha=1-m
spill=np.clip((r+b)/2-g,0,None)*m
a2=a.copy(); a2[...,0]-=spill; a2[...,2]-=spill; a2[...,1]+=spill*0.15
solid=nd.binary_opening(alpha>0.5,iterations=1)
lab,n=nd.label(nd.binary_dilation(solid,iterations=4)); sz=nd.sum(solid,lab,range(1,n+1))
keep=[i for i in np.argsort(sz)[::-1] if sz[i]>MIN*sz.max()]
objs=nd.find_objects(lab)
for f in [f for f in os.listdir(D) if f.startswith('peak_')]: os.remove(D+'/'+f)
for k,i in enumerate(sorted(keep,key=lambda i:(objs[i][0].start//200,objs[i][1].start))):
    sl=objs[i]; mm=(lab[sl]==i+1)*alpha[sl]
    Image.fromarray(np.dstack([np.clip(a2[sl],0,255),np.clip(mm*255,0,255)]).astype(np.uint8),'RGBA').save(f'{D}/peak_{k}.png')
print(D,len(keep))
