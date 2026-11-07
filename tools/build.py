import json,sys
SP=__import__('os').path.dirname(__import__('os').path.abspath(__file__))+'/'
mi=json.load(open(SP+(sys.argv[2] if len(sys.argv)>2 else 'mapinfo.json')))
mi.setdefault('ids',[r[0] for r in json.load(open(SP+'regions.json'))])
mi.pop('adj',None)
js=''.join(open(SP+'src/'+f).read() for f in ['2_data.js','3_core.js','4_events.js','5_battle.js','6_ui.js'])
js=js.replace('/*MAPINFO*/null',json.dumps(mi,ensure_ascii=False,separators=(',',':')))
if len(sys.argv)>3: js=js.replace('/*GEN*/null',open(SP+sys.argv[3]).read())
import os
roads=open(SP+'../roads.js').read() if os.path.exists(SP+'../roads.js') else ''
open(SP+'game.js','w').write(roads.replace('const ROADS','var ROADS')+js)   # для безголовых прогонов — с дорогами
html=open(SP+'src/1_head.html').read()+js+'\n</script>\n</body>\n</html>\n'
open(sys.argv[1],'w').write(html)
print(len(html))
