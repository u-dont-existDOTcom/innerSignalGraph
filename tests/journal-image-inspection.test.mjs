import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySourceImageInspection} from '../src/journal-import/source-image-inspection.mjs';
const attachedFiles={'synthetic.png':'synthetic-digest'};
const source="from PIL import Image\nim = Image.open('/mnt/data/synthetic.png').convert('RGB')\nim.size";
const verify=(codes,statuses)=>verifySourceImageInspection({codes,statuses,attachedFiles});
test('in-memory background comparison is allowed but cannot read or write another image',async()=>{
 const result=await verify([source,"from PIL import Image, ImageChops\nbg = Image.new('RGB', im.size, (255,255,255))\ndiff = ImageChops.difference(im,bg)\ndiff.getbbox()"]);
 assert.equal(result.verified,true);
 assert.ok(result.operations.includes('pixel_bounds'));
 for(const code of ["from PIL import ImageChops\nImageChops.difference(im,other)","Image.new('RGB',(10,10),'/etc/passwd')","from PIL import ImageFile","from PIL import ImageChops\nImageChops.difference(im,im).save('/tmp/out.png')"])
  assert.equal((await verify([source,code])).verified,false,code);
});
test('finite coordinate generators allow arithmetic while denying outside access and unbounded work',async()=>{
 const coordinates="xs = 0.5\nys = 0.4\nboxes = {'body': (10,20,30,40)}\n{k: tuple(round(v[i]*(xs if i%2==0 else ys),1) for i in range(4)) for k,v in boxes.items()}";
 const computedIndex="scale = 0.5\nboxes = {'body': (10,20,30,40)}\n{k: tuple(round(v[round(i/2)]*scale,1) for i in range(4)) for k,v in boxes.items()}";
 const nullableNumeric="for value in (1,0):\n    print(round(value/2,1) if value>0 else None)";
 assert.equal((await verify([source,coordinates])).verified,true);
 assert.equal((await verify([source,computedIndex])).verified,true);
 assert.equal((await verify([source,nullableNumeric])).verified,true);
 for(const code of ["print(1 if 1>0 else 'unsafe')","labels = ('a','b')\ni = round(0.2)\nprint(labels[i])","tuple(Image.open('/etc/passwd') for i in range(4))","tuple(i for i in range(999999999))","tuple(i for i in range(0,4,0))","tuple(i for i in range(4) if True)","x = 1 if True else __import__('os')","range = print","tuple = print"])
  assert.equal((await verify([source,code])).verified,false,code);
});
test('syntax-only inspection accepts attached-page crop, rotation and pixel bounds across tool calls',async()=>{
 const result=await verify([source,"import numpy as np, PIL\narr = np.array(im)\nys, xs = np.where((arr < 245).any(axis=2))\nxs.min(), xs.max(), ys.min(), ys.max()","crop = im.crop((0, 0, 100, 100)).resize((200, 200))\nrotated = crop.rotate(90, expand=True)\ndisplay(rotated)"]);
 assert.equal(result.verified,true);assert.deepEqual(result.inspected_attachment_sha256s,['synthetic-digest']);
 for(const code of ["im.rotate(90, expand=1)","im.rotate(90, center=(10,10))","im.rotate(90, resample=Image.Resampling.NEAREST)"])
  assert.equal((await verify([source,code])).verified,false,code);
});

test('bounded source-image pixel sampling is accepted without widening access',async()=>{
 const result=await verify([source,"samples = (im.getpixel((0, 0)), im.getpixel((10, 20)))\nscaled = [round(im.getpixel((0, 0))[channel] * 0.5, 1) for channel in range(3)]\ngray = im.convert('L')\nprint(samples, scaled, gray.getpixel((0, 0)) * 0.5)","from PIL import Image\nraw = Image.open('/mnt/data/synthetic.png')\nprint(raw.getpixel((0,0)) * 2, raw.getpixel((0,0))[0] * 2)"]);
 assert.equal(result.verified,true);
 assert.equal(result.operations.filter(operation=>operation==='pixel_sample').length,8);
 for(const code of ["im.getpixel((0,0), unsafe=True)","im.getpixel((0,0,1))","im.getpixel('/etc/passwd')","import numpy as np\nim.getpixel((np.array(im),0))","im.getpixel((0,0))[3]","from PIL import Image\nraw = Image.open('/mnt/data/synthetic.png')\nprint(raw.getpixel((0,0))[4])"])
  assert.equal((await verify([source,code])).verified,false,code);
});
test('terminally errored source-tool code may retain bounded type-invalid arithmetic only',async()=>{
 const typeInvalid="axis = 'xy'\nprint(round(axis[0] * 0.5, 1))";
 assert.equal((await verify([source,typeInvalid])).verified,false);
 assert.equal((await verify([source,typeInvalid],['Analyzed','AnalysisErrored'])).verified,true);
 assert.equal((await verify([source,"Image.open('/etc/passwd')"],['Analyzed','AnalysisErrored'])).verified,false);
 assert.equal((await verify([source,typeInvalid],['Analyzed'])).verified,false);
 assert.equal((await verify([source,typeInvalid],['Analyzed','Unknown'])).verified,false);
});
test('bounded literal string transformations remain pure data and cannot dispatch arbitrary methods',async()=>{
 const result=await verify([source,"label = 'source row'.replace(' ', '-')\ncounts = [(character, label.count(character)) for character in label]\nprint(counts)"]);
 assert.equal(result.verified,true);
 for(const code of ["'x'.replace('x', 1)","'x'.replace('x','y',1)","'x'.replace(old,new)","'x'.count(1)","'x'.count('x',0)","'/etc/passwd'.encode()"])
  assert.equal((await verify([source,code])).verified,false,code);
});
test('source-bound matplotlib viewport inspection is accepted without widening file or output access',async()=>{
 const result=await verify([source,"import matplotlib.pyplot as plt\nplt.figure(figsize=(10,14))\nplt.imshow(im)\nplt.xlim(100,1200)\nplt.ylim(1500,80)\nplt.grid()"]);
 assert.equal(result.verified,true);
 assert.ok(result.operations.includes('display_source_image'));
 for(const code of ["import matplotlib","import matplotlib.pyplot as plt\nplt.imread('/etc/passwd')","import matplotlib.pyplot as plt\nplt.savefig('/tmp/out.png')","import matplotlib.pyplot as plt\nplt.imshow(other)"])
  assert.equal((await verify([source,code])).verified,false,code);
});

test('syntax-only inspection rejects outside files, network, arbitrary execution and unbound state',async()=>{
 for(const code of ["import os\nos.system('echo unsafe')","import urllib.request","Image.open('/mnt/data/other.png')","Image.open('/etc/passwd')","Image.open('/mnt/data/../synthetic.png')","open('/mnt/data/synthetic.png')","display(other)","im.save('/mnt/data/out.png')","eval('1')","getattr(im, 'save')('out')","im.__class__","[display(im) for x in range(3)]","np.load('/mnt/data/synthetic.png')"]){
  assert.equal((await verify([source,code])).verified,false,code);
 }
 assert.equal((await verify([])).verified,false);
});

test('source-bound coordinate conversion and schema serialization remain pure in-memory operations',async()=>{
 const result=await verify([source,"sx = 0.5\nboxes = {'header': [0,0,100,40]}\ndef conv(b):\n    return [round(b[0]*sx,2), round(b[1]*sx,2), round(b[2]*sx,2), round(b[3]*sx,2)]\nfor name, b in boxes.items():\n    print(name, conv(b))\nimport json\nresult = {'regions':[{'transcription':'Synthetic page','bbox':conv([0,0,100,40])}]}\nprint(json.dumps(result, ensure_ascii=False, indent=2)[:1000])"]);
 assert.equal(result.verified,true);
 for(const code of ["def evil(b):\n    return __import__('os')\nevil(1)","def evil(b):\n    return evil(b)\nevil(1)","Image.open('/mnt/data/synthetic.png', opener=print)"])
  assert.equal((await verify([source,code])).verified,false);
});

test('image resize filters and finite coordinate tables are source-bound without executing code',async()=>{
 const result=await verify([source,"display(im.crop((0,0,100,100)).resize((300,300), Image.Resampling.LANCZOS))\ndisplay(im.resize((200,200), Image.Resampling.BICUBIC))\nboxes = {}\nfor row, bounds in enumerate([(0,0,10,10),(10,10,20,20)]):\n    boxes[f'cell-{row}'] = bounds\nscaled = {key: value for key, value in boxes.items()}\nscaled"]);
 assert.equal(result.verified,true);
 for(const code of ["display(im.resize((20,20), Image.Resampling.BOX))","display(im.resize((20,20), Image.Resampling.__dict__))","boxes = {}\nboxes[__import__('os')] = 1","x = {k: eval(k) for k in ['unsafe']}"])
  assert.equal((await verify([source,code])).verified,false);
});

test('bounded coordinate list comprehensions stay source-bound', async()=>{
 const coordinates="scale = 0.5\n[(round(a*scale,1),round(b*scale,1)) for a,b in [(2,4),(6,8)]]";
 assert.equal((await verify([source,coordinates])).verified,true);
 for(const code of ["[Image.open('/etc/passwd') for i in range(2)]","[i for i in range(5000)]","[i for i in range(4) if i]","[i for i in range(4) for j in range(2)]","[eval('1') for i in range(2)]","tuple(print(i) for i in range(2))","{i:print(i) for i in range(2)}"])
  assert.equal((await verify([source,code])).verified,false,code);
});
