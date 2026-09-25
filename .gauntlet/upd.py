import json, re, sys
p='/home/user/Playmythicspellbook/.gauntlet/progress.html'
s=open(p,encoding='utf-8').read()
m=re.search(r'<script id="run-data" type="application/json">(.*?)</script>', s, re.S)
d=json.loads(m.group(1))
patch=json.load(sys.stdin)
for k,v in patch.items():
    if k=='addLog': d['log'].extend(v)
    elif k=='pieces':
        for name,upd in v.items():
            for pc in d['pieces']:
                if pc['name']==name:
                    rounds=upd.pop('rounds',None)
                    pc.update(upd)
                    if rounds is not None:
                        pc.setdefault('rounds',[])
                        for r in rounds:
                            ex=[x for x in pc['rounds'] if x['n']==r['n']]
                            if ex: ex[0].update(r)
                            else: pc['rounds'].append(r)
    else: d[k]=v
new='<script id="run-data" type="application/json">\n'+json.dumps(d,indent=2)+'\n</script>'
s=s[:m.start()]+new+s[m.end():]
open(p,'w',encoding='utf-8').write(s)
print('updated')
